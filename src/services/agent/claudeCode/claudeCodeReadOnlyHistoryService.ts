/**
 * Read-only history service for Claude Code sessions.
 *
 * Responsibilities:
 *   - List sessions (via {@link ClaudeCodeJsonlReader})
 *   - Load a transcript (via reader + adapter)
 *
 * This service only reads from disk — it does NOT spawn any child
 * processes or maintain active connections. All live interaction
 * with Claude Code is handled via ACP through AgentManager.
 */

import { ClaudeCodeJsonlReader, type ClaudeSessionListEntry } from './claudeCodeJsonlReader.ts';
import { adaptClaudeTranscriptToEvents } from './claudeCodeMessageAdapter.ts';
import type { AgentEvent, AgentSessionId } from '../../agentStream/agentEventTypes.ts';

export type ClaudeCodeSession = ClaudeSessionListEntry;

export interface ReadOnlyHistoryService {
  listSessions(opts: { vaultRoot: string }): ClaudeSessionListEntry[];
  loadTranscript(sessionId: string): AgentEvent[];
}

export interface ClaudeCodeReadOnlyHistoryServiceOptions {
  /** Absolute vault root path. */
  vaultPath: string;
}

export class ClaudeCodeReadOnlyHistoryService implements ReadOnlyHistoryService {
  private readonly reader: ClaudeCodeJsonlReader;
  private readonly vaultPath: string;

  constructor(options: ClaudeCodeReadOnlyHistoryServiceOptions) {
    this.vaultPath = options.vaultPath;
    this.reader = new ClaudeCodeJsonlReader(this.vaultPath);
  }

  /**
   * List all sessions for the current vault, sorted by most recently
   * updated first.
   */
  listSessions(_opts?: { vaultRoot: string }): ClaudeSessionListEntry[] {
    return this.reader.listSessions();
  }

  /**
   * Load a full transcript and return it as AgentEvents ready for
   * `AgentSessionModel.applyEventsBatch`.
   */
  loadTranscript(claudeSessionId: string, internalSessionId?: AgentSessionId): AgentEvent[] {
    const sid = internalSessionId ?? `claude-code:${claudeSessionId}`;
    const { messages } = this.reader.loadTranscript(claudeSessionId);
    return adaptClaudeTranscriptToEvents(sid, messages);
  }
}
