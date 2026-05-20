/**
 * Session aggregator: turns the unordered event envelope stream from
 * the bus into a structured snapshot the view can render.
 *
 * The view itself stays dumb on purpose — it asks the model for a
 * snapshot and re-renders. All "this delta extends that block",
 * "this update patches that tool card" logic lives here so it can be
 * unit-tested without an Obsidian context.
 */

import type {
  AgentEvent,
  AgentEventEnvelope,
  AgentPlanStep,
  AgentSessionId,
  AgentSessionState,
  AgentToolCallId,
  AgentToolKind,
  AgentToolStatus,
} from './agentEventTypes';

/**
 * One contiguous block in the rendered transcript. Text and tool
 * calls are interleaved in the order they were first announced.
 */
export type AgentTranscriptBlock = AgentTextBlock | AgentToolBlock | AgentErrorBlock;

export interface AgentTextBlock {
  kind: 'text';
  /** Append target. */
  channel: 'final' | 'thought';
  /** Concatenated markdown delta. */
  body: string;
  /** True until the source emits a matching `text-done` event. */
  streaming: boolean;
}

export interface AgentToolBlock {
  kind: 'tool';
  toolCallId: AgentToolCallId;
  toolName: string;
  toolKind: AgentToolKind;
  title: string;
  subtitle?: string;
  status: AgentToolStatus;
  /** Rendered card body, set by the latest `tool-call-update`. */
  body?: string;
  /** Output for `terminal` tools. */
  output?: string;
  /** Diff payload for `edit_file`-style tools. */
  diff?: { unified: string; path?: string };
  exitCode?: number;
}

export interface AgentErrorBlock {
  kind: 'error';
  message: string;
  details?: string;
}

export interface AgentSessionSnapshot {
  sessionId: AgentSessionId;
  state: AgentSessionState;
  /** Optional human-readable subtitle for the header. */
  detail?: string;
  /** Plan steps, most recent revision wins. Empty array means no plan. */
  plan: AgentPlanStep[];
  /** Outstanding permission requests, oldest first. */
  pendingPermissions: AgentPermissionRequest[];
  /** Ordered transcript. */
  blocks: AgentTranscriptBlock[];
}

export interface AgentPermissionRequest {
  requestId: string;
  toolCallId?: AgentToolCallId;
  message: string;
  options: ReadonlyArray<{ id: string; label: string; kind: 'allow' | 'allow-once' | 'deny' | 'cancel' }>;
}

/**
 * Listener invoked whenever the model changes. Receives the affected
 * session id so single-session views can short-circuit unrelated updates.
 */
export type AgentSessionListener = (sessionId: AgentSessionId) => void;

interface MutableSession {
  sessionId: AgentSessionId;
  state: AgentSessionState;
  detail?: string;
  plan: AgentPlanStep[];
  pendingPermissions: AgentPermissionRequest[];
  blocks: AgentTranscriptBlock[];
  /** Index of the *current* streaming text block per channel, if any. */
  activeTextBlock: { final?: number; thought?: number };
  /** Map from tool call id to block index, for in-place patching. */
  toolBlockIndex: Map<AgentToolCallId, number>;
}

export class AgentSessionModel {
  private readonly sessions = new Map<AgentSessionId, MutableSession>();
  private readonly listeners = new Set<AgentSessionListener>();

  /**
   * Apply an envelope. Returns the affected session id so the caller
   * can decide whether to re-render.
   */
  apply(envelope: AgentEventEnvelope): AgentSessionId {
    return this.applyEvent(envelope.event);
  }

  /**
   * Apply a raw event without an envelope. Used by callers that
   * synthesize transcripts from a non-bus source (e.g. loading an
   * OpenCode session's stored messages into the panel) — they own
   * the events directly so wrapping them in envelopes just to
   * unwrap them again would be ceremony.
   *
   * The mutation logic is identical to {@link apply}; that method
   * is kept as a thin alias so existing call sites that subscribe
   * to the bus do not have to change.
   */
  applyEvent(event: AgentEvent): AgentSessionId {
    const sessionId = event.sessionId;
    const session = this.ensureSession(sessionId);

    const result = this.processEvent(event, session);
    this.notify(sessionId);
    return result;
  }

  private processEvent(event: AgentEvent, session: MutableSession): AgentSessionId {
    const sessionId = session.sessionId;
    switch (event.kind) {
      case 'session-state':
        session.state = event.state;
        session.detail = event.detail;
        break;

      case 'plan':
        session.plan = [...event.steps];
        break;

      case 'permission-request':
        session.pendingPermissions = [
          ...session.pendingPermissions,
          {
            requestId: event.requestId,
            toolCallId: event.toolCallId,
            message: event.message,
            options: event.options,
          },
        ];
        break;

      case 'text': {
        const channel = event.channel;
        const activeIndex = session.activeTextBlock[channel];
        if (activeIndex !== undefined) {
          const existing = session.blocks[activeIndex];
          if (existing && existing.kind === 'text') {
            existing.body += event.delta;
            break;
          }
        }
        const block: AgentTextBlock = {
          kind: 'text',
          channel,
          body: event.delta,
          streaming: true,
        };
        session.blocks.push(block);
        session.activeTextBlock[channel] = session.blocks.length - 1;
        break;
      }

      case 'text-done': {
        const idx = session.activeTextBlock[event.channel];
        if (idx !== undefined) {
          const block = session.blocks[idx];
          if (block && block.kind === 'text') {
            block.streaming = false;
          }
          delete session.activeTextBlock[event.channel];
        }
        break;
      }

      case 'tool-call': {
        const block: AgentToolBlock = {
          kind: 'tool',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolKind: event.toolKind,
          title: event.title,
          subtitle: event.subtitle,
          status: event.status,
        };
        session.blocks.push(block);
        session.toolBlockIndex.set(event.toolCallId, session.blocks.length - 1);
        // A tool call interrupts any in-flight text block on both
        // channels; the view should not append further text into the
        // same paragraph after a tool fires.
        session.activeTextBlock = {};
        break;
      }

      case 'tool-call-update': {
        const idx = session.toolBlockIndex.get(event.toolCallId);
        if (idx === undefined) {
          break;
        }
        const block = session.blocks[idx];
        if (!block || block.kind !== 'tool') {
          break;
        }
        if (event.status !== undefined) {
          block.status = event.status;
        }
        if (event.body !== undefined) {
          block.body = event.body;
        }
        if (event.output !== undefined) {
          block.output = event.output;
        }
        if (event.diff !== undefined) {
          block.diff = { unified: event.diff.unified, path: event.diff.path };
        }
        if (event.exitCode !== undefined) {
          block.exitCode = event.exitCode;
        }
        break;
      }

      case 'error': {
        session.blocks.push({
          kind: 'error',
          message: event.message,
          details: event.details,
        });
        session.state = 'errored';
        break;
      }

      default: {
        // Exhaustiveness check. Adding a new event kind to
        // AgentEvent without handling it here is a compile error.
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }

    return sessionId;
  }

  /**
   * Drop a session entirely. Used by the "clear" action in the view.
   */
  reset(sessionId: AgentSessionId): void {
    if (this.sessions.delete(sessionId)) {
      this.notify(sessionId);
    }
  }

  /**
   * Convenience helper for callers that need to apply a batch of
   * events to a single session in one shot — e.g. loading a stored
   * OpenCode transcript. Listeners are notified once at the end so
   * the renderer paints the result as a single frame.
   */
  applyEventsBatch(sessionId: AgentSessionId, events: ReadonlyArray<AgentEvent>): void {
    if (events.length === 0) return;
    const session = this.ensureSession(sessionId);
    for (const event of events) {
      if (event.sessionId !== sessionId) continue;
      this.processEvent(event, session);
    }
    this.notify(sessionId);
  }

  /** Drop every session. */
  resetAll(): void {
    if (this.sessions.size === 0) {
      return;
    }
    const ids = [...this.sessions.keys()];
    this.sessions.clear();
    for (const id of ids) {
      this.notify(id);
    }
  }

  /**
   * Snapshot for a specific session. Returns `null` if the session is
   * unknown. Snapshots are deep-copied so consumers can render
   * without worrying about mutation.
   */
  getSnapshot(sessionId: AgentSessionId): AgentSessionSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return cloneSnapshot(session);
  }

  /**
   * Snapshots for every session, in insertion order. Used by the view
   * when it does not yet have a focused session.
   */
  getAllSnapshots(): AgentSessionSnapshot[] {
    return [...this.sessions.values()].map(cloneSnapshot);
  }

  /** Subscribe to model changes. Returns an unsubscribe function. */
  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureSession(sessionId: AgentSessionId): MutableSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        state: 'idle',
        plan: [],
        pendingPermissions: [],
        blocks: [],
        activeTextBlock: {},
        toolBlockIndex: new Map(),
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private notify(sessionId: AgentSessionId): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(sessionId);
      } catch {
        // Listener errors are isolated; the model itself is now in a
        // consistent state regardless of UI failures.
      }
    }
  }
}

function cloneSnapshot(session: MutableSession): AgentSessionSnapshot {
  return {
    sessionId: session.sessionId,
    state: session.state,
    detail: session.detail,
    plan: session.plan.map((step) => ({ ...step })),
    pendingPermissions: session.pendingPermissions.map((req) => ({
      ...req,
      options: req.options.map((opt) => ({ ...opt })),
    })),
    blocks: session.blocks.map(cloneBlock),
  };
}

function cloneBlock(block: AgentTranscriptBlock): AgentTranscriptBlock {
  if (block.kind === 'text') {
    return { ...block };
  }
  if (block.kind === 'tool') {
    return {
      ...block,
      diff: block.diff ? { ...block.diff } : undefined,
    };
  }
  return { ...block };
}
