/**
 * Path utilities for `~/.claude/projects/<encoded>/<sessionId>.jsonl`.
 *
 * Claude Code shells out the project name by replacing every
 * non-alphanumeric character in the absolute project path with `-`.
 * Termy talks to the same on-disk store so a session started in the
 * terminal shows up in the panel and vice versa — both the
 * vault-relative `~/.claude/projects/...` location and the encoding
 * scheme have to match exactly.
 */

import { getHomeDir } from '@/utils/platform';

type PathModule = typeof import('path');

/**
 * Encode an absolute path the way Claude Code's CLI does. The CLI
 * replaces every non-`[a-zA-Z0-9]` character (including the drive
 * letter colon, slashes, and any unicode) with a `-`. This also
 * handles UNC and drive-letter paths consistently because it never
 * looks at the path structure — it operates byte-by-byte.
 */
export function encodeVaultPathForClaude(absolutePath: string): string {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Resolve the global `~/.claude/projects` root using Termy's platform helper. */
export function getClaudeProjectsRoot(pathModule: PathModule): string {
  return pathModule.join(getHomeDir(), '.claude', 'projects');
}

/** Vault-scoped project directory containing one jsonl per session. */
export function getClaudeProjectDir(
  pathModule: PathModule,
  vaultPath: string,
): string {
  const absolute = pathModule.resolve(vaultPath);
  return pathModule.join(getClaudeProjectsRoot(pathModule), encodeVaultPathForClaude(absolute));
}

/**
 * Strict guard for ids we splice into a filesystem path. Mirrors the
 * Claudian guard: a session id is only ever a UUID-ish token, so
 * anything containing path separators or `..` is rejected outright.
 */
export function isSafeClaudeSessionId(value: string): boolean {
  if (!value || value.length === 0 || value.length > 128) return false;
  if (value.includes('..') || value.includes('/') || value.includes('\\')) return false;
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

export function getClaudeSessionFile(
  pathModule: PathModule,
  vaultPath: string,
  sessionId: string,
): string {
  if (!isSafeClaudeSessionId(sessionId)) {
    throw new Error(`Invalid Claude Code session id: ${sessionId}`);
  }
  return pathModule.join(getClaudeProjectDir(pathModule, vaultPath), `${sessionId}.jsonl`);
}
