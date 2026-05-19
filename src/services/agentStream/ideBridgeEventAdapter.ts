/**
 * Pure adapter that turns {@link IdeBridgeEvent}s into
 * {@link AgentEvent}s.
 *
 * Keeping the mapping in a side-effect-free function lets us unit-test
 * the wire-format ↔ UI-model translation without spinning up a
 * WebSocket server. The {@link IdeBridgeAgentSource} is a thin shell
 * around this function — see `ideBridgeAgentSource.ts`.
 *
 * Mapping rationale:
 *
 * - **client-connected** → A new agent session with `state: 'running'`.
 *   We use the bridge-assigned `clientId` as the session id so
 *   subsequent events stay correlated even if the agent reconnects
 *   later (a fresh `clientId` ⇒ a fresh session).
 *
 * - **client-disconnected** → Mark the session `finished`. We do not
 *   delete the session from the model so the user can still scroll
 *   through the transcript after the agent CLI exits.
 *
 * - **tool-invoked: openFile** → A `tool-call` block with `toolKind:
 *   'read_file'`. Claude Code's `openFile` semantics is "scroll the
 *   IDE to this path", which conceptually maps closer to a navigate /
 *   read intent than to an edit. Status is announced as `completed`
 *   immediately because the bridge already did the work synchronously
 *   by the time the tool-invoked event fires.
 *
 * - Other tool calls (anything `openFile` is not) → A generic
 *   `tool-call` with `toolKind: 'other'`. We keep the surface
 *   permissive so future bridge tools (e.g. `openDiff` if Termy ever
 *   ships it) immediately render with a sensible default card.
 */

import type { IdeBridgeEvent } from '../ideBridge/ideBridge';
import type {
  AgentEvent,
  AgentSessionId,
  AgentToolCallId,
  AgentToolKind,
} from './agentEventTypes';

/** Strongly-typed input the adapter accepts. */
export type AdapterInput = {
  event: IdeBridgeEvent;
  /**
   * Monotonic counter the caller increments on every event. The
   * adapter uses it to mint deterministic tool-call ids without
   * needing an outer side-effectful generator.
   */
  toolInvocationIndex: number;
};

/**
 * Result of the mapping. Returns `null` for events that should not
 * appear in the agent panel (e.g. read-only introspection tools, if
 * any sneak through the bridge filter in future protocol revisions).
 */
export type AdapterOutput = AgentEvent[] | null;

export function adaptIdeBridgeEvent(input: AdapterInput): AdapterOutput {
  const { event, toolInvocationIndex } = input;
  switch (event.kind) {
    case 'client-connected':
      return [
        {
          kind: 'session-state',
          sessionId: sessionIdFor(event.clientId),
          state: 'running',
          detail: connectionDetail(event.clientName),
        },
      ];

    case 'client-disconnected':
      return [
        {
          kind: 'session-state',
          sessionId: sessionIdFor(event.clientId),
          state: 'finished',
          detail: 'Disconnected from Termy',
        },
      ];

    case 'tool-invoked':
      return mapToolInvocation(event, toolInvocationIndex);

    default: {
      // Exhaustiveness guard. Adding a new IdeBridgeEvent kind without
      // a matching arm here is a compile-time error.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function sessionIdFor(clientId: string): AgentSessionId {
  return `ide-bridge:${clientId}`;
}

function connectionDetail(clientName: string | undefined): string {
  return clientName ? `${clientName} connected` : 'Agent connected';
}

function mapToolInvocation(
  event: Extract<IdeBridgeEvent, { kind: 'tool-invoked' }>,
  invocationIndex: number,
): AgentEvent[] {
  const sessionId = sessionIdFor(event.clientId);
  const toolCallId: AgentToolCallId = `${event.clientId}:tool:${invocationIndex}`;

  if (event.toolName === 'openFile') {
    const filePath = typeof event.arguments.filePath === 'string'
      ? event.arguments.filePath
      : '';
    return [
      {
        kind: 'tool-call',
        sessionId,
        toolCallId,
        toolName: 'openFile',
        toolKind: 'read_file' satisfies AgentToolKind,
          title: 'Open file',
        subtitle: filePath || undefined,
        status: 'completed',
      },
      {
        kind: 'tool-call-update',
        sessionId,
        toolCallId,
        status: 'completed',
        body: filePath
          ? `Opened \`${filePath}\` in the editor.`
          : 'Opened a file in the editor.',
      },
    ];
  }

  return [
    {
      kind: 'tool-call',
      sessionId,
      toolCallId,
      toolName: event.toolName,
      toolKind: 'other' satisfies AgentToolKind,
      title: event.toolName,
      subtitle: summarizeArguments(event.arguments),
      status: 'completed',
    },
  ];
}

function summarizeArguments(args: Record<string, unknown>): string | undefined {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return undefined;
  }
  // Keep the subtitle short and stringy. Complex objects collapse to
  // `[object]` so the card stays a single line; the user can always
  // open the underlying agent CLI for full detail.
  const parts: string[] = [];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      parts.push(`${key}: ${value}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}: ${String(value)}`);
    } else if (value === null) {
      parts.push(`${key}: null`);
    } else {
      parts.push(`${key}: [object]`);
    }
  }
  const joined = parts.join(', ');
  return joined.length > 200 ? `${joined.slice(0, 197)}…` : joined;
}
