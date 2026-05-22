/**
 * Read-only history service for the Codex CLI provider.
 *
 * Backed by the official `codex app-server` daemon (v2 API), this
 * service only exposes listing and transcript loading — no prompt
 * sending, cancellation, or live streaming. Active sessions are now
 * handled exclusively through the ACP path.
 *
 * Responsibilities:
 *   - Lazy-spawn the daemon on first use (`listSessions` or
 *     `loadTranscript`).
 *   - List threads via `thread/list` (cwd-filtered, mtime-sorted).
 *   - Load a thread's transcript via `thread/resume` (which returns
 *     the persisted `turns[]` populated with `ThreadItem`s).
 */

import type { AgentEvent, AgentSessionId } from '../../agentStream/agentEventTypes.ts';
import { CodexAppServerClient } from './codexAppServerClient.ts';
import { adaptThreadTurnsToEvents } from './codexMessageAdapter.ts';
import type {
  Thread,
  ThreadListParams,
  ThreadListResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
} from './codexTypes.ts';

// ─── Public-facing types ─────────────────────────────────────────

/** Display row for the panel's sidebar. */
export interface CodexHistorySession {
  /** Stable thread id (used for resume). */
  threadId: string;
  /** Display title — prefers `Thread.name`, falls back to `Thread.preview`. */
  title: string;
  /** Working directory the thread was created in. */
  cwd: string;
  /** Unix epoch in milliseconds for sorting. */
  updatedAt: number;
}

// ─── Class ───────────────────────────────────────────────────────

export class CodexReadOnlyHistoryService {
  private readonly vaultRoot: string;
  private readonly command: string;
  private readonly clientFactory: () => CodexAppServerClient;

  private client: CodexAppServerClient | null = null;
  private clientPromise: Promise<CodexAppServerClient> | null = null;
  private stopped = false;

  constructor(vaultRoot: string, command?: string) {
    this.vaultRoot = vaultRoot;
    this.command = command ?? 'codex';
    this.clientFactory = () =>
      new CodexAppServerClient({ command: this.command, cwd: this.vaultRoot });
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * List threads under the current vault. Always uses the `thread/list`
   * RPC so we get the same persisted view the official TUI sees.
   */
  async listSessions(): Promise<CodexHistorySession[]> {
    const client = await this.ensureClient();
    const params: ThreadListParams = {
      cwd: this.vaultRoot,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      limit: 100,
    };

    const aggregated: Thread[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.request<ThreadListResponse>('thread/list', {
        ...params,
        cursor,
      });
      aggregated.push(...(page.data ?? []));
      cursor = page.nextCursor ?? undefined;
      // Hard cap to keep UI snappy. Users with thousands of sessions
      // can paginate later via search.
      if (aggregated.length >= 200) break;
    } while (cursor);

    return aggregated.map((thread) => ({
      threadId: thread.id,
      title: pickTitle(thread),
      cwd: thread.cwd,
      updatedAt: secondsToMillis(thread.updatedAt),
    }));
  }

  /**
   * Resume a thread and return the persisted transcript as a single
   * batch of AgentEvents. Does NOT start a turn; the user must send a
   * prompt to do that.
   */
  async loadTranscript(
    internalSessionId: AgentSessionId,
    threadId: string,
  ): Promise<AgentEvent[]> {
    const client = await this.ensureClient();
    const params: ThreadResumeParams = { threadId };
    const response = await client.request<ThreadResumeResponse>('thread/resume', params);
    return adaptThreadTurnsToEvents(internalSessionId, response.thread.turns ?? []);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = null;
    this.clientPromise = null;
    if (client) await client.stop();
  }

  // ─── Private ─────────────────────────────────────────────────────

  private async ensureClient(): Promise<CodexAppServerClient> {
    if (this.stopped) throw new Error('CodexReadOnlyHistoryService is stopped');
    if (this.client && this.client.isRunning()) return this.client;
    if (this.clientPromise) return this.clientPromise;

    this.clientPromise = (async (): Promise<CodexAppServerClient> => {
      const client = this.clientFactory();
      await client.start();
      this.client = client;
      return client;
    })().catch((error) => {
      this.clientPromise = null;
      throw error;
    });

    return this.clientPromise;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function pickTitle(thread: Thread): string {
  const name = thread.name?.trim();
  if (name && name.length > 0) return name;
  const preview = thread.preview?.trim();
  if (preview && preview.length > 0) return preview;
  return 'Untitled session';
}

function secondsToMillis(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.floor(seconds * 1000);
}
