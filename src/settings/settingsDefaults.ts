/**
 * Pure default-fallback helpers for {@link TerminalSettings}.
 *
 * `applyDefaults` is the single entry point used by the settings layer
 * to fill in ACP-related fields when `loadData()` returns a pre-ACP
 * payload (or no payload at all on first install). The function is
 * intentionally minimal:
 *
 * - It is **pure**: no I/O, no `loadData` / `saveData` calls, no
 *   mutation of the input object, no `Date.now()` or randomness.
 * - It is **idempotent**: `applyDefaults(applyDefaults(s))` is
 *   structurally equal to `applyDefaults(s)` (Property 8.1).
 * - It does **not** read or parse the legacy `presetScripts.actions[0]
 *   .value` array. The old terminal-launcher commands are a separate
 *   feature that lives independently of ACP (Property 8.2).
 * - It does **not** add a `settingsSchemaVersion` field or any other
 *   migration counter (Property 8.4).
 * - It does **not** write the result back to disk; that is the
 *   caller's responsibility, and the agent-panel-acp design
 *   deliberately avoids persisting the seeded defaults so that an
 *   un-edited install continues to track future built-in changes.
 *
 * The ACP fields are filled when they are missing entirely or when
 * the array variants are empty (Req 2 AC 9 / Req 8 AC 1):
 *
 * - `agents`               — empty / missing → deep clone of
 *                            {@link BUILT_IN_AGENTS}.
 * - `permissionRules`      — empty / missing → empty array.
 * - `permissionApprovalEnabled` — missing → `true`.
 *
 * Every other settings field is forwarded straight from
 * {@link DEFAULT_TERMINAL_SETTINGS} with the loaded value taking
 * precedence when present, mirroring the existing `loadSettings`
 * spread strategy in `main.ts`.
 */

import { BUILT_IN_AGENTS } from '@/services/agentStream/builtInAgents';
import type { AgentConfig } from '@/services/agentStream/agentConfig';
import type { PermissionRule } from './types';
import {
  DEFAULT_TERMINAL_SETTINGS,
  type TerminalSettings,
} from './settings';

/**
 * Apply default values to a partial settings record loaded from disk.
 *
 * @param loaded
 *   The raw object returned by `Plugin.loadData()`. May be `undefined`
 *   on a fresh install, an empty object on a corrupted payload, or a
 *   pre-ACP record that simply does not contain `agents` /
 *   `permissionRules` / `permissionApprovalEnabled`.
 * @returns
 *   A fully populated {@link TerminalSettings} object. The function
 *   does not mutate `loaded` and the returned object never aliases
 *   {@link DEFAULT_TERMINAL_SETTINGS} or {@link BUILT_IN_AGENTS}.
 */
export function applyDefaults(
  loaded: Partial<TerminalSettings> | undefined,
): TerminalSettings {
  const source = loaded ?? {};

  return {
    ...DEFAULT_TERMINAL_SETTINGS,
    ...source,
    // ACP fields: fill from built-ins when the loaded payload is
    // missing the field entirely OR provides an empty array. Both
    // conditions count as "fresh install" per Req 2 AC 9.
    agents: hasNonEmptyArray(source.agents)
      ? source.agents.map(cloneAgentConfig)
      : BUILT_IN_AGENTS.map(cloneAgentConfig),
    permissionRules: hasNonEmptyArray(source.permissionRules)
      ? source.permissionRules.map(clonePermissionRule)
      : [],
    permissionApprovalEnabled:
      typeof source.permissionApprovalEnabled === 'boolean'
        ? source.permissionApprovalEnabled
        : DEFAULT_TERMINAL_SETTINGS.permissionApprovalEnabled,
  };
}

/** Narrow check used to distinguish "missing/empty" from "user-edited". */
function hasNonEmptyArray<T>(
  value: readonly T[] | undefined,
): value is readonly T[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Deep clone of a single {@link AgentConfig}.
 *
 * The structural clone keeps `args` / `env` independent from the
 * source so that downstream mutation (for example by the settings UI
 * editing a copied row) cannot leak back into the built-in array or
 * into the on-disk record.
 */
function cloneAgentConfig(agent: AgentConfig): AgentConfig {
  return {
    id: agent.id,
    label: agent.label,
    command: agent.command,
    args: agent.args ? [...agent.args] : undefined,
    env: agent.env ? { ...agent.env } : undefined,
    icon: agent.icon,
    description: agent.description,
    enabled: agent.enabled,
    isBuiltIn: agent.isBuiltIn,
    rememberPermissions: agent.rememberPermissions,
  };
}

/** Shallow clone for the flat {@link PermissionRule} record. */
function clonePermissionRule(rule: PermissionRule): PermissionRule {
  return {
    id: rule.id,
    agentId: rule.agentId,
    op: rule.op,
    pathPrefix: rule.pathPrefix,
    decision: rule.decision,
    createdAt: rule.createdAt,
  };
}
