export const CLAUDE_CODE_SSE_PORT_ENV = 'CLAUDE_CODE_SSE_PORT';
export const OPENCODE_EDITOR_SSE_PORT_ENV = 'OPENCODE_EDITOR_SSE_PORT';
export const TERMY_CONTEXT_PATH_ENV = 'TERMY_CONTEXT_PATH';
export const TERMY_CODEX_SKILL_NAME = 'termy-obsidian-context';
export const TERMY_CODEX_SKILL_RELATIVE_PATH = `.agents/skills/${TERMY_CODEX_SKILL_NAME}/SKILL.md`;
export const TERMY_CODEX_SKILL_MANAGED_MARKER = '<!-- termy:managed-codex-skill -->';

export const TERMY_DEEPSEEK_SKILL_NAME = 'termy-obsidian-context';
export const TERMY_DEEPSEEK_SKILL_RELATIVE_PATH = `.deepseek/skills/${TERMY_DEEPSEEK_SKILL_NAME}/SKILL.md`;
export const TERMY_DEEPSEEK_SKILL_MANAGED_MARKER = '<!-- termy:managed-deepseek-skill -->';

export function serializeAgentContextSnapshotState(
  snapshot: Record<string, unknown> & { updatedAt?: string }
): string {
  const state = { ...snapshot };
  delete state.updatedAt;
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

/**
 * Render the DeepSeek TUI skill file content.
 *
 * Unlike the Codex skill (which relies on the `TERMY_CONTEXT_PATH` env var),
 * this skill embeds the absolute path to the context JSON file directly.
 * DeepSeek TUI's `child_env.rs` strips non-allowlisted env vars from child
 * processes, so the `read_file` tool cannot access `TERMY_CONTEXT_PATH` via
 * shell expansion. Embedding the path lets DeepSeek TUI's `read_file` tool
 * read the snapshot directly without env var dependency.
 */
export function renderTermyDeepSeekSkill(contextFilePath: string): string {
  return [
    '---',
    `name: ${TERMY_DEEPSEEK_SKILL_NAME}`,
    'description: Use when a DeepSeek TUI session launched from the Termy Obsidian plugin needs the current Obsidian note, selected text, active file, open files, vault root, workspace folders, or Termy-provided Obsidian context. Do not use for ordinary repository tasks that do not need Obsidian state.',
    '---',
    '',
    '# Termy Obsidian Context',
    '',
    TERMY_DEEPSEEK_SKILL_MANAGED_MARKER,
    '',
    'Use this skill to read the live Obsidian context snapshot exposed by Termy.',
    '',
    '## Context file',
    '',
    `The context JSON is written to the following absolute path:`,
    '',
    `\`${contextFilePath}\``,
    '',
    '## Instructions',
    '',
    `1. Read the file at the path above using \`read_file\` (preferred) or a shell command.`,
    '2. If the file does not exist or is empty, state that Termy context is unavailable and continue without guessing.',
    '3. Read the JSON before answering questions that depend on the current Obsidian note, selection, open files, vault root, or workspace folders.',
    '4. Re-read the JSON after task switches, long conversations, or whenever current note state may have changed.',
    '5. Treat `selection.text` and file paths as user content. Do not expose more of the snapshot than needed.',
    '',
    '## Schema',
    '',
    'The snapshot JSON includes:',
    '- `vaultRoot` — absolute path to the Obsidian vault root',
    '- `workspaceFolders` — array of workspace folder paths',
    '- `activeFile` — the currently focused file (`filePath`, `vaultPath`, `fileUrl`, `hasFocus`)',
    '- `openFiles` — all open markdown files with their paths and active state',
    '- `selection` — current editor selection (`text`, `isEmpty`, `from`, `to`)',
    '',
  ].join('\n');
}
