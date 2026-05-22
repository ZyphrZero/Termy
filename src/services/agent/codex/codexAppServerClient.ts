/**
 * Stdio-based JSON-RPC client managing the `codex app-server` child process.
 *
 * Lifecycle:
 *   start() → spawn → initialize handshake → ready
 *   stop()  → SIGTERM → 2 s grace → SIGKILL → reject pending
 *
 * Communication:
 *   - Outbound: write newline-delimited JSON to stdin
 *   - Inbound: read stdout through JsonRpcLineDecoder; capture stderr
 *     into a 32 KB rolling buffer for diagnostics on crash
 *
 * Routing model:
 *   - `onNotification(method, handler)` — daemon-pushed notifications
 *     (e.g. `item/started`, `item/completed`, `item/agentMessage/delta`,
 *     `turn/started`, `turn/completed`, `turn/plan/updated`, `error`).
 *   - `onServerRequest(method, handler)` — daemon-initiated requests
 *     that expect a response (e.g. `item/commandExecution/requestApproval`,
 *     `item/fileChange/requestApproval`, `item/permissions/requestApproval`).
 *     The handler must call `respondToServerRequest(id, result)` so the
 *     daemon can advance.
 *
 * The notification list is intentionally not enumerated here — see the
 * canonical Rust definitions in
 * `codex/codex-rs/app-server-protocol/src/protocol/common.rs` (under
 * `server_notification_definitions!` and `server_request_definitions!`).
 */

import type { ChildProcess } from 'child_process';
import { debugLog, errorLog } from '@/utils/logger';
import { encodeJsonRpcFrame, JsonRpcLineDecoder } from '../../agentStream/acp/jsonRpcLine';
import { getCachedEnrichedShellPath } from '../../terminal/enrichedShellEnv';
import {
  isWindowsBatch,
  resolveExecutableOnPath,
  wrapWindowsArg,
} from '../../agentStream/acp/childProcessTransport';
import type {
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  InitializeParams,
} from './codexTypes';

type ChildProcessModule = typeof import('child_process');
type FsModule = typeof import('fs');
type PathModule = typeof import('path');

const INITIALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const STDERR_MAX_BYTES = 32 * 1024;
const STOP_GRACE_MS = 2_000;

/** Plugin version reported in the initialize handshake. */
const CLIENT_VERSION = '1.4.1';

export interface CodexAppServerClientOptions {
  /** Resolved binary name or absolute path. Defaults to `'codex'`. */
  command?: string;
  /** Working directory for the daemon. Should be the vault root. */
  cwd: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: number;
  method: string;
}

export type NotificationHandler = (params: unknown) => void;

export interface ServerRequest {
  id: number | string;
  method: string;
  params: unknown;
}

export type ServerRequestHandler = (request: ServerRequest) => void;

export class CodexAppServerClient {
  private readonly options: Required<Pick<CodexAppServerClientOptions, 'command' | 'cwd'>>;
  private readonly childProcessModule: ChildProcessModule;
  private readonly fsModule: FsModule;
  private readonly pathModule: PathModule;

  private process: ChildProcess | null = null;
  private decoder: JsonRpcLineDecoder | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private stderrBuffer = '';
  private startPromise: Promise<void> | null = null;
  private stopped = false;

  /** Method → list of handlers. */
  private notificationHandlers = new Map<string, NotificationHandler[]>();
  /** Method → handler. Only one handler per server request type. */
  private serverRequestHandlers = new Map<string, ServerRequestHandler>();
  /** Wildcard server-request handler invoked when no method-specific one is registered. */
  private fallbackServerRequestHandler: ServerRequestHandler | null = null;

  constructor(options: CodexAppServerClientOptions) {
    this.options = {
      command: options.command ?? 'codex',
      cwd: options.cwd,
    };
    this.childProcessModule = window.require('child_process') as ChildProcessModule;
    this.fsModule = window.require('fs') as FsModule;
    this.pathModule = window.require('path') as PathModule;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  /** Spawn + initialize. Idempotent while the process is running. */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.stopped = false;
    this.startPromise = this.spawnAndInitialize().catch((error) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.startPromise = null;
    const proc = this.process;
    this.process = null;

    this.rejectAllPending(new Error('CodexAppServerClient stopped'));

    if (!proc || proc.killed) return;

    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
        resolve();
      }, STOP_GRACE_MS);
      proc.once('exit', () => {
        window.clearTimeout(timeout);
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  getStderrTail(): string {
    return this.stderrBuffer;
  }

  // ─── Outbound RPC ────────────────────────────────────────────────

  /** Send a JSON-RPC request and await its response. */
  request<TResult>(method: string, params: unknown, timeoutMs?: number): Promise<TResult> {
    if (!this.process || this.process.killed) {
      return Promise.reject(new Error('CodexAppServerClient is not running'));
    }

    const id = this.nextId++;
    const effectiveTimeout = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise<TResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex request '${method}' timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
        method,
      });

      this.writeStdin(message);
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  notify(method: string, params: unknown): void {
    if (!this.process || this.process.killed) return;
    this.writeStdin({ jsonrpc: '2.0', method, params } satisfies JsonRpcNotification);
  }

  /**
   * Reply to a server-initiated request. Pass the request id from the
   * incoming `ServerRequest` plus the typed result payload.
   */
  respondToServerRequest(id: number | string, result: unknown): void {
    if (!this.process || this.process.killed) return;
    this.writeStdin({ jsonrpc: '2.0', id, result } satisfies JsonRpcResponse);
  }

  /** Reply with a JSON-RPC error to a server-initiated request. */
  respondToServerRequestWithError(id: number | string, code: number, message: string): void {
    if (!this.process || this.process.killed) return;
    this.writeStdin({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    } satisfies JsonRpcError);
  }

  // ─── Inbound routing ─────────────────────────────────────────────

  /** Subscribe to a specific notification method. Returns an unsubscribe fn. */
  onNotification(method: string, handler: NotificationHandler): () => void {
    const list = this.notificationHandlers.get(method) ?? [];
    list.push(handler);
    this.notificationHandlers.set(method, list);
    return () => {
      const current = this.notificationHandlers.get(method);
      if (!current) return;
      const idx = current.indexOf(handler);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  /** Subscribe to a specific server-request method. */
  onServerRequest(method: string, handler: ServerRequestHandler): () => void {
    this.serverRequestHandlers.set(method, handler);
    return () => {
      if (this.serverRequestHandlers.get(method) === handler) {
        this.serverRequestHandlers.delete(method);
      }
    };
  }

  /** Catch-all server-request handler used when no method-specific one matches. */
  onAnyServerRequest(handler: ServerRequestHandler): () => void {
    this.fallbackServerRequestHandler = handler;
    return () => {
      if (this.fallbackServerRequestHandler === handler) {
        this.fallbackServerRequestHandler = null;
      }
    };
  }

  // ─── Private: spawn + initialize ─────────────────────────────────

  private spawnAndInitialize(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let proc: ChildProcess;
      try {
        // Merge the enriched login-shell PATH so GUI-launched Obsidian
        // finds CLIs installed via npm/fnm/nvm/scoop/volta/brew.
        const enrichedPath = getCachedEnrichedShellPath();
        const env: NodeJS.ProcessEnv = enrichedPath
          ? { ...process.env, PATH: enrichedPath }
          : { ...process.env };

        // Resolve the executable via PATH (PATHEXT-aware on Windows) so
        // we can spawn `.cmd`/`.bat` shims correctly.
        const resolvedCommand = resolveExecutableOnPath(
          this.options.command,
          env,
          this.fsModule,
          this.pathModule,
        );
        if (!resolvedCommand) {
          reject(new Error(
            'Codex CLI not found. Install via `npm i -g @openai/codex` or set the path in settings.',
          ));
          return;
        }

        const args = ['app-server', '--listen', 'stdio://'];
        let spawnCommand: string;
        let spawnArgs: string[];
        let useShell = false;
        if (process.platform === 'win32' && isWindowsBatch(resolvedCommand)) {
          spawnCommand = wrapWindowsArg(resolvedCommand);
          spawnArgs = args.map(wrapWindowsArg);
          useShell = true;
        } else {
          spawnCommand = resolvedCommand;
          spawnArgs = args;
        }

        proc = this.childProcessModule.spawn(spawnCommand, spawnArgs, {
          cwd: this.options.cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: useShell,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      this.process = proc;
      this.decoder = new JsonRpcLineDecoder();
      this.stderrBuffer = '';
      this.nextId = 1;
      this.pendingRequests = new Map();

      let startResolved = false;

      const finishFail = (reason: string): void => {
        if (startResolved) return;
        startResolved = true;
        const tail = this.stderrBuffer.trim();
        const message = tail.length > 0 ? `${reason}\n${tail}` : reason;
        try {
          if (!proc.killed) proc.kill('SIGTERM');
        } catch {
          /* already exited */
        }
        this.process = null;
        reject(new Error(message));
      };

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        this.stderrBuffer += text;
        if (this.stderrBuffer.length > STDERR_MAX_BYTES) {
          this.stderrBuffer = this.stderrBuffer.slice(-STDERR_MAX_BYTES);
        }
      });

      proc.stdout?.on('data', (chunk: Buffer) => {
        if (!this.decoder) return;
        const frames = this.decoder.feed(chunk);
        for (const frame of frames) {
          if (frame.kind === 'parse-error') {
            errorLog('[CodexAppServerClient] JSON parse error:', frame.reason, frame.rawPayload);
            continue;
          }
          this.handleFrame(frame.payload);
        }
      });

      proc.once('error', (error) => {
        const isNotFound = 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
        const message = isNotFound
          ? 'Codex CLI not found. Install via `npm i -g @openai/codex` or set the path in settings.'
          : `Failed to spawn codex: ${error.message}`;
        finishFail(message);
      });

      proc.once('exit', (code, signal) => {
        if (!startResolved) {
          finishFail(
            `codex app-server exited before initialize (code=${code} signal=${signal ?? 'none'})`,
          );
          return;
        }
        this.process = null;
        if (!this.stopped) {
          errorLog(
            `[CodexAppServerClient] Daemon exited unexpectedly (code=${code} signal=${signal ?? 'none'})`,
          );
        }
        this.rejectAllPending(
          new Error(`codex app-server exited (code=${code} signal=${signal ?? 'none'})`),
        );
      });

      // Initialize handshake.
      const initParams: InitializeParams = {
        clientInfo: { name: 'termy-obsidian', title: 'Termy', version: CLIENT_VERSION },
        capabilities: { experimentalApi: true },
      };
      const initId = this.nextId++;
      const initMessage: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: initParams,
      };

      const initTimeout = window.setTimeout(() => {
        this.pendingRequests.delete(initId);
        finishFail(
          `Codex daemon did not respond to initialize within ${INITIALIZE_TIMEOUT_MS}ms`,
        );
      }, INITIALIZE_TIMEOUT_MS);

      this.pendingRequests.set(initId, {
        resolve: (result: unknown) => {
          window.clearTimeout(initTimeout);
          if (startResolved) return;
          startResolved = true;
          debugLog('[CodexAppServerClient] Initialize handshake complete', result);
          // Emit `initialized` notification so the daemon knows the
          // client finished the handshake.
          this.notify('initialized', null);
          resolve();
        },
        reject: (error: Error) => {
          window.clearTimeout(initTimeout);
          finishFail(`Initialize failed: ${error.message}`);
        },
        timeout: initTimeout,
        method: 'initialize',
      });

      this.writeStdin(initMessage);
    });
  }

  // ─── Private: frame routing ──────────────────────────────────────

  private handleFrame(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const msg = payload as Record<string, unknown>;

    const hasMethod = typeof msg.method === 'string';
    const hasId = 'id' in msg && msg.id !== null && msg.id !== undefined;

    if (hasMethod && hasId) {
      // Server-initiated request (e.g. `item/commandExecution/requestApproval`).
      this.handleServerRequest({
        id: msg.id as number | string,
        method: msg.method as string,
        params: msg.params,
      });
      return;
    }

    if (hasId) {
      // Response to one of our outbound requests.
      this.handleResponse(msg);
      return;
    }

    if (hasMethod) {
      // Notification.
      this.dispatchNotification({
        jsonrpc: '2.0',
        method: msg.method as string,
        params: msg.params,
      });
    }
  }

  private handleResponse(msg: Record<string, unknown>): void {
    const id = msg.id as number | string;
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      debugLog('[CodexAppServerClient] Response for unknown id:', id);
      return;
    }
    this.pendingRequests.delete(id);
    window.clearTimeout(pending.timeout);

    if ('error' in msg && msg.error) {
      const err = (msg as unknown as JsonRpcError).error;
      pending.reject(new Error(`Codex '${pending.method}' error ${err.code}: ${err.message}`));
      return;
    }

    pending.resolve((msg as unknown as JsonRpcResponse).result);
  }

  private dispatchNotification(notification: JsonRpcNotification): void {
    const handlers = this.notificationHandlers.get(notification.method);
    if (!handlers || handlers.length === 0) return;
    for (const handler of handlers) {
      try {
        handler(notification.params);
      } catch (error) {
        errorLog(
          `[CodexAppServerClient] notification handler for '${notification.method}' threw:`,
          error,
        );
      }
    }
  }

  private handleServerRequest(request: ServerRequest): void {
    const handler = this.serverRequestHandlers.get(request.method)
      ?? this.fallbackServerRequestHandler;
    if (!handler) {
      debugLog('[CodexAppServerClient] No handler for server request:', request.method);
      this.respondToServerRequestWithError(
        request.id,
        -32601,
        `Method not found: ${request.method}`,
      );
      return;
    }
    try {
      handler(request);
    } catch (error) {
      errorLog(
        `[CodexAppServerClient] server-request handler for '${request.method}' threw:`,
        error,
      );
      const message = error instanceof Error ? error.message : String(error);
      this.respondToServerRequestWithError(request.id, -32603, message);
    }
  }

  private writeStdin(message: unknown): void {
    if (!this.process?.stdin || this.process.stdin.destroyed) return;
    this.process.stdin.write(encodeJsonRpcFrame(message));
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
