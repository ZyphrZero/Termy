/**
 * Settings accessor for the ACP agent panel.
 *
 * `SettingsAccessor` is the single entry point that the
 * `AgentManager`, the panel UI, and the settings UI all use to read
 * and mutate the ACP-related slice of {@link TerminalSettings}
 * (`agents`, `permissionRules`). Centralizing access here:
 *
 * - Keeps `validateAgentConfig` enforcement on the write path so that
 *   no corrupted record can land on disk.
 * - Computes an {@link AgentDiff} on every successful agent write and
 *   fans it out to subscribers, which lets the manager react to
 *   `removed` / `disabled` / `commandOrArgsChanged` without polling.
 * - Funnels every write through `Plugin.saveSettings()` — which never
 *   re-runs `applyDefaults` — so user-edited records are never
 *   silently overwritten by built-in defaults.
 *
 * Behaviour is summarised by the contract methods, but four
 * invariants are worth stating up front:
 *
 * - `removeAgent(id)` returns `false` and performs no mutation when
 *   the target carries `isBuiltIn: true`. Built-ins can only be
 *   disabled or reset, never deleted (Req 2 AC 7 / Property 2.4).
 * - `upsertAgent(next)` runs `validateAgentConfig` first; on failure
 *   the validation result is returned and no write is performed
 *   (Req 2 AC 5 / 2 AC 6).
 * - `onAgentsChange` listeners only fire when the diff is non-empty,
 *   so a no-op write does not produce phantom events.
 * - The accessor never reads or writes `presetScripts` (Property
 *   8.2). Legacy terminal-launcher commands stay independent.
 */

import type {
  AgentConfig,
  AgentConfigValidation,
  AgentDiff,
} from '@/services/agentStream/agentConfig';
import { computeAgentDiff, validateAgentConfig } from '@/services/agentStream/agentConfig';
import { BUILT_IN_AGENTS } from '@/services/agentStream/builtInAgents';
import type { PermissionRule } from './types';
import type { AgentThreadMeta, TerminalSettings } from './settings';

/**
 * Read/write surface for the ACP-related slice of settings.
 *
 * Implementations are expected to be backed by a live
 * `TerminalSettings` instance — `getAllAgents` / `getEnabledAgents`
 * return references into the live array so callers can rely on
 * structural identity for memoisation. Mutation methods always
 * replace the array with a fresh copy and persist via the host
 * plugin's regular save path.
 */
export interface SettingsAccessor {
  getAgent(id: string): AgentConfig | undefined;
  getAllAgents(): readonly AgentConfig[];
  getEnabledAgents(): readonly AgentConfig[];
  upsertAgent(next: AgentConfig): Promise<AgentConfigValidation>;
  removeAgent(id: string): Promise<boolean>;
  resetAgentToBuiltIn(id: string): Promise<void>;
  reorderAgents(orderedIds: readonly string[]): Promise<void>;
  onAgentsChange(handler: (diff: AgentDiff) => void): () => void;
  getPermissionRules(): readonly PermissionRule[];
  upsertPermissionRule(rule: PermissionRule): Promise<void>;
  getAgentThreadMeta(providerId: string, threadId: string): AgentThreadMeta | undefined;
  upsertAgentThreadMeta(meta: AgentThreadMeta): Promise<void>;
}

/**
 * Dependencies wired into {@link DefaultSettingsAccessor}.
 *
 * The accessor stays decoupled from the Obsidian `Plugin` lifecycle
 * by receiving a reader for the live settings object plus a persist
 * callback. The persist callback must not invoke `applyDefaults` —
 * that work belongs to the load path only.
 */
export interface SettingsAccessorDeps {
  /** Returns the currently loaded live settings (mutated in place). */
  readonly getSettings: () => TerminalSettings;
  /**
   * Persist the current `getSettings()` value to disk. Implementations
   * must NOT re-apply defaults — see the load-path documentation in
   * `settingsDefaults.ts`. The accessor calls this after every
   * successful agents/permission-rules write.
   */
  readonly persist: () => Promise<void>;
}

/**
 * Default {@link SettingsAccessor} implementation. The class holds no
 * state of its own beyond the change-listener set; all reads go
 * through `deps.getSettings()` so that callers always observe the
 * latest mutation, even when other code paths mutate the live object
 * directly.
 */
export class DefaultSettingsAccessor implements SettingsAccessor {
  private readonly listeners: Set<(diff: AgentDiff) => void> = new Set();

  constructor(private readonly deps: SettingsAccessorDeps) {}

  getAgent(id: string): AgentConfig | undefined {
    return this.deps.getSettings().agents.find((agent) => agent.id === id);
  }

  getAllAgents(): readonly AgentConfig[] {
    return this.deps.getSettings().agents;
  }

  getEnabledAgents(): readonly AgentConfig[] {
    return this.deps.getSettings().agents.filter((agent) => agent.enabled);
  }

  async upsertAgent(next: AgentConfig): Promise<AgentConfigValidation> {
    const previous = this.deps.getSettings().agents;
    // Exclude the existing record with the same id from sibling
    // checks so updating an agent in place does not trip the
    // duplicate-id rule against itself.
    const siblings = previous.filter((agent) => agent.id !== next.id);
    const validation = validateAgentConfig(next, siblings);
    if (!validation.ok) {
      return validation;
    }
    const index = previous.findIndex((agent) => agent.id === next.id);
    const updated = index >= 0
      ? [...previous.slice(0, index), next, ...previous.slice(index + 1)]
      : [...previous, next];
    await this.applyAgents(previous, updated);
    return validation;
  }

  async removeAgent(id: string): Promise<boolean> {
    const previous = this.deps.getSettings().agents;
    const target = previous.find((agent) => agent.id === id);
    if (!target) return false;
    if (target.isBuiltIn) return false;
    const updated = previous.filter((agent) => agent.id !== id);
    await this.applyAgents(previous, updated);
    return true;
  }

  async resetAgentToBuiltIn(id: string): Promise<void> {
    const builtIn = BUILT_IN_AGENTS.find((agent) => agent.id === id);
    if (!builtIn) {
      throw new Error(`No built-in agent with id "${id}"`);
    }
    const previous = this.deps.getSettings().agents;
    const fresh = cloneAgentConfig(builtIn);
    const index = previous.findIndex((agent) => agent.id === id);
    const updated = index >= 0
      ? [...previous.slice(0, index), fresh, ...previous.slice(index + 1)]
      : [...previous, fresh];
    await this.applyAgents(previous, updated);
  }

  async reorderAgents(orderedIds: readonly string[]): Promise<void> {
    const previous = this.deps.getSettings().agents;
    const byId = new Map(previous.map((agent) => [agent.id, agent]));
    const reordered: AgentConfig[] = [];
    const seen = new Set<string>();
    // Honour the requested order first, skipping unknown / duplicate
    // ids so a malformed call cannot drop or repeat entries.
    for (const id of orderedIds) {
      if (seen.has(id)) continue;
      const agent = byId.get(id);
      if (!agent) continue;
      reordered.push(agent);
      seen.add(id);
    }
    // Preserve any agents the caller forgot to mention so a partial
    // reorder cannot silently delete configurations.
    for (const agent of previous) {
      if (seen.has(agent.id)) continue;
      reordered.push(agent);
    }
    await this.applyAgents(previous, reordered);
  }

  onAgentsChange(handler: (diff: AgentDiff) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  getPermissionRules(): readonly PermissionRule[] {
    return this.deps.getSettings().permissionRules;
  }

  async upsertPermissionRule(rule: PermissionRule): Promise<void> {
    const settings = this.deps.getSettings();
    const previous = settings.permissionRules;
    const index = previous.findIndex((existing) => existing.id === rule.id);
    const updated = index >= 0
      ? [...previous.slice(0, index), rule, ...previous.slice(index + 1)]
      : [...previous, rule];
    writePermissionRules(settings, updated);
    await this.deps.persist();
  }

  getAgentThreadMeta(providerId: string, threadId: string): AgentThreadMeta | undefined {
    return this.deps.getSettings().agentThreadMeta.find((meta) => (
      meta.providerId === providerId && meta.threadId === threadId
    ));
  }

  async upsertAgentThreadMeta(meta: AgentThreadMeta): Promise<void> {
    const settings = this.deps.getSettings();
    const previous = settings.agentThreadMeta;
    const index = previous.findIndex((existing) => (
      existing.providerId === meta.providerId && existing.threadId === meta.threadId
    ));
    const updated = index >= 0
      ? [...previous.slice(0, index), meta, ...previous.slice(index + 1)]
      : [...previous, meta];
    writeAgentThreadMeta(settings, updated);
    await this.deps.persist();
  }

  /**
   * Replace the agents array, persist, and dispatch a non-empty diff.
   *
   * Any handler exception is swallowed so a single broken subscriber
   * cannot block other listeners from observing the change.
   */
  private async applyAgents(
    prev: readonly AgentConfig[],
    next: readonly AgentConfig[],
  ): Promise<void> {
    const settings = this.deps.getSettings();
    writeAgents(settings, next);
    await this.deps.persist();
    const diff = computeAgentDiff(prev, next);
    if (isEmptyDiff(diff)) return;
    for (const handler of this.listeners) {
      try {
        handler(diff);
      } catch {
        // Intentionally ignore listener errors so a misbehaving
        // subscriber cannot break the dispatch loop.
      }
    }
  }
}

/** Deep clone of a single {@link AgentConfig} (used for resets). */
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

/**
 * Write `next` into `settings.agents`. The interface declares the
 * field `readonly`; runtime mutation is safe and matches how the rest
 * of the plugin updates its settings record.
 */
function writeAgents(settings: TerminalSettings, next: readonly AgentConfig[]): void {
  (settings as { agents: readonly AgentConfig[] }).agents = next;
}

/** Counterpart for permission rules; see {@link writeAgents}. */
function writePermissionRules(
  settings: TerminalSettings,
  next: readonly PermissionRule[],
): void {
  (settings as { permissionRules: readonly PermissionRule[] }).permissionRules = next;
}

function writeAgentThreadMeta(
  settings: TerminalSettings,
  next: readonly AgentThreadMeta[],
): void {
  (settings as { agentThreadMeta: readonly AgentThreadMeta[] }).agentThreadMeta = next;
}

/** True when the diff carries no observable change. */
function isEmptyDiff(diff: AgentDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.disabled.length === 0 &&
    diff.commandOrArgsChanged.length === 0
  );
}
