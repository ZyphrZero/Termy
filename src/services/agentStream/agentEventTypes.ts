/**
 * Agent stream event taxonomy.
 *
 * The shape mirrors the ACP (Agent Client Protocol) `session/update`
 * union so that an upcoming `acpClient.ts` can map messages 1:1, while
 * still being usable by non-ACP sources (the Claude Code IDE bridge,
 * the Codex skill log tail, or a mock source for UI development).
 *
 * Keep this file dependency-free: it is consumed by both the renderer
 * (which runs in Obsidian's renderer process) and by event sources
 * that may run before any Obsidian API is available.
 */

/**
 * Stable identifier minted by the {@link AgentEventBus}.
 *
 * Sources should *not* invent their own ids — the bus assigns one when
 * an event is published so consumers can reliably correlate updates to
 * earlier blocks even if the upstream source uses a different id space.
 */
export type AgentEventId = string;

/**
 * Identifier for a logical agent session. Multiple events sharing a
 * session id are stitched into the same conversation by the view.
 */
export type AgentSessionId = string;

/**
 * Identifier for a tool call. Tool call updates carry the same id so
 * the view can patch the original card in place rather than appending
 * a new one for every progress notification.
 */
export type AgentToolCallId = string;

/**
 * Lifecycle states for an agent session, used by the status bar / view
 * header to show a spinner or an idle indicator.
 */
export type AgentSessionState = 'idle' | 'running' | 'awaiting-input' | 'finished' | 'errored';

/**
 * Plain markdown chunk that should be appended to the assistant's
 * current message. Sources stream tokens; the view re-renders the
 * accumulated buffer through Obsidian's `MarkdownRenderer` so that
 * partially-formed code fences degrade gracefully.
 */
export interface AgentTextChunkEvent {
  kind: 'text';
  sessionId: AgentSessionId;
  /** Append target — `'final'` for user-visible reply, `'thought'` for chain-of-thought when the agent exposes it. */
  channel: 'final' | 'thought';
  /** UTF-8 markdown delta. May be empty (sources sometimes send a leading flush). */
  delta: string;
}

/**
 * Marker that a previously-streamed text channel is complete. The view
 * uses this to seal the markdown block (turn off the typing indicator,
 * commit links into the Obsidian reference cache, etc.).
 */
export interface AgentTextDoneEvent {
  kind: 'text-done';
  sessionId: AgentSessionId;
  channel: 'final' | 'thought';
}

/**
 * High-level kinds of tool calls we render distinctively. The list is
 * intentionally narrow: anything not in this set falls back to the
 * generic "tool call" card so unknown providers degrade gracefully.
 */
export type AgentToolKind =
  | 'read_file'
  | 'edit_file'
  | 'create_file'
  | 'delete_file'
  | 'search'
  | 'terminal'
  | 'fetch'
  | 'other';

/**
 * Status of a tool call as reported by the agent. We deliberately keep
 * this independent of process-level concepts (exit codes etc.) so that
 * non-process tools (`read_file`, `search`, …) fit the same model.
 */
export type AgentToolStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Initial announcement of a tool call. Subsequent {@link AgentToolCallUpdateEvent}s
 * carry the same `toolCallId` so the view can patch in-place.
 */
export interface AgentToolCallEvent {
  kind: 'tool-call';
  sessionId: AgentSessionId;
  toolCallId: AgentToolCallId;
  toolName: string;
  toolKind: AgentToolKind;
  /** Short human-readable label rendered in the card header. */
  title: string;
  /** Optional path/argument summary rendered as the card subtitle. */
  subtitle?: string;
  status: AgentToolStatus;
}

/**
 * Incremental update to an existing tool call. Any field that is
 * `undefined` is treated as "no change"; consumers must not fall back
 * to a default when a field is missing.
 */
export interface AgentToolCallUpdateEvent {
  kind: 'tool-call-update';
  sessionId: AgentSessionId;
  toolCallId: AgentToolCallId;
  status?: AgentToolStatus;
  /** Markdown body to *replace* (not append) the card body with. Sources that stream output should keep recomputing this. */
  body?: string;
  /** Optional structured diff payload for `edit_file` / `create_file` tools. */
  diff?: AgentToolDiff;
  /** Optional terminal output for `terminal` tools. Plain text — ANSI is decoded by the renderer. */
  output?: string;
  /** Process exit code when applicable. */
  exitCode?: number;
}

/**
 * Structured diff payload. Sources are expected to produce the
 * Obsidian-renderable unified-diff string; turning the protocol-level
 * old/new pair into a diff is the source's job, not the view's.
 */
export interface AgentToolDiff {
  /** Unified-diff text with the standard `--- a/...\n+++ b/...` header. */
  unified: string;
  /** Workspace-relative path the diff applies to, when known. */
  path?: string;
}

/**
 * Step in an agent-authored plan. Plans are rendered as a checklist in
 * the view header.
 */
export interface AgentPlanStep {
  /** Stable identifier for the step. Used to patch a step in place. */
  id: string;
  title: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
}

/**
 * Whole-plan replacement event. Plans are not incremental — when the
 * agent revises the plan, it sends a new full list.
 */
export interface AgentPlanEvent {
  kind: 'plan';
  sessionId: AgentSessionId;
  steps: AgentPlanStep[];
}

/**
 * Permission request emitted by the agent before it executes a
 * potentially destructive tool. The host is expected to call back into
 * the source's `respondToPermission` method once the user decides.
 */
export interface AgentPermissionRequestEvent {
  kind: 'permission-request';
  sessionId: AgentSessionId;
  requestId: string;
  toolCallId?: AgentToolCallId;
  /** Markdown body explaining what the agent wants to do. */
  message: string;
  /** Suggested options. The first entry is treated as the default. */
  options: ReadonlyArray<{ id: string; label: string; kind: 'allow' | 'allow-once' | 'deny' | 'cancel' }>;
}

/**
 * Lifecycle transition event. Emitted at session start, when the agent
 * goes idle waiting for input, and on completion or error.
 */
export interface AgentSessionStateEvent {
  kind: 'session-state';
  sessionId: AgentSessionId;
  state: AgentSessionState;
  /** Optional human-readable detail rendered as a subtitle. */
  detail?: string;
}

/**
 * Terminal error from the source itself (transport closed, agent
 * crashed, JSON-RPC error, …). Rendered as an error card; the session
 * is typically marked `errored` immediately after.
 */
export interface AgentErrorEvent {
  kind: 'error';
  sessionId: AgentSessionId;
  message: string;
  /** Optional details rendered in a collapsible block. */
  details?: string;
}

/**
 * Discriminated union of every event the bus carries. New event kinds
 * should be added here so exhaustiveness checks in consumers fail at
 * compile time when a switch forgets to handle them.
 */
export type AgentEvent =
  | AgentTextChunkEvent
  | AgentTextDoneEvent
  | AgentToolCallEvent
  | AgentToolCallUpdateEvent
  | AgentPlanEvent
  | AgentPermissionRequestEvent
  | AgentSessionStateEvent
  | AgentErrorEvent;

/**
 * Envelope wrapping an {@link AgentEvent} with a bus-assigned id and
 * the originating source name. Consumers that need to deduplicate
 * across sources or restart can rely on the `id` for replay.
 */
export interface AgentEventEnvelope {
  /** Monotonically increasing id minted by {@link AgentEventBus.publish}. */
  id: AgentEventId;
  /** Wall-clock timestamp at publish time, in milliseconds since epoch. */
  timestamp: number;
  /** The source name that produced this event (e.g. `'mock'`, `'acp:opencode'`). */
  source: string;
  event: AgentEvent;
}
