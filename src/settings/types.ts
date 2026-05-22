/**
 * Settings module type definitions
 */

import type { App } from 'obsidian';
import type TerminalPlugin from '../main';

/**
 * Renderer context interface
 * Shared dependencies and state passed to settings renderers
 */
export interface RendererContext {
  /** Obsidian App instance */
  app: App;
  /** Plugin instance */
  plugin: TerminalPlugin;
  /** Settings content container element */
  containerEl: HTMLElement;
  /** Set of currently expanded sections */
  expandedSections: Set<string>;
}

/**
 * Settings renderer interface
 */
export interface ISettingsRenderer {
  /**
   * Render settings content
   * @param context Renderer context
   */
  render(context: RendererContext): void;
}

/**
 * Decision recorded for a persisted permission rule.
 *
 * Mirrors the user's `allow_always` / `reject_always` choice from the
 * permission modal. Transient `allow_once` / `reject_once` outcomes are
 * not stored — only persistent decisions reach this type.
 */
export type PermissionRuleDecision = 'allow' | 'reject';

/**
 * Persisted permission rule for ACP `session/request_permission`.
 *
 * When an agent issues a permission request, the queue first checks
 * whether `(agentId, op, pathPrefix)` matches any rule in
 * {@link import('./settings').TerminalSettings.permissionRules}; if it
 * does, the queue auto-replies with the recorded decision instead of
 * opening the modal.
 *
 * Field semantics:
 * - `id` — stable rule identifier (e.g. crypto-random uuid).
 * - `agentId` — the {@link import('../services/agentStream/agentConfig').AgentConfig.id}
 *   the rule applies to; rules are scoped per-agent so revoking trust
 *   for one agent never affects another.
 * - `op` — ACP operation key, e.g. `'fs.write'`, `'fs.read'`,
 *   `'terminal.create'`. Stored as a free-form string so future
 *   capabilities can be added without changing the persisted shape.
 * - `pathPrefix` — absolute path prefix the rule applies to; a request
 *   matches when its target path starts with this prefix. Use `''` to
 *   match every path under the agent.
 * - `decision` — the user's recorded outcome (`allow` or `reject`).
 * - `createdAt` — epoch milliseconds at which the rule was saved; used
 *   only for display ordering and audit, not for matching.
 */
export interface PermissionRule {
  readonly id: string;
  readonly agentId: string;
  readonly op: string;
  readonly pathPrefix: string;
  readonly decision: PermissionRuleDecision;
  readonly createdAt: number;
}
