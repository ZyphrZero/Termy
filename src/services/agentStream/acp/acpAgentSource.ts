/**
 * Glue between {@link AcpClient} and the agent panel's
 * {@link AgentEventBus}.
 *
 * Wires four things together:
 *
 *  1. **Lifecycle**: when the source starts, spawn the agent and run
 *     `initialize`. Each panel "new session" action then calls
 *     `session/new` on the same connection and gets its own session id.
 *  2. **`session/update` notifications**: pipe through
 *     {@link adaptAcpUpdate} into {@link AgentEvent}s.
 *  3. **Permissions**: delegated to the injected `onPermissionRequest`
 *     handler (typically backed by {@link PermissionQueue}). If no
 *     handler is provided, AcpClient rejects all requests.
 *  4. **Errors / process exit**: emit `error` and `session-state`
 *     events so the user always sees something happened. The `onExit`
 *     callback notifies AgentManager for active-map cleanup.
 *
 * `submitPrompt` is exposed for the host to call when the user types
 * a message into the panel input. The bus stays read-only; control
 * flow goes the other direction through this source.
 *
 * The source name is injected by the caller (default convention:
 * `acp:<agentId>`) to avoid multi-agent naming conflicts on the bus.
 */

import type { AgentEventPublisher, AgentEventSource } from '../agentEventSource.ts';
import type { AgentEvent, AgentSessionId, AgentSessionState } from '../agentEventTypes.ts';
import { adaptAcpUpdate, adaptStopReason } from './acpEventAdapter.ts';
import {
  AcpClient,
  type AcpClientOptions,
  type AcpClientTestHooks,
  type AcpTransport,
} from './acpClient.ts';
import type { AcpFsHandlers } from './fsCapabilityHandler.ts';
import type {
  AcpPermissionRequestParams,
  AcpPermissionResult,
  AcpSessionInfo,
  AcpSessionUpdateNotification,
} from './acpProtocol.ts';
import { AcpSessionMapper } from './acpSessionMapper.ts';
import type { AcpTerminalHandlers } from './terminalCapabilityHandler.ts';

/** Info about a child process exit, forwarded to AgentManager. */
export interface AcpExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
  readonly reason: string;
}

export interface AcpAgentSourceOptions {
  /** Stable name used by the bus. Pick something readable, e.g. `acp:opencode`. */
  name: string;
  /** Stable provider id used as the panel session-id namespace. */
  agentId: string;
  /** Agent display label rendered in the panel header. */
  agentLabel: string;
  /** Default working directory passed to the agent's `session/new` request. */
  cwd: string;
  /**
   * Transport factory. We accept a factory rather than an instance
   * so the source can be re-started with a fresh subprocess.
   */
  transportFactory: () => AcpTransport;
  /**
   * Termy plugin info forwarded as `clientInfo` during the
   * `initialize` handshake.
   */
  clientInfo: AcpClientOptions['clientInfo'];
  /**
   * External permission handler. Delegates to PermissionQueue so
   * the modal UI can present the request to the user. If omitted,
   * AcpClient will reject all permission requests (Property 3.1).
   */
  onPermissionRequest?: (
    params: AcpPermissionRequestParams,
  ) => Promise<AcpPermissionResult>;
  /** Injected fs capability handlers for read/write routing. */
  fsHandler?: AcpFsHandlers;
  /** Injected terminal capability handler for terminal/create routing. */
  terminalHandler?: AcpTerminalHandlers;
  /** Optional client hooks used by Node tests. */
  testHooks?: AcpClientTestHooks;
  /**
   * Called when the underlying child process exits. Used by
   * AgentManager for active-map cleanup and error event emission.
   */
  onExit?: (info: AcpExitInfo) => void;
}

export class AcpAgentSource implements AgentEventSource {
  readonly name: string;
  private readonly agentLabel: string;
  private readonly defaultCwd: string;
  private readonly transportFactory: () => AcpTransport;
  private readonly clientInfo: AcpClientOptions['clientInfo'];
  private readonly onPermissionRequest?: (
    params: AcpPermissionRequestParams,
  ) => Promise<AcpPermissionResult>;
  private readonly fsHandler?: AcpFsHandlers;
  private readonly terminalHandler?: AcpTerminalHandlers;
  private readonly testHooks?: AcpClientTestHooks;
  private readonly onExit?: (info: AcpExitInfo) => void;

  private client: AcpClient | null = null;
  private publish: AgentEventPublisher | null = null;
  private readonly sessions: AcpSessionMapper;
  private readonly restoringServerSessionIds = new Set<string>();
  private readonly importingServerSessionIds = new Map<string, AgentEvent[]>();

  constructor(options: AcpAgentSourceOptions) {
    this.name = options.name;
    this.agentLabel = options.agentLabel;
    this.defaultCwd = options.cwd;
    this.transportFactory = options.transportFactory;
    this.clientInfo = options.clientInfo;
    this.onPermissionRequest = options.onPermissionRequest;
    this.fsHandler = options.fsHandler;
    this.terminalHandler = options.terminalHandler;
    this.testHooks = options.testHooks;
    this.onExit = options.onExit;
    this.sessions = new AcpSessionMapper(options.agentId);
  }

  async start(publish: AgentEventPublisher): Promise<void> {
    if (this.client) {
      // Idempotent. The bus would have stopped any previous source
      // before re-adding under the same name; this branch only fires
      // for direct callers.
      return;
    }
    this.publish = publish;
    const client = this.createClient();
    this.client = client;

    try {
      await client.start();
    } catch (error) {
      this.client = null;
      this.emitError(`Failed to start agent: ${describe(error)}`);
      throw error;
    }
  }

  /**
   * Create a logical ACP session on the already-started agent process.
   * Returns the server-assigned id; the panel namespaces it by agent.
   */
  async newSession(cwd = this.defaultCwd): Promise<string> {
    const client = this.requireClient();
    const serverSessionId = await client.newSession(cwd);
    const panelSessionId = this.panelSessionIdForServer(serverSessionId);
    this.publishSessionState(panelSessionId, 'awaiting-input', `${this.agentLabel} ready`);
    return serverSessionId;
  }

  async listSessions(input: { cwd?: string; cursor?: string }): Promise<AcpSessionInfo[]> {
    const client = this.requireClient();
    const sessions: AcpSessionInfo[] = [];
    let cursor = input.cursor;
    while (true) {
      const result = await client.listSessions({ cwd: input.cwd, cursor });
      sessions.push(...result.sessions);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return sessions;
  }

  async importSessionTranscript(serverSessionId: string, cwd = this.defaultCwd): Promise<AgentEvent[]> {
    const client = this.requireClient();
    const events: AgentEvent[] = [];
    this.panelSessionIdForServer(serverSessionId);
    this.importingServerSessionIds.set(serverSessionId, events);
    try {
      await client.loadSession(serverSessionId, cwd);
      return events;
    } catch (error) {
      this.emitError(describe(error), this.panelSessionIdForServer(serverSessionId));
      throw error;
    } finally {
      this.importingServerSessionIds.delete(serverSessionId);
    }
  }

  /**
   * Restore a persisted ACP session so future prompts continue the
   * original conversation rather than forking into a new session.
   */
  async loadSession(serverSessionId: string, cwd = this.defaultCwd): Promise<void> {
    const client = this.requireClient();
    const panelSessionId = this.panelSessionIdForServer(serverSessionId);
    this.publishSessionState(panelSessionId, 'running', 'Loading session');
    this.restoringServerSessionIds.add(serverSessionId);
    try {
      await client.loadSession(serverSessionId, cwd);
      this.publishSessionState(panelSessionId, 'awaiting-input', `${this.agentLabel} ready`);
    } catch (error) {
      this.emitError(describe(error), panelSessionId);
      throw error;
    } finally {
      this.restoringServerSessionIds.delete(serverSessionId);
    }
  }

  /**
   * Send a user prompt to the agent. Resolves when the turn ends.
   * Throws if the source has not been started.
   */
  async submitPrompt(serverSessionId: string, text: string): Promise<void> {
    const client = this.requireClient();
    const panelSessionId = this.panelSessionIdForServer(serverSessionId);

    if (this.publish) {
      this.publish({
        kind: 'session-state',
        sessionId: panelSessionId,
        state: 'running',
        detail: 'Working',
      });
      // Echo the user's message so the transcript captures both
      // sides of the conversation.
      this.publish({
        kind: 'text',
        sessionId: panelSessionId,
        channel: 'final',
        delta: `\n\n**You:** ${text}\n\n`,
      });
      this.publish({
        kind: 'text-done',
        sessionId: panelSessionId,
        channel: 'final',
      });
    }

    let stopReason;
    try {
      stopReason = await client.prompt(serverSessionId, text);
    } catch (error) {
      this.emitError(describe(error), panelSessionId);
      return;
    }

    if (this.publish) {
      this.publish(adaptStopReason(panelSessionId, stopReason));
    }
  }

  /** Send a `session/cancel` notification to the agent. */
  cancelTurn(serverSessionId: string): void {
    if (!this.client) return;
    this.client.cancel(serverSessionId);
  }

  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.stop('source stop');
      } catch {
        // The transport is best-effort during teardown; do not throw.
      }
    }
    this.publishSessionStateForAll('finished', 'Disconnected');
    this.client = null;
    this.publish = null;
    this.sessions.clear();
  }

  /* -----------------------------------------------------------------
   * Internals
   * ---------------------------------------------------------------*/

  /**
   * Handle transport close. Emits a session-state event and invokes
   * the onExit callback so AgentManager can clean up the active map.
   */
  private handleClose(reason: string): void {
    this.publishSessionStateForAll('finished', reason);
    this.client = null;
    if (this.onExit) {
      // Parse exit code/signal from the reason string if available.
      // The transport typically formats as "process exited (code N)"
      // or "process killed (signal SIGTERM)".
      const codeMatch = /exited?\s*\((?:code\s*)?(\d+)\)/i.exec(reason);
      const signalMatch = /killed?\s*\((?:signal\s*)?(\w+)\)/i.exec(reason);
      this.onExit({
        code: codeMatch ? parseInt(codeMatch[1], 10) : null,
        signal: signalMatch ? signalMatch[1] : null,
        reason,
      });
    }
  }

  private createClient(): AcpClient {
    return new AcpClient({
      transport: this.transportFactory(),
      clientInfo: this.clientInfo,
      ...this.testHooks,
      callbacks: {
        onSessionUpdate: (notification) => this.handleSessionUpdate(notification),
        onPermissionRequest: this.onPermissionRequest
          ? (params) => this.onPermissionRequest!(this.withPanelSession(params))
          : undefined,
        fsHandler: this.createFsHandlers(),
        terminalHandler: this.createTerminalHandlers(),
        onLog: (text) => this.emitLog(text),
        onError: (error) => this.emitError(error.message),
        onClose: (reason) => this.handleClose(reason),
      },
    });
  }

  private createFsHandlers(): AcpFsHandlers | undefined {
    if (!this.fsHandler) return undefined;
    return {
      readTextFile: (req) => this.fsHandler!.readTextFile(this.withPanelSession(req)),
      writeTextFile: (req) => this.fsHandler!.writeTextFile(this.withPanelSession(req)),
    };
  }

  private createTerminalHandlers(): AcpTerminalHandlers | undefined {
    if (!this.terminalHandler) return undefined;
    return {
      create: (req) => this.terminalHandler!.create(this.withPanelSession(req)),
    };
  }

  private handleSessionUpdate(notification: AcpSessionUpdateNotification): void {
    const sessionId = this.panelSessionIdForServer(notification.sessionId);
    const importEvents = this.importingServerSessionIds.get(notification.sessionId);
    if (importEvents) {
      importEvents.push(...adaptAcpUpdate({
        sessionId,
        update: notification.update,
        includeUserMessages: true,
      }));
      return;
    }
    if (this.restoringServerSessionIds.has(notification.sessionId)) return;
    if (!this.publish) return;
    const events = adaptAcpUpdate({
      sessionId,
      update: notification.update,
    });
    for (const event of events) this.publish(event);
  }

  private requireClient(): AcpClient {
    if (!this.client) throw new Error('ACP agent source has not been started yet');
    return this.client;
  }

  private panelSessionIdForServer(serverSessionId: string): AgentSessionId {
    return this.sessions.panelIdFor(serverSessionId);
  }

  private withPanelSession<T extends { readonly sessionId: string }>(value: T): T {
    return {
      ...value,
      sessionId: this.panelSessionIdForServer(value.sessionId),
    };
  }

  private publishSessionState(
    sessionId: AgentSessionId,
    state: AgentSessionState,
    detail: string,
  ): void {
    this.publish?.({ kind: 'session-state', sessionId, state, detail });
  }

  private publishSessionStateForAll(
    state: AgentSessionState,
    detail: string,
  ): void {
    for (const sessionId of this.sessions.all()) {
      this.publishSessionState(sessionId, state, detail);
    }
  }

  private emitError(message: string, sessionId = this.sessions.latest()): void {
    if (!this.publish || !sessionId) return;
    this.publish({
      kind: 'error',
      sessionId,
      message,
    });
  }

  private emitLog(text: string): void {
    const sessionId = this.sessions.latest();
    if (!this.publish || !sessionId) return;
    // Stderr lines feel like background diagnostics; we render them
    // as low-importance text in the thought channel so they do not
    // crowd the main reply but remain inspectable.
    this.publish({
      kind: 'text',
      sessionId,
      channel: 'thought',
      delta: `${text}\n`,
    });
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
