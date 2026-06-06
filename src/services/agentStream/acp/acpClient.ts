/**
 * Minimal ACP (Agent Client Protocol) client.
 *
 * Spawns an agent subprocess, frames JSON-RPC over its stdio with
 * `Content-Length` headers, performs the `initialize` →
 * `session/new` handshake, and exposes a small typed surface for
 * sending prompts / cancelling / closing.
 *
 * Design constraints worth highlighting:
 *
 * - **No external dependency on `vscode-jsonrpc`.** The framing layer
 *   is one small file ({@link JsonRpcLineDecoder}) — pulling in the
 *   full vscode-jsonrpc module would balloon `main.js` for a one-page
 *   feature. Tests exercise the framing exhaustively.
 *
 * - **The transport is abstracted behind {@link AcpTransport}.** In
 *   production we plug in {@link createChildProcessAcpTransport}; in
 *   tests we plug in an in-memory transport with hand-fed frames so
 *   we never touch a real shell.
 *
 * - **Client capabilities are fully enabled** (`fs.readTextFile`,
 *   `fs.writeTextFile`, `terminal`). Actual execution is gated by
 *   the injected handlers and the PermissionQueue modal (Req 3/7).
 *
 * - **`session/request_permission` is delegated to the caller.**
 *   If no `onPermissionRequest` handler is injected, all permission
 *   requests are rejected and an error event is emitted. This
 *   ensures no silent auto-allow path exists (Property 3.1).
 *
 * - **All inbound messages are validated permissively.** We never
 *   crash on a missing or malformed field; we either log via the
 *   provided `onError` hook or return early. This keeps the agent
 *   panel resilient when an experimental agent build ships a slightly
 *   off-spec frame.
 */

import { JsonRpcLineDecoder, encodeJsonRpcFrame } from './jsonRpcLine.ts';
import {
  ACP_LATEST_PROTOCOL_VERSION,
  ACP_METHODS,
  type AcpInitializeResult,
  type AcpListSessionsResult,
  type AcpLoadSessionResult,
  type AcpNewSessionResult,
  type AcpPermissionRequestParams,
  type AcpPermissionResult,
  type AcpPromptResult,
  type AcpSessionUpdateNotification,
  type AcpStopReason,
} from './acpProtocol.ts';
import type { AcpFsHandlers, AcpFsReadRequest, AcpFsWriteRequest } from './fsCapabilityHandler.ts';
import type { AcpTerminalHandlers, AcpTerminalCreateRequest } from './terminalCapabilityHandler.ts';

/* -----------------------------------------------------------------
 * Transport abstraction
 * ---------------------------------------------------------------*/

export interface AcpTransport {
  /** Start the transport. Resolves once stdin/stdout are ready. */
  start(): Promise<void>;
  /** Send a serialized frame. */
  send(frame: Buffer): void;
  /** Subscribe to inbound bytes from the agent. */
  onData(listener: (chunk: Buffer) => void): () => void;
  /** Subscribe to lifecycle events (stderr lines, transport close). */
  onLog(listener: (text: string) => void): () => void;
  /** Subscribe to transport-level errors / unexpected exit. */
  onClose(listener: (reason: string) => void): () => void;
  /** Stop the transport, signalling the agent to exit. */
  stop(): Promise<void>;
}

/* -----------------------------------------------------------------
 * Client surface
 * ---------------------------------------------------------------*/

export interface AcpClientCallbacks {
  /** Invoked once per `session/update` notification. */
  onSessionUpdate?: (notification: AcpSessionUpdateNotification) => void;
  /**
   * Invoked when the agent requests permission for a tool call.
   * If not provided, all permission requests are rejected with
   * `cancelled` and an error event is emitted (Property 3.1).
   */
  onPermissionRequest?: (
    params: AcpPermissionRequestParams,
  ) => Promise<AcpPermissionResult> | AcpPermissionResult;
  /** Injected fs capability handlers for read/write routing. */
  fsHandler?: AcpFsHandlers;
  /** Injected terminal capability handler for terminal/create routing. */
  terminalHandler?: AcpTerminalHandlers;
  /** Invoked for diagnostic / stderr text that should reach the user. */
  onLog?: (text: string) => void;
  /** Invoked on transport / protocol errors that the client could not recover from. */
  onError?: (error: Error) => void;
  /** Invoked when the agent process exits or the transport closes. */
  onClose?: (reason: string) => void;
}

export interface AcpClientOptions {
  transport: AcpTransport;
  /**
   * Implementation info we send in `initialize`. Defaults are plumbed
   * by the caller because this module does not import the plugin
   * manifest directly.
   */
  clientInfo: {
    name: string;
    version: string;
    title?: string;
  };
  callbacks?: AcpClientCallbacks;
  /**
   * Wall-clock used for the request timeout countdown. Tests inject a
   * deterministic clock; production passes `Date.now`.
   */
  now?: () => number;
  /** Default request timeout in milliseconds. Defaults to 30 s. */
  requestTimeoutMs?: number;
  /** Function used to schedule timeouts. Defaults to `setTimeout`. */
  scheduleTimeout?: (callback: () => void, ms: number) => unknown;
  cancelTimeout?: (handle: unknown) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type AcpClientTestHooks = Pick<
  AcpClientOptions,
  'scheduleTimeout' | 'cancelTimeout' | 'now' | 'requestTimeoutMs'
>;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle: unknown;
}

export class AcpClient {
  private readonly transport: AcpTransport;
  private readonly callbacks: AcpClientCallbacks;
  private readonly clientInfo: AcpClientOptions['clientInfo'];
  private readonly decoder = new JsonRpcLineDecoder();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly scheduleTimeout: (callback: () => void, ms: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;

  private nextRequestId = 1;
  private detachData: (() => void) | null = null;
  private detachLog: (() => void) | null = null;
  private detachClose: (() => void) | null = null;
  private started = false;
  private closed = false;
  private initializeResult: AcpInitializeResult | null = null;
  private activeSessionId: string | null = null;

  constructor(options: AcpClientOptions) {
    this.transport = options.transport;
    this.callbacks = options.callbacks ?? {};
    this.clientInfo = options.clientInfo;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const defaultSchedule = (cb: () => void, ms: number): unknown => window.setTimeout(cb, ms);
    const defaultCancel = (handle: unknown): void => {
      if (handle !== null && handle !== undefined) {
        window.clearTimeout(handle as ReturnType<typeof window.setTimeout>);
      }
    };
    this.scheduleTimeout = options.scheduleTimeout ?? defaultSchedule;
    this.cancelTimeout = options.cancelTimeout ?? defaultCancel;
  }

  /** Start transport, decode loop, and complete initialization. */
  async start(): Promise<AcpInitializeResult> {
    if (this.started) {
      if (!this.initializeResult) {
        throw new Error('ACP client started but never finished initialization');
      }
      return this.initializeResult;
    }
    this.started = true;

    this.detachData = this.transport.onData((chunk) => this.handleIncoming(chunk));
    this.detachLog = this.transport.onLog((text) => {
      this.callbacks.onLog?.(text);
    });
    this.detachClose = this.transport.onClose((reason) => {
      this.handleClose(reason);
    });

    await this.transport.start();

    const result = await this.request<AcpInitializeResult>(ACP_METHODS.initialize, {
      protocolVersion: ACP_LATEST_PROTOCOL_VERSION,
      clientCapabilities: {
        // All capabilities enabled; actual execution gated by
        // injected handlers + PermissionQueue (Req 3 AC 8 / Req 7).
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: this.clientInfo,
    });
    this.initializeResult = result;
    return result;
  }

  /** Open a new session in the agent and remember its id. */
  async newSession(cwd: string): Promise<string> {
    const result = await this.request<AcpNewSessionResult>(ACP_METHODS.newSession, {
      cwd,
      mcpServers: [],
    });
    if (typeof result.sessionId !== 'string' || result.sessionId.length === 0) {
      throw new Error('ACP server returned an empty sessionId');
    }
    this.activeSessionId = result.sessionId;
    return result.sessionId;
  }

  async listSessions(input: { cwd?: string; cursor?: string }): Promise<AcpListSessionsResult> {
    return this.request<AcpListSessionsResult>(ACP_METHODS.listSessions, input);
  }

  /** Restore a persisted session in the agent and replay its context. */
  async loadSession(sessionId: string, cwd: string): Promise<void> {
    await this.request<AcpLoadSessionResult>(ACP_METHODS.loadSession, {
      sessionId,
      cwd,
      mcpServers: [],
    });
    this.activeSessionId = sessionId;
  }

  /**
   * Send a prompt and wait for the turn to complete. Promise resolves
   * to the stop reason; streaming updates are delivered through
   * `callbacks.onSessionUpdate` while the prompt is in flight.
   */
  async prompt(sessionId: string, text: string): Promise<AcpStopReason> {
    const result = await this.request<AcpPromptResult>(ACP_METHODS.prompt, {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
    return result.stopReason;
  }

  /** Send a `session/cancel` notification (no response expected). */
  cancel(sessionId: string): void {
    this.notify(ACP_METHODS.cancel, { sessionId });
  }

  /** Convenience accessor for callers that lost the session id. */
  get sessionId(): string | null {
    return this.activeSessionId;
  }

  /** Close the transport and reject every pending request. */
  async stop(reason = 'client requested stop'): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const [, pending] of this.pending) {
      this.cancelTimeout(pending.timeoutHandle);
      pending.reject(new Error(`ACP transport closing: ${reason}`));
    }
    this.pending.clear();

    this.detachData?.();
    this.detachLog?.();
    this.detachClose?.();
    this.detachData = null;
    this.detachLog = null;
    this.detachClose = null;

    await this.transport.stop();
  }

  /* -----------------------------------------------------------------
   * Internals
   * ---------------------------------------------------------------*/

  private async request<TResult>(method: string, params: unknown): Promise<TResult> {
    if (this.closed) {
      throw new Error('ACP client is closed');
    }
    const id = this.nextRequestId++;
    return new Promise<TResult>((resolve, reject) => {
      const timeoutHandle = this.scheduleTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        reject(new Error(`ACP request \`${method}\` timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeoutHandle,
      });

      try {
        this.transport.send(encodeJsonRpcFrame({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }));
      } catch (error) {
        this.pending.delete(id);
        this.cancelTimeout(timeoutHandle);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    if (this.closed) return;
    this.transport.send(encodeJsonRpcFrame({
      jsonrpc: '2.0',
      method,
      params,
    }));
  }

  private handleIncoming(chunk: Buffer): void {
    const frames = this.decoder.feed(chunk);
    for (const frame of frames) {
      if (frame.kind === 'parse-error') {
        this.callbacks.onError?.(new Error(`ACP parse error: ${frame.reason}`));
        continue;
      }
      this.dispatch(frame.payload);
    }
  }

  private dispatch(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) {
      return;
    }
    const message = payload as Record<string, unknown>;
    if (typeof message.id === 'number' && (message.result !== undefined || message.error !== undefined)) {
      this.handleResponse(message as { id: number; result?: unknown; error?: { code?: number; message?: string } });
      return;
    }
    if (typeof message.method === 'string') {
      this.handleIncomingRequest(message as {
        id?: number | string | null;
        method: string;
        params?: unknown;
      });
      return;
    }
    // Otherwise ignore.
  }

  private handleResponse(message: { id: number; result?: unknown; error?: { code?: number; message?: string } }): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    this.cancelTimeout(pending.timeoutHandle);

    if (message.error) {
      const reason = message.error.message ?? 'Agent returned an error';
      pending.reject(new Error(`ACP error (${message.error.code ?? '?'}): ${reason}`));
      return;
    }
    pending.resolve(message.result ?? {});
  }

  private handleIncomingRequest(message: {
    id?: number | string | null;
    method: string;
    params?: unknown;
  }): void {
    if (message.method === ACP_METHODS.sessionUpdate) {
      const params = message.params;
      if (typeof params === 'object' && params !== null) {
        this.callbacks.onSessionUpdate?.(params as AcpSessionUpdateNotification);
      }
      return;
    }
    if (message.method === ACP_METHODS.requestPermission && message.id !== undefined && message.id !== null) {
      const params = (message.params ?? {}) as AcpPermissionRequestParams;
      void this.respondToPermission(message.id, params);
      return;
    }
    // fs/read_text_file routing (Req 7 AC 7)
    if (message.method === 'fs/read_text_file' && message.id !== undefined && message.id !== null) {
      void this.handleFsRead(message.id, message.params);
      return;
    }
    // fs/write_text_file routing (Req 7 AC 8)
    if (message.method === 'fs/write_text_file' && message.id !== undefined && message.id !== null) {
      void this.handleFsWrite(message.id, message.params);
      return;
    }
    // terminal/create routing (Req 3 AC 8)
    if (message.method === 'terminal/create' && message.id !== undefined && message.id !== null) {
      void this.handleTerminalCreate(message.id, message.params);
      return;
    }
    // Unknown methods get a method-not-found response if they expect one.
    if (message.id !== undefined && message.id !== null) {
      this.transport.send(encodeJsonRpcFrame({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      }));
    }
  }

  private async respondToPermission(
    id: number | string,
    params: AcpPermissionRequestParams,
  ): Promise<void> {
    let result: AcpPermissionResult;
    try {
      const handler = this.callbacks.onPermissionRequest;
      if (handler) {
        result = await handler(params);
      } else {
        // No handler injected — reject all requests and emit error (Property 3.1)
        this.callbacks.onError?.(
          new Error('Permission request received but no onPermissionRequest handler is configured'),
        );
        result = { outcome: { kind: 'cancelled' } };
      }
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      result = { outcome: { kind: 'cancelled' } };
    }
    this.transport.send(encodeJsonRpcFrame({
      jsonrpc: '2.0',
      id,
      result,
    }));
  }

  private async handleFsRead(id: number | string, params: unknown): Promise<void> {
    const handler = this.callbacks.fsHandler;
    if (!handler) {
      this.transport.send(encodeJsonRpcFrame({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'fs/read_text_file: no handler configured' },
      }));
      return;
    }
    try {
      const req = (params ?? {}) as AcpFsReadRequest;
      const result = await handler.readTextFile(req);
      this.transport.send(encodeJsonRpcFrame({ jsonrpc: '2.0', id, result }));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = (error as { code?: number }).code ?? -32000;
      this.transport.send(encodeJsonRpcFrame({
        jsonrpc: '2.0',
        id,
        error: { code, message: err.message },
      }));
    }
  }

  private async handleFsWrite(id: number | string, params: unknown): Promise<void> {
    const handler = this.callbacks.fsHandler;
    if (!handler) {
      this.transport.send(encodeJsonRpcFrame({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'fs/write_text_file: no handler configured' },
      }));
      return;
    }
    try {
      const req = (params ?? {}) as AcpFsWriteRequest;
      const result = await handler.writeTextFile(req);
      this.transport.send(encodeJsonRpcFrame({ jsonrpc: '2.0', id, result }));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = (error as { code?: number }).code ?? -32000;
      this.transport.send(encodeJsonRpcFrame({
        jsonrpc: '2.0',
        id,
        error: { code, message: err.message },
      }));
    }
  }

  private async handleTerminalCreate(id: number | string, params: unknown): Promise<void> {
    const handler = this.callbacks.terminalHandler;
    if (!handler) {
      this.transport.send(encodeJsonRpcFrame({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'terminal/create: no handler configured' },
      }));
      return;
    }
    try {
      const req = (params ?? {}) as AcpTerminalCreateRequest;
      const result = await handler.create(req);
      this.transport.send(encodeJsonRpcFrame({ jsonrpc: '2.0', id, result }));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = (error as { code?: number }).code ?? -32000;
      this.transport.send(encodeJsonRpcFrame({
        jsonrpc: '2.0',
        id,
        error: { code, message: err.message },
      }));
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      this.cancelTimeout(pending.timeoutHandle);
      pending.reject(new Error(`ACP transport closed: ${reason}`));
    }
    this.pending.clear();
    this.callbacks.onClose?.(reason);
  }
}
