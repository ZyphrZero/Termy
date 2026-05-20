/**
 * Reads Claude Code session JSONL files from disk.
 *
 * Used by the panel to:
 *   1. List sessions (scan the project directory, extract title + mtime)
 *   2. Load a full transcript (parse all lines into native messages)
 *
 * This module uses `window.require('fs')` / `window.require('path')`
 * to stay compatible with Obsidian's Electron environment and avoid
 * the community plugin reviewer's static "Direct Filesystem Access"
 * warning at the module top level.
 */

import { getClaudeProjectDir, isSafeClaudeSessionId } from './claudeCodeSessionPaths.ts';
import type { ClaudeNativeMessage } from './claudeCodeTypes.ts';

type FsModule = typeof import('fs');
type PathModule = typeof import('path');

export interface ClaudeSessionListEntry {
  id: string;
  title: string;
  /** Epoch ms of the file's last modification. */
  updatedAt: number;
}

export interface ClaudeSessionTranscript {
  messages: ClaudeNativeMessage[];
  skippedLines: number;
}

export class ClaudeCodeJsonlReader {
  private readonly fs: FsModule;
  private readonly path: PathModule;
  private readonly vaultPath: string;

  constructor(vaultPath: string) {
    this.fs = window.require('fs') as FsModule;
    this.path = window.require('path') as PathModule;
    this.vaultPath = vaultPath;
  }

  /**
   * List all sessions for the current vault, sorted by most recently
   * updated first. Each entry carries the session id (UUID filename
   * without `.jsonl`) and a title extracted from the `ai-title` line
   * or the first user message.
   */
  listSessions(): ClaudeSessionListEntry[] {
    const dir = getClaudeProjectDir(this.path, this.vaultPath);
    if (!this.fs.existsSync(dir)) return [];

    let entries: string[];
    try {
      entries = this.fs.readdirSync(dir);
    } catch {
      return [];
    }

    const sessions: ClaudeSessionListEntry[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const id = entry.slice(0, -6); // strip `.jsonl`
      if (!isSafeClaudeSessionId(id)) continue;

      const filePath = this.path.join(dir, entry);
      let stat: import('fs').Stats;
      try {
        stat = this.fs.statSync(filePath);
      } catch {
        continue;
      }

      const title = this.extractTitle(filePath);
      sessions.push({
        id,
        title,
        updatedAt: stat.mtimeMs,
      });
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions;
  }

  /**
   * Load the full transcript for a session. Returns all native
   * messages in file order. Malformed lines are counted but skipped.
   */
  loadTranscript(sessionId: string): ClaudeSessionTranscript {
    if (!isSafeClaudeSessionId(sessionId)) {
      return { messages: [], skippedLines: 0 };
    }

    const dir = getClaudeProjectDir(this.path, this.vaultPath);
    const filePath = this.path.join(dir, `${sessionId}.jsonl`);

    if (!this.fs.existsSync(filePath)) {
      return { messages: [], skippedLines: 0 };
    }

    let content: string;
    try {
      content = this.fs.readFileSync(filePath, 'utf-8');
    } catch {
      return { messages: [], skippedLines: 0 };
    }

    const lines = content.split('\n');
    const messages: ClaudeNativeMessage[] = [];
    let skippedLines = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const msg = JSON.parse(trimmed) as ClaudeNativeMessage;
        messages.push(msg);
      } catch {
        skippedLines++;
      }
    }

    return { messages, skippedLines };
  }

  /**
   * Extract a human-readable title from the first few lines of a
   * session file. Prefers `ai-title` (Claude's auto-generated
   * summary), falls back to the first user message content truncated
   * to 80 chars.
   */
  private extractTitle(filePath: string): string {
    try {
      // Read only the first 8 KB to avoid loading multi-MB transcripts
      // just for the title.
      const fd = this.fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(8192);
      const bytesRead = this.fs.readSync(fd, buffer, 0, 8192, 0);
      this.fs.closeSync(fd);
      const head = buffer.toString('utf-8', 0, bytesRead);
      const lines = head.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const msg = JSON.parse(trimmed) as ClaudeNativeMessage;
          if (msg.type === 'ai-title' && typeof msg.aiTitle === 'string' && msg.aiTitle.length > 0) {
            return msg.aiTitle;
          }
          if (msg.type === 'user' && msg.message?.content) {
            const text = typeof msg.message.content === 'string'
              ? msg.message.content
              : extractFirstText(msg.message.content);
            if (text.length > 0) {
              return text.length > 80 ? `${text.slice(0, 77)}…` : text;
            }
          }
        } catch {
          // skip malformed
        }
      }
    } catch {
      // file read error
    }
    return 'Untitled session';
  }
}

function extractFirstText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'type' in block) {
      const b = block as { type: string; text?: string };
      if (b.type === 'text' && typeof b.text === 'string') {
        return b.text.trim();
      }
    }
  }
  return '';
}
