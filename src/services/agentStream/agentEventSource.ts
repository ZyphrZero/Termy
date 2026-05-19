/**
 * Pluggable agent event source contract.
 *
 * An {@link AgentEventSource} is anything that can produce a stream of
 * {@link AgentEvent}s — an ACP client, the existing Claude Code IDE
 * bridge, a Codex skill-log tail, or a mock used during development.
 *
 * The bus calls {@link start} once and expects the source to invoke the
 * provided `publish` callback for every emitted event until {@link stop}
 * is called. Sources are responsible for their own backpressure: if
 * upstream is faster than the renderer, batch deltas before publishing.
 */

import type { AgentEvent } from './agentEventTypes';

/**
 * Stable name a source uses to identify itself in event envelopes.
 *
 * Convention: `<protocol>:<agent>` for protocol-bound sources
 * (`'acp:opencode'`, `'ide-bridge:claude-code'`) and a single token for
 * built-ins (`'mock'`).
 */
export type AgentEventSourceName = string;

/**
 * Function the bus hands to a source. Sources call this for every
 * event they want to broadcast. The bus is responsible for assigning
 * the envelope id and timestamp.
 */
export type AgentEventPublisher = (event: AgentEvent) => void;

export interface AgentEventSource {
  /** Stable identifier — see {@link AgentEventSourceName}. */
  readonly name: AgentEventSourceName;

  /**
   * Begin producing events. May be called multiple times; subsequent
   * calls after a successful start should be no-ops.
   *
   * Sources should *not* throw on transient connection failures —
   * surface those as `error` events through {@link publish} so the UI
   * can render them and the user can retry. Throw only for invariant
   * violations (misconfiguration, missing capability, …).
   */
  start(publish: AgentEventPublisher): Promise<void>;

  /**
   * Stop producing events and release any resources (sockets, child
   * processes, file watchers). Must be idempotent.
   */
  stop(): Promise<void>;
}
