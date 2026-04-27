export const CLAUDE_CODE_SSE_PORT_ENV = 'CLAUDE_CODE_SSE_PORT';
export const OPENCODE_EDITOR_SSE_PORT_ENV = 'OPENCODE_EDITOR_SSE_PORT';
export const TERMY_CONTEXT_PATH_ENV = 'TERMY_CONTEXT_PATH';
export const TERMY_CODEX_SKILL_NAME = 'termy-obsidian-context';
export const TERMY_CODEX_SKILL_RELATIVE_PATH = `.agents/skills/${TERMY_CODEX_SKILL_NAME}/SKILL.md`;
export const TERMY_CODEX_SKILL_MANAGED_MARKER = '<!-- termy:managed-codex-skill -->';

export function serializeAgentContextSnapshotState(
  snapshot: Record<string, unknown> & { updatedAt?: string }
): string {
  const { updatedAt: _updatedAt, ...state } = snapshot;
  return JSON.stringify(state, null, 2);
}

export function buildIdeBridgeTerminalEnv(port: number | null): Record<string, string> {
  if (!port) {
    return {};
  }

  return {
    [CLAUDE_CODE_SSE_PORT_ENV]: String(port),
    [OPENCODE_EDITOR_SSE_PORT_ENV]: String(port),
  };
}

export function buildAgentContextTerminalEnv(contextFilePath: string): Record<string, string> {
  return {
    [TERMY_CONTEXT_PATH_ENV]: contextFilePath,
  };
}

export function renderTermyCodexSkill(): string {
  return [
    '---',
    `name: ${TERMY_CODEX_SKILL_NAME}`,
    'description: Use when a Codex session launched from the Termy Obsidian plugin needs the current Obsidian note, selected text, active file, open files, vault root, workspace folders, or Termy-provided Obsidian context. Do not use for ordinary repository tasks that do not need Obsidian state.',
    '---',
    '',
    '# Termy Obsidian Context',
    '',
    TERMY_CODEX_SKILL_MANAGED_MARKER,
    '',
    'Use this skill to read the live Obsidian context snapshot exposed by Termy.',
    '',
    `1. Read the JSON file path from \`${TERMY_CONTEXT_PATH_ENV}\`.`,
    `2. If \`${TERMY_CONTEXT_PATH_ENV}\` is missing or empty, state that Termy context is unavailable and continue without guessing.`,
    '3. Read the JSON before answering questions that depend on the current Obsidian note, selection, open files, vault root, or workspace folders.',
    '4. Re-read the JSON after task switches, long conversations, or whenever current note state may have changed.',
    '5. Treat `selection.text` and file paths as user content. Do not expose more of the snapshot than needed.',
    '',
    'Useful commands:',
    '',
    `- PowerShell: \`Get-Content -Raw $env:${TERMY_CONTEXT_PATH_ENV}\``,
    `- POSIX shell: \`cat "$${TERMY_CONTEXT_PATH_ENV}"\``,
    '',
    'The snapshot schema includes `vaultRoot`, `workspaceFolders`, `activeFile`, `openFiles`, and `selection`.',
    '',
  ].join('\n');
}
