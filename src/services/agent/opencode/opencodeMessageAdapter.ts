/**
 * Pure adapter that turns an OpenCode message-with-parts payload
 * into the {@link AgentEvent}s our panel renderer already speaks.
 *
 * This file has zero side effects so it is exercised by unit tests
 * without an HTTP server. The session model treats the resulting
 * events as if they had streamed in real time, which means the
 * "load history" path and the "live resume" path share the same
 * downstream rendering code.
 *
 * Mapping summary:
 *   - User message → a single `text` chunk on the `final` channel,
 *     prefixed with `**You:** ` so it is visually distinct from the
 *     assistant's reply (matches what `AcpAgentSource` already does
 *     for the live path).
 *   - Assistant `text` part → `text` chunk on the `final` channel.
 *   - Assistant `reasoning` part → `text` chunk on the `thought`
 *     channel.
 *   - Assistant `tool` part → a `tool-call` plus a
 *     `tool-call-update` carrying status / body / diff. The tool
 *     state's `output` (if any) is included in the body so the
 *     existing card renderer surfaces it.
 *   - Assistant `step-finish` / `step-start` / `snapshot` / `patch`
 *     parts are skipped — they are bookkeeping that does not belong
 *     in the transcript view.
 *
 * The adapter is intentionally permissive about unknown part types:
 * it returns no events for them rather than throwing, so a daemon
 * upgrade that introduces a new part shape never breaks rendering.
 */

import type {
  AgentEvent,
  AgentSessionId,
  AgentToolKind,
  AgentToolStatus,
} from '../../agentStream/agentEventTypes.ts';
import type {
  OpenCodeMessagePart,
  OpenCodeMessageWithParts,
} from './opencodeHttpClient.ts';

/**
 * Convert one full message (info + parts) to a list of events.
 *
 * Tool calls and text are emitted in part order. Each text part
 * gets its own block followed by a matching `text-done` so the
 * transcript shows turn boundaries cleanly even when the assistant
 * interleaves reasoning, tool calls, and final replies.
 */
export function adaptMessageToEvents(
  sessionId: AgentSessionId,
  message: OpenCodeMessageWithParts,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  if (message.info.role === 'user') {
    const text = collectUserText(message.parts);
    if (text.length > 0) {
      events.push({
        kind: 'text',
        sessionId,
        channel: 'final',
        delta: `\n\n**You:** ${text}\n\n`,
      });
      events.push({ kind: 'text-done', sessionId, channel: 'final' });
    }
    return events;
  }

  // Assistant message.
  for (const part of message.parts) {
    pushPartEvents(events, sessionId, part);
  }
  return events;
}

/**
 * Convert an entire transcript (list of messages) in one shot. Used
 * by the "load this session into the panel" flow.
 */
export function adaptTranscriptToEvents(
  sessionId: AgentSessionId,
  messages: ReadonlyArray<OpenCodeMessageWithParts>,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const message of messages) {
    for (const event of adaptMessageToEvents(sessionId, message)) {
      events.push(event);
    }
  }
  return events;
}

function collectUserText(parts: ReadonlyArray<OpenCodeMessagePart>): string {
  const fragments: string[] = [];
  for (const part of parts) {
    if (part.type !== 'text') continue;
    const value = (part as { text?: unknown }).text;
    if (typeof value === 'string') fragments.push(value);
  }
  return fragments.join('').trim();
}

function pushPartEvents(events: AgentEvent[], sessionId: AgentSessionId, part: OpenCodeMessagePart): void {
  switch (part.type) {
    case 'text': {
      const value = (part as { text?: unknown }).text;
      if (typeof value !== 'string' || value.length === 0) return;
      events.push({ kind: 'text', sessionId, channel: 'final', delta: value });
      events.push({ kind: 'text-done', sessionId, channel: 'final' });
      return;
    }
    case 'reasoning': {
      const value = (part as { text?: unknown }).text;
      if (typeof value !== 'string' || value.length === 0) return;
      events.push({ kind: 'text', sessionId, channel: 'thought', delta: value });
      events.push({ kind: 'text-done', sessionId, channel: 'thought' });
      return;
    }
    case 'tool':
      pushToolPart(events, sessionId, part);
      return;
    default:
      // step-start / step-finish / snapshot / patch / file / agent /
      // subtask / compaction / retry — none belong in the transcript
      // view. They show up in OpenCode's own UI but would clutter
      // ours.
      return;
  }
}

function pushToolPart(events: AgentEvent[], sessionId: AgentSessionId, part: OpenCodeMessagePart): void {
  const callId = typeof part.callID === 'string' ? part.callID : part.id;
  const toolName = typeof part.tool === 'string' ? part.tool : 'tool';
  const stateUnknown = (part as { state?: unknown }).state;
  const state =
    typeof stateUnknown === 'object' && stateUnknown !== null ? (stateUnknown as Record<string, unknown>) : {};
  const status = mapToolStatus(typeof state.status === 'string' ? state.status : 'pending');
  const subtitle = describeToolInput(state.input);

  events.push({
    kind: 'tool-call',
    sessionId,
    toolCallId: callId,
    toolName,
    toolKind: mapToolKind(toolName),
    title: toolName,
    subtitle,
    status,
  });

  const body = describeToolOutput(state);
  events.push({
    kind: 'tool-call-update',
    sessionId,
    toolCallId: callId,
    status,
    ...(body ? { body } : {}),
  });
}

function mapToolStatus(value: string): AgentToolStatus {
  switch (value) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Heuristic mapping of OpenCode tool names to the broad UI families
 * the renderer recognizes. The exhaustive list is intentionally
 * loose; unknown tools fall through to `'other'` and still render
 * with a reasonable default card.
 */
function mapToolKind(toolName: string): AgentToolKind {
  const lower = toolName.toLowerCase();
  if (lower.includes('read')) return 'read_file';
  if (lower.includes('edit')) return 'edit_file';
  if (lower.includes('write') || lower.includes('create')) return 'create_file';
  if (lower.includes('delete')) return 'delete_file';
  if (lower.includes('search') || lower.includes('grep') || lower.includes('glob')) return 'search';
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('exec') || lower.includes('terminal')) {
    return 'terminal';
  }
  if (lower.includes('fetch') || lower.includes('http') || lower.includes('webfetch')) return 'fetch';
  return 'other';
}

function describeToolInput(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const candidates: Array<unknown> = [
    record.path,
    record.filePath,
    record.file_path,
    record.command,
    record.pattern,
    record.query,
    record.url,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 200 ? `${value.slice(0, 197)}…` : value;
    }
  }
  return undefined;
}

function describeToolOutput(state: Record<string, unknown>): string | undefined {
  const outputUnknown = state.output;
  if (typeof outputUnknown === 'string' && outputUnknown.length > 0) {
    return outputUnknown;
  }
  const error = state.error;
  if (typeof error === 'string' && error.length > 0) {
    return `Error: ${error}`;
  }
  return undefined;
}
