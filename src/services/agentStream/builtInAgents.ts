/**
 * Built-in ACP agent configurations seeded into Termy on first install.
 *
 * The settings layer falls back to deep clones of these constants when
 * `loadData()` returns no `agents` field (Req 2 AC 1 / 2 AC 9). Built-ins
 * are immutable in the sense that the user cannot delete them — they can
 * only disable, override individual fields, or reset back to the value
 * exported here (Req 2 AC 4 / 2 AC 7 / 2 AC 8).
 *
 * The three ids and their canonical order:
 *   1. `claude-code` — Anthropic Claude via the Zed-maintained ACP shim.
 *   2. `codex`       — OpenAI Codex via the Zed-maintained ACP shim.
 *   3. `opencode`    — OpenCode's first-party ACP subcommand.
 *
 * Icons reference canonical lobehub keys (see
 * `src/ui/terminal/lobeIconAssets.ts`); the panel's brand-icon renderer
 * resolves them through `resolveLobeIconKey` and reports an explicit
 * configuration error when no match is found.
 */

import type { AgentConfig } from './agentConfig';

/**
 * Canonical id order for the built-in agents. Exposed separately from
 * {@link BUILT_IN_AGENTS} so that diff helpers and tests can compare
 * against the id list without forcing a full structural deep-equal on
 * every record.
 */
export const BUILT_IN_AGENT_IDS: readonly string[] = [
  'claude-code',
  'codex',
  'opencode',
] as const;

/**
 * Default {@link AgentConfig} records seeded into settings on first
 * install. The order matches {@link BUILT_IN_AGENT_IDS} and is the
 * order rendered in the panel tab strip and the settings list.
 *
 * Commands are split into `command` + `args` so the spawn layer can
 * forward them directly to `child_process.spawn` without re-parsing
 * a shell-quoted string. The Zed-maintained shims (`@zed-industries/
 * claude-code-acp` and `@zed-industries/codex-acp`) are launched via
 * `npx --yes` so users do not need a global install; the OpenCode and
 * Gemini CLIs ship their own ACP subcommand and are invoked directly.
 *
 * All built-ins start `enabled: true`, `isBuiltIn: true`, and
 * `rememberPermissions: true` (Req 2 AC 1 / 2 AC 4).
 */
export const BUILT_IN_AGENTS: readonly AgentConfig[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    command: 'npx',
    args: ['--yes', '@zed-industries/claude-code-acp'],
    icon: 'claudecode',
    enabled: true,
    isBuiltIn: true,
    rememberPermissions: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'npx',
    args: ['--yes', '@zed-industries/codex-acp'],
    icon: 'codex',
    enabled: true,
    isBuiltIn: true,
    rememberPermissions: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    icon: 'opencode',
    enabled: true,
    isBuiltIn: true,
    rememberPermissions: true,
  },
] as const;
