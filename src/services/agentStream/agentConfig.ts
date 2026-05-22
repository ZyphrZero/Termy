/**
 * ACP agent configuration types and pure helpers.
 *
 * This module is intentionally dependency-free: it is imported by the
 * settings layer, the multi-agent manager, the panel UI, and tests, so
 * it must not pull in Obsidian APIs, Node built-ins, or other runtime
 * services. All exported functions are pure and never throw — surface
 * errors through the {@link AgentConfigValidation} result so the UI can
 * map them to localized messages.
 */

/**
 * Persisted configuration for a single ACP-compatible agent.
 *
 * Field semantics:
 * - `id` — kebab-case unique key (matches `^[a-z][a-z0-9-]*$`); used as
 *   the source name suffix `acp:<id>` when the agent is registered with
 *   `AgentEventBus`.
 * - `label` — display name shown in the panel tab and settings list.
 * - `command` — executable name or absolute path passed to spawn.
 * - `args` — optional command-line arguments forwarded to the child.
 * - `env` — optional environment overrides merged on top of the parent
 *   process environment when the child is spawned.
 * - `icon` — optional lobehub icon key or Obsidian built-in icon id.
 * - `description` — optional single-line tooltip text.
 * - `enabled` — when `false` the agent is hidden from panel tabs but the
 *   configuration is preserved.
 * - `isBuiltIn` — true for Termy's built-in defaults; built-ins cannot
 *   be deleted, only disabled.
 * - `rememberPermissions` — when `true` (default) the permission queue
 *   is allowed to persist `allow_always` / `reject_always` rules for
 *   this agent.
 */
export interface AgentConfig {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly icon?: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly isBuiltIn: boolean;
  readonly rememberPermissions?: boolean;
}

/**
 * Validation outcome for {@link validateAgentConfig}.
 *
 * The settings UI maps each `messageKey` to a localized string. Errors
 * are emitted as a flat list rather than a `field -> message` map so
 * that the same field can carry multiple errors (for example an id can
 * fail both the format check and the uniqueness check).
 */
export interface AgentConfigValidation {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<{
    readonly field: keyof AgentConfig;
    readonly messageKey: string;
  }>;
}

/**
 * Diff produced by {@link computeAgentDiff}; consumed by the manager
 * subscriber to decide which agents to stop, restart, or merely note.
 *
 * - `added` — full config objects for newly added agents.
 * - `removed` — ids of agents that no longer exist in the next array.
 * - `disabled` — ids of agents that flipped `enabled: true -> false`.
 * - `commandOrArgsChanged` — ids of agents whose `command` or `args`
 *   changed; the manager uses this to surface a "restart required"
 *   hint rather than silently re-spawning.
 */
export interface AgentDiff {
  readonly added: readonly AgentConfig[];
  readonly removed: readonly string[];
  readonly disabled: readonly string[];
  readonly commandOrArgsChanged: readonly string[];
}

/** Kebab-case id pattern shared by validation and the settings UI. */
const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Validate a single {@link AgentConfig} against its siblings.
 *
 * `siblings` may include `config` itself; the uniqueness check skips
 * the same reference so callers do not have to filter the array before
 * calling. The function never throws — all problems are returned in
 * the {@link AgentConfigValidation.errors} list.
 */
export function validateAgentConfig(
  config: AgentConfig,
  siblings: readonly AgentConfig[],
): AgentConfigValidation {
  const errors: { field: keyof AgentConfig; messageKey: string }[] = [];

  if (!AGENT_ID_PATTERN.test(config.id)) {
    errors.push({ field: 'id', messageKey: 'agent.error.idFormat' });
  }
  if (siblings.some((sibling) => sibling !== config && sibling.id === config.id)) {
    errors.push({ field: 'id', messageKey: 'agent.error.idDuplicate' });
  }
  if (config.command.trim().length === 0) {
    errors.push({ field: 'command', messageKey: 'agent.error.commandEmpty' });
  }
  if (config.label.trim().length === 0) {
    errors.push({ field: 'label', messageKey: 'agent.error.labelEmpty' });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Compute the structural diff between two ordered agent arrays.
 *
 * The function does not mutate either argument and the returned arrays
 * are fresh copies, safe to expose as `readonly`. Order in `added` and
 * `commandOrArgsChanged` follows the order of `next`; order in
 * `removed` follows the order of `prev`; order in `disabled` follows
 * the order of `next`.
 */
export function computeAgentDiff(
  prev: readonly AgentConfig[],
  next: readonly AgentConfig[],
): AgentDiff {
  const prevById = new Map(prev.map((agent) => [agent.id, agent]));
  const nextById = new Map(next.map((agent) => [agent.id, agent]));

  const added = next.filter((agent) => !prevById.has(agent.id));
  const removed = prev
    .filter((agent) => !nextById.has(agent.id))
    .map((agent) => agent.id);
  const disabled = next
    .filter((agent) => prevById.get(agent.id)?.enabled === true && !agent.enabled)
    .map((agent) => agent.id);
  const commandOrArgsChanged = next
    .filter((agent) => {
      const before = prevById.get(agent.id);
      if (!before) return false;
      if (before.command !== agent.command) return true;
      return !stringArraysEqual(before.args ?? [], agent.args ?? []);
    })
    .map((agent) => agent.id);

  return { added, removed, disabled, commandOrArgsChanged };
}

/** Internal helper: shallow equality on two readonly string arrays. */
function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
