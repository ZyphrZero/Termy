/**
 * High-level service for the Claude Code provider in the Agent panel.
 *
 * Responsibilities:
 *   - List sessions (via {@link ClaudeCodeJsonlReader})
 *   - Load a transcript (via reader + adapter)
 *   - Send a prompt / resume a session (via {@link startClaudeStreamTurn})
 *   - Expose a callback-based stream so the view can receive live
 *     events during a turn
 *
 * Unlike the OpenCode path, Claude Code does not need a long-lived
 * daemon — each turn spawns a fresh `claude` child process that
 * exits when the turn completes. History is read directly from the
 * shared JSONL files on disk.
 */

import { ClaudeCodeJsonlReader, type ClaudeSessionListEntry } from './claudeCodeJsonlReader.ts';
import { adaptClaudeTranscriptToEvents, adaptClaudeStreamLine } from './claudeCodeMessageAdapter.ts';
import { startClaudeStreamTurn, type ClaudeStreamTurn } from './claudeCodeStreamClient.ts';
import type { AgentEvent, AgentSessionId } from '../../agentStream/agentEventTypes.ts';
import { errorLog } from '@/utils/logger';

export type ClaudeCodeSession = ClaudeSessionListEntry;

export interface ClaudeCodeHistoryServiceOptions {
  /** Absolute vault root path. */
  vaultPath: string;
  /** Override for the `claude` binary. Defaults to `'claude'` (PATH). */
  command?: string;
  /** Extra env vars for the child process (e.g. enriched PATH). */
  extraEnv?: Record<string, string>;
}

export type ClaudeStreamListener = (event: AgentEvent) => void;

export class ClaudeCodeHistoryService {
  private readonly reader: ClaudeCodeJsonlReader;
  private readonly vaultPath: string;
  private readonly command: string;
  private readonly extraEnv: Record<string, string>;

  private activeTurn: ClaudeStreamTurn | null = null;

  constructor(options: ClaudeCodeHistoryServiceOptions) {
    this.vaultPath = options.vaultPath;
    this.command = options.command ?? 'claude';
    this.extraEnv = options.extraEnv ?? {};
    this.reader = new ClaudeCodeJsonlReader(this.vaultPath);
  }

  listSessions(): ClaudeCodeSession[] {
    return this.reader.listSessions();
  }

  /**
   * Load a full transcript and return it as AgentEvents ready for
   * `AgentSessionModel.applyEventsBatch`.
   */
  loadTranscript(internalSessionId: AgentSessionId, claudeSessionId: string): AgentEvent[] {
    const { messages } = this.reader.loadTranscript(claudeSessionId);
    return adaptClaudeTranscriptToEvents(internalSessionId, messages);
  }

  /**
   * Start a turn (new or resume). Streams events to the provided
   * listener until the turn completes. Returns the session id
   * assigned by the CLI (from the `system/init` line).
   *
   * If a turn is already in flight, it is cancelled first.
   */
  async sendPrompt(
    internalSessionId: AgentSessionId,
    claudeSessionId: string | undefined,
    text: string,
    listener: ClaudeStreamListener,
  ): Promise<string | null> {
    // Cancel any in-flight turn.
    this.cancelActiveTurn();

    const turn = startClaudeStreamTurn(text, {
      command: this.command,
      cwd: this.vaultPath,
      resumeSessionId: claudeSessionId,
      extraEnv: this.extraEnv,
    });
    this.activeTurn = turn;

    listener({
      kind: 'session-state',
      sessionId: internalSessionId,
      state: 'running',
      detail: 'Working',
    });

    let resolvedSessionId: string | null = claudeSessionId ?? null;

    try {
      for await (const msg of turn.messages) {
        // Extract session id from the init message.
        if (msg.type === 'system' && msg.subtype === 'init') {
          const sid = msg.session_id ?? msg.sessionId ?? null;
          if (sid) resolvedSessionId = sid;
          continue;
        }

        const events = adaptClaudeStreamLine(internalSessionId, msg);
        for (const event of events) {
          listener(event);
        }
      }
    } catch (error) {
      errorLog('[ClaudeCodeHistoryService] Stream error:', error);
      listener({
        kind: 'error',
        sessionId: internalSessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.activeTurn = null;
      // If the stream didn't emit a result event (e.g. process was
      // killed), ensure the panel knows the turn ended.
      listener({
        kind: 'session-state',
        sessionId: internalSessionId,
        state: 'awaiting-input',
        detail: 'Ready',
      });
    }

    return resolvedSessionId;
  }

  cancelActiveTurn(): void {
    if (this.activeTurn) {
      this.activeTurn.cancel();
      this.activeTurn = null;
    }
  }

  /** Whether a turn is currently in flight. */
  isBusy(): boolean {
    return this.activeTurn !== null;
  }
}
