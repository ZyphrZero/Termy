/**
 * High-level glue used by the Agent panel to talk to OpenCode.
 *
 * Responsibilities:
 *   - Lazily start the daemon ({@link OpenCodeServerManager}) and
 *     provide the panel with a ready HTTP client.
 *   - Expose a small async surface tailored to the panel's needs:
 *     `listSessions`, `loadTranscript`, `createSession`, `sendPrompt`,
 *     `subscribeBus`.
 *   - Keep one shared event-stream subscription open and fan out
 *     decoded events to whoever is currently focused on a session
 *     in the UI. The panel does not reconnect on every session
 *     switch.
 *
 * What this file does *not* do:
 *   - It does not own the {@link AgentSessionModel}. The panel
 *     creates its own and feeds it adapted events.
 *   - It does not understand Claude Code or any other provider.
 *     That is what {@link AgentProviderId} is for; a Claude variant
 *     of this service will live under `services/agent/claudeCode/`
 *     once the stream-json source lands.
 */

import {
  type OpenCodeBusEvent,
  type OpenCodeMessageWithParts,
  OpenCodeHttpClient,
  type OpenCodeSessionInfo,
} from './opencodeHttpClient.ts';
import { OpenCodeServerManager, type OpenCodeServerHandle } from './opencodeServerManager.ts';
import { debugLog, errorLog } from '@/utils/logger';

export type OpenCodeHistorySession = OpenCodeSessionInfo;

export interface OpenCodeHistoryServiceOptions {
  /** Vault root, used as the OpenCode workspace directory. */
  vaultRoot: string;
  /** Optional override; defaults to `'opencode'` (resolved on PATH). */
  command?: string;
}

type BusListener = (event: OpenCodeBusEvent) => void;

export class OpenCodeHistoryService {
  private readonly server: OpenCodeServerManager;
  private readonly directory: string;

  private client: OpenCodeHttpClient | null = null;
  private clientPromise: Promise<OpenCodeHttpClient> | null = null;
  private busTask: { close: () => void } | null = null;
  private readonly listeners = new Set<BusListener>();
  private stopped = false;

  constructor(options: OpenCodeHistoryServiceOptions) {
    this.directory = options.vaultRoot;
    this.server = new OpenCodeServerManager({
      command: options.command,
      cwd: options.vaultRoot,
    });
  }

  async listSessions(): Promise<OpenCodeHistorySession[]> {
    const client = await this.ensureClient();
    return client.listSessions();
  }

  async loadTranscript(sessionId: string): Promise<OpenCodeMessageWithParts[]> {
    const client = await this.ensureClient();
    return client.getMessages(sessionId);
  }

  async createSession(payload: { title?: string } = {}): Promise<OpenCodeHistorySession> {
    const client = await this.ensureClient();
    return client.createSession(payload);
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    const client = await this.ensureClient();
    await client.sendPromptAsync(sessionId, {
      parts: [{ type: 'text', text }],
    });
  }

  /**
   * Subscribe to bus events. Returns an unsubscribe function. The
   * service multiplexes a single `/event` connection across all
   * subscribers — the daemon's bus is global so every consumer sees
   * the same stream and filters client-side.
   */
  subscribeBus(listener: BusListener): () => void {
    this.listeners.add(listener);
    void this.ensureBusTask();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.busTask?.close();
        this.busTask = null;
      }
    };
  }

  /** Whether the daemon has finished its startup banner. */
  isReady(): boolean {
    return this.server.isRunning() && this.client !== null;
  }

  getServerHandleForTesting(): OpenCodeServerHandle | null {
    return this.server.getHandle();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.busTask?.close();
    this.busTask = null;
    this.listeners.clear();
    this.client = null;
    this.clientPromise = null;
    await this.server.stop();
  }

  private async ensureClient(): Promise<OpenCodeHttpClient> {
    if (this.stopped) {
      throw new Error('OpenCodeHistoryService is stopped');
    }
    if (this.client) return this.client;
    if (this.clientPromise) return this.clientPromise;

    this.clientPromise = (async (): Promise<OpenCodeHttpClient> => {
      const handle = await this.server.start();
      const client = new OpenCodeHttpClient({ handle, directory: this.directory });
      this.client = client;
      return client;
    })().catch((error) => {
      this.clientPromise = null;
      throw error;
    });
    return this.clientPromise;
  }

  private async ensureBusTask(): Promise<void> {
    if (this.busTask || this.stopped) return;
    let client: OpenCodeHttpClient;
    try {
      client = await this.ensureClient();
    } catch (error) {
      errorLog('[OpenCodeHistoryService] Failed to start daemon for event stream:', error);
      return;
    }
    if (this.stopped || this.busTask) return;

    const stream = client.openEventStream();
    this.busTask = { close: stream.close };

    void (async () => {
      try {
        for await (const event of stream.events) {
          if (this.stopped) break;
          for (const listener of [...this.listeners]) {
            try {
              listener(event);
            } catch (listenerError) {
              errorLog('[OpenCodeHistoryService] Bus listener threw:', listenerError);
            }
          }
        }
      } catch (error) {
        if (!this.stopped) {
          errorLog('[OpenCodeHistoryService] Event stream ended unexpectedly:', error);
        }
      } finally {
        if (this.busTask) {
          this.busTask = null;
          if (!this.stopped && this.listeners.size > 0) {
            // Try once to reconnect; if it fails again the listeners
            // will see no events until the user refreshes the panel.
            debugLog('[OpenCodeHistoryService] Reconnecting event stream…');
            void this.ensureBusTask();
          }
        }
      }
    })();
  }
}
