/**
 * Multi-ACP-agent lifecycle controller.
 *
 * `AgentManager` is the single control point for spawning, reusing,
 * and tearing down ACP agent connections. It satisfies:
 *
 * - **Req 1 AC 1-8**: lazy start, reuse, independent source names,
 *   exit handling, parallel stopAll, sync id query, in-flight dedup,
 *   FileSystemAdapter guard.
 * - **Property 1.1**: closing agent A does not affect agent B.
 * - **Property 1.2**: concurrent `ensureStarted` calls share one
 *   in-flight Promise and produce exactly one spawn.
 * - **Property 1.3**: after `stopAll`, active map is empty.
 * - **Property 1.4**: source names are unique (`acp:<agentId>`).
 * - **Req 2 AC 10**: config change subscription triggers stop /
 *   restart-hint for affected agents.
 */

import { FileSystemAdapter } from 'obsidian';
import type { AgentEventBus } from './agentEventBus';
import type { AgentEvent } from './agentEventTypes';
import type { AcpSessionInfo } from './acp/acpProtocol';
import type { SettingsAccessor } from '@/settings/settingsAccessor';
import type { PermissionQueue } from './permissionQueue';
import type { FsCapabilityHandler } from './acp/fsCapabilityHandler';
import type { TerminalCapabilityHandler } from './acp/terminalCapabilityHandler';
import type { AcpExitInfo } from './acp/acpAgentSource';
import { AcpAgentSource } from './acp/acpAgentSource';
import type { AcpClientOptions } from './acp/acpClient';
import { AcpChildProcessTransport } from './acp/childProcessTransport';
import type { AgentDiff } from './agentConfig';
import { debugLog } from '@/utils/logger';
import { AgentOperationTracker } from './agentOperationTracker';

/* ---- Public types ------------------------------------------------*/

export interface AgentManagerDeps {
  readonly bus: AgentEventBus;
  readonly settings: SettingsAccessor;
  readonly vaultAdapter: unknown;
  readonly permissionQueue: PermissionQueue;
  readonly fsHandler: FsCapabilityHandler;
  readonly terminalHandler: TerminalCapabilityHandler;
  readonly clientInfo: AcpClientOptions['clientInfo'];
}

export interface PromptInput {
  readonly enrichedPrompt: string;
  readonly displayText: string;
}

interface ActiveAgent {
  readonly agentId: string;
  readonly source: AcpAgentSource;
  readonly sourceName: string;
  readonly startedAt: number;
}

/* ---- Implementation ----------------------------------------------*/

export class AgentManager {
  private readonly active = new Map<string, ActiveAgent>();
  private readonly inflight = new Map<string, Promise<ActiveAgent>>();
  private readonly operations = new AgentOperationTracker();
  private readonly configUnsub: () => void;
  private disposed = false;

  private readonly bus: AgentEventBus;
  private readonly settings: SettingsAccessor;
  private readonly vaultAdapter: unknown;
  private readonly permissionQueue: PermissionQueue;
  private readonly fsHandler: FsCapabilityHandler;
  private readonly terminalHandler: TerminalCapabilityHandler;
  private readonly clientInfo: AcpClientOptions['clientInfo'];

  constructor(deps: AgentManagerDeps) {
    this.bus = deps.bus;
    this.settings = deps.settings;
    this.vaultAdapter = deps.vaultAdapter;
    this.permissionQueue = deps.permissionQueue;
    this.fsHandler = deps.fsHandler;
    this.terminalHandler = deps.terminalHandler;
    this.clientInfo = deps.clientInfo;

    // Subscribe to agent config changes (Req 2 AC 10)
    this.configUnsub = this.settings.onAgentsChange((diff) => {
      this.handleConfigChange(diff);
    });
  }

  /**
   * Lazily start an agent, reusing an existing connection or sharing
   * an in-flight startup Promise (Property 1.2 / Req 1 AC 2 / AC 7).
   */
  async ensureStarted(agentId: string): Promise<ActiveAgent> {
    if (this.disposed) {
      throw new Error('AgentManager disposed');
    }

    // Reuse existing active connection (Req 1 AC 2)
    const existing = this.active.get(agentId);
    if (existing) return existing;

    // Share in-flight Promise for concurrent calls (Req 1 AC 7)
    const pending = this.inflight.get(agentId);
    if (pending) return pending;

    const config = this.settings.getAgent(agentId);
    if (!config || !config.enabled) {
      throw new Error(`Agent "${agentId}" is not configured or not enabled`);
    }

    // Guard: require desktop FileSystemAdapter (Req 1 AC 8)
    if (!(this.vaultAdapter instanceof FileSystemAdapter)) {
      throw new Error(
        'ACP agents require a desktop vault with FileSystemAdapter. ' +
        'This environment does not support spawning agent processes.',
      );
    }

    const cwd = this.vaultAdapter.getBasePath();
    const sourceName = `acp:${agentId}`;

    const startPromise = (async (): Promise<ActiveAgent> => {
      const source = new AcpAgentSource({
        name: sourceName,
        agentId,
        agentLabel: config.label,
        cwd,
        transportFactory: () => new AcpChildProcessTransport({
          command: config.command,
          args: config.args ? [...config.args] : [],
          cwd,
          env: config.env
            ? { ...process.env, ...config.env }
            : undefined,
        }),
        clientInfo: this.clientInfo,
        onPermissionRequest: async (params) => {
          const outcome = await this.permissionQueue.enqueue(agentId, params);
          return { outcome };
        },
        fsHandler: this.fsHandler.forAgent(agentId),
        terminalHandler: this.terminalHandler.forAgent(agentId),
        onExit: (info) => this.handleExit(agentId, info),
      });

      // Register with bus — this calls source.start() internally
      await this.bus.addSource(source);

      const active: ActiveAgent = {
        agentId,
        source,
        sourceName,
        startedAt: performance.now(),
      };
      this.active.set(agentId, active);
      debugLog(`[AgentManager] started agent "${agentId}" as "${sourceName}"`);
      return active;
    })();

    this.inflight.set(agentId, startPromise);
    try {
      return await startPromise;
    } finally {
      this.inflight.delete(agentId);
    }
  }

  /**
   * Stop a single agent. Idempotent — no-op if not active.
   * Removes from active map first to avoid races (Property 1.1).
   */
  async stop(agentId: string): Promise<void> {
    const active = this.active.get(agentId);
    if (!active) return;
    this.active.delete(agentId);
    await this.bus.removeSource(active.sourceName);
    debugLog(`[AgentManager] stopped agent "${agentId}"`);
  }

  async stopIfIdle(agentId: string): Promise<boolean> {
    if (!this.operations.isIdle(agentId)) {
      return false;
    }
    await this.stop(agentId);
    return true;
  }

  /**
   * Stop all active agents in parallel. After this call the manager
   * is disposed and `ensureStarted` will throw (Property 1.3).
   */
  async stopAll(): Promise<void> {
    this.disposed = true;
    this.configUnsub();
    const ids = [...this.active.keys()];
    await Promise.allSettled(ids.map((id) => this.stop(id)));
    this.active.clear();
    this.inflight.clear();
    debugLog('[AgentManager] stopAll complete');
  }

  /**
   * Create a new ACP session on the given agent. Starts the agent
   * if not already running.
   */
  async newSession(agentId: string, opts: { cwd: string }): Promise<string> {
    return this.withActiveAgent(agentId, (active) => active.source.newSession(opts.cwd));
  }

  async listSessions(agentId: string, opts: { cwd?: string }): Promise<AcpSessionInfo[]> {
    return this.withActiveAgent(agentId, (active) => active.source.listSessions(opts));
  }

  async importSessionTranscript(
    agentId: string,
    sessionId: string,
    opts: { cwd: string },
  ): Promise<AgentEvent[]> {
    return this.withActiveAgent(agentId, (active) => active.source.importSessionTranscript(sessionId, opts.cwd));
  }

  /**
   * Restore a persisted ACP session on the given agent. Starts the
   * agent if needed, then asks the agent to reload its own context.
   */
  async loadSession(agentId: string, sessionId: string, opts: { cwd: string }): Promise<void> {
    await this.withActiveAgent(agentId, (active) => active.source.loadSession(sessionId, opts.cwd));
  }

  async loadSessionAndSendPrompt(
    agentId: string,
    sessionId: string,
    opts: {
      readonly cwd: string;
      readonly prompt: PromptInput;
    },
  ): Promise<void> {
    await this.withActiveAgent(agentId, async (active) => {
      await active.source.loadSession(sessionId, opts.cwd);
      await active.source.submitPrompt(sessionId, opts.prompt.enrichedPrompt);
    });
  }

  /**
   * Send a prompt to the active agent session. Starts the agent
   * lazily if it is not already running.
   */
  async sendPrompt(
    agentId: string,
    sessionId: string,
    input: PromptInput,
  ): Promise<void> {
    await this.withActiveAgent(agentId, (active) => active.source.submitPrompt(sessionId, input.enrichedPrompt));
  }

  /**
   * Cancel the current turn on the given agent session.
   * No-op if the agent is not active.
   */
  cancel(agentId: string, sessionId: string): void {
    const active = this.active.get(agentId);
    if (!active) return;
    active.source.cancelTurn(sessionId);
  }

  /**
   * Synchronous snapshot of active agent ids in registration order
   * (Req 1 AC 6).
   */
  getActiveAgentIds(): readonly string[] {
    return [...this.active.keys()];
  }

  isStarted(agentId: string): boolean {
    return this.active.has(agentId);
  }

  private async withActiveAgent<T>(
    agentId: string,
    action: (active: ActiveAgent) => Promise<T>,
  ): Promise<T> {
    const lease = this.operations.acquire(agentId);
    try {
      const active = await this.ensureStarted(agentId);
      return await action(active);
    } finally {
      lease.release();
    }
  }

  /* ---- Internal: exit handling (Req 1 AC 4 / Req 9 AC 2) ---------*/

  private handleExit(agentId: string, exit: AcpExitInfo): void {
    const active = this.active.get(agentId);
    if (!active) return;
    this.active.delete(agentId);
    // Do not call bus.removeSource here — the source's handleClose
    // already emits session-state events. We just clean the map.
    debugLog(
      `[AgentManager] agent "${agentId}" exited: ` +
      `code=${exit.code ?? 'null'}, signal=${exit.signal ?? 'null'}`,
    );
  }

  /* ---- Internal: config change handling (Req 2 AC 10) ------------*/

  private handleConfigChange(diff: AgentDiff): void {
    // Stop removed or disabled agents
    for (const id of diff.removed) {
      void this.stop(id);
    }
    for (const id of diff.disabled) {
      void this.stop(id);
    }

    // For agents whose command/args changed, log a restart hint.
    // The UI layer subscribes to settings.onAgentsChange directly
    // to show a "restart required" banner. We do NOT auto-restart
    // to avoid surprising the user mid-session.
    for (const id of diff.commandOrArgsChanged) {
      if (!this.active.has(id)) continue;
      debugLog(
        `[AgentManager] agent "${id}" command/args changed — restart required`,
      );
    }
    // Added agents are not auto-started (lazy start semantics)
  }
}
