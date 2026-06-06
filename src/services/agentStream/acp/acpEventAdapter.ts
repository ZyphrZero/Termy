/**
 * Pure adapter that maps ACP `session/update` notifications into
 * Termy {@link AgentEvent}s.
 *
 * Centralising the wire-format → UI-model translation here keeps the
 * client transport (`acpClient.ts`) and the UI source
 * (`acpAgentSource.ts`) testable in isolation: this file knows
 * nothing about child processes or buses, only about JSON shapes.
 *
 * Mapping rationale by `sessionUpdate` discriminator:
 *
 * - **agent_message_chunk** → `text` (channel: 'final'). Streamed
 *   token-by-token; the session model concatenates chunks into one
 *   block until something else interrupts.
 * - **agent_thought_chunk** → `text` (channel: 'thought'). Renders
 *   dimmed in the panel.
 * - **user_message_chunk** → ignored. The user's own input is
 *   rendered by Termy itself when it sends `session/prompt`; echoing
 *   the agent's view back would create duplicates.
 * - **tool_call** → `tool-call`. Title, status, optional content/diff
 *   are translated into the panel's tool card model.
 * - **tool_call_update** → `tool-call-update` patching the same id.
 * - **plan** → `plan` with the steps mapped 1:1.
 * - **available_commands_update**, **current_mode_update** → explicit
 *   no-op. They are command/mode metadata, not transcript content.
 * - Unsupported protocol variants throw. Termy should expose protocol
 *   drift immediately instead of hiding missing UI mappings.
 *
 * Stop reasons (from the prompt response, not a `session/update`)
 * map to `session-state` events through {@link adaptStopReason}.
 */

import type { AgentEvent } from '../agentEventTypes.ts';
import type {
  AcpContentBlock,
  AcpPlanEntry,
  AcpSessionUpdate,
  AcpStopReason,
  AcpToolCallContent,
  AcpToolCallUpdate,
  AcpToolCallProgressUpdate,
  AcpToolKind,
  AcpToolStatus,
} from './acpProtocol.ts';
import type { AgentSessionId, AgentToolKind, AgentToolStatus } from '../agentEventTypes.ts';

export interface AdaptUpdateInput {
  sessionId: AgentSessionId;
  update: AcpSessionUpdate;
  includeUserMessages?: boolean;
}

/**
 * Map a single `session/update` notification to zero or more
 * {@link AgentEvent}s.
 */
export function adaptAcpUpdate(input: AdaptUpdateInput): AgentEvent[] {
  const { sessionId, update } = input;
  const updateRecord = update as unknown as Record<string, unknown>;

  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return adaptTextChunk(sessionId, 'final', updateRecord.content as AcpContentBlock);

    case 'agent_thought_chunk':
      return adaptTextChunk(sessionId, 'thought', updateRecord.content as AcpContentBlock);

    case 'user_message_chunk':
      return input.includeUserMessages
        ? adaptUserTextChunk(sessionId, updateRecord.content as AcpContentBlock)
        : [];

    case 'tool_call':
      return adaptToolCall(sessionId, update);

    case 'tool_call_update':
      return adaptToolCallProgress(sessionId, update);

    case 'plan':
      return adaptPlan(
        sessionId,
        requireArray(updateRecord.entries, 'ACP plan update entries') as AcpPlanEntry[],
      );

    case 'available_commands_update':
    case 'current_mode_update':
      return [];

    default:
      throw new Error(`Unsupported ACP session/update kind: ${String(updateRecord.sessionUpdate)}`);
  }
}

function adaptUserTextChunk(
  sessionId: AgentSessionId,
  content: AcpContentBlock,
): AgentEvent[] {
  const text = extractTextFromContentBlock(content);
  if (text.length === 0) {
    return [];
  }
  return [
    { kind: 'text', sessionId, channel: 'final', delta: `\n\n**You:** ${text}\n\n` },
    { kind: 'text-done', sessionId, channel: 'final' },
  ];
}

/**
 * Map a `session/prompt` response stop reason to a session-state
 * transition. Used by the client when the agent finishes a turn.
 */
export function adaptStopReason(
  sessionId: AgentSessionId,
  stopReason: AcpStopReason,
): AgentEvent {
  switch (stopReason) {
    case 'end_turn':
      return { kind: 'session-state', sessionId, state: 'awaiting-input', detail: 'Turn complete' };
    case 'cancelled':
      return { kind: 'session-state', sessionId, state: 'awaiting-input', detail: 'Cancelled' };
    case 'refusal':
      return { kind: 'session-state', sessionId, state: 'errored', detail: 'Agent refused the request' };
    case 'max_tokens':
      return { kind: 'session-state', sessionId, state: 'errored', detail: 'Max tokens reached' };
    case 'max_turn_requests':
      return { kind: 'session-state', sessionId, state: 'errored', detail: 'Max turn requests reached' };
    default:
      throw new Error(`Unsupported ACP stop reason: ${String(stopReason)}`);
  }
}

function adaptTextChunk(
  sessionId: AgentSessionId,
  channel: 'final' | 'thought',
  content: AcpContentBlock,
): AgentEvent[] {
  const text = extractTextFromContentBlock(content);
  if (text.length === 0) {
    return [];
  }
  return [{ kind: 'text', sessionId, channel, delta: text }];
}

function adaptToolCall(
  sessionId: AgentSessionId,
  update: AcpToolCallUpdate,
): AgentEvent[] {
  const toolCallId = requireString(update.toolCallId, 'ACP tool_call.toolCallId');
  const title = requireString(update.title, 'ACP tool_call.title');
  const events: AgentEvent[] = [
    {
      kind: 'tool-call',
      sessionId,
      toolCallId,
      toolName: title,
      toolKind: mapToolKind(update.kind),
      title,
      status: mapToolStatus(update.status, 'pending'),
    },
  ];
  // The announcement itself already carries status. Only emit a
  // follow-up `tool-call-update` when the announcement also brought
  // body / diff / output content — otherwise the panel would render
  // a redundant card update.
  if (update.content && update.content.length > 0) {
    events.push(synthesizeProgressUpdate(sessionId, toolCallId, update.status, update.content));
  }
  return events;
}

function adaptToolCallProgress(
  sessionId: AgentSessionId,
  update: AcpToolCallProgressUpdate,
): AgentEvent[] {
  if (update.status === undefined && (!update.content || update.content.length === 0)) {
    throw new Error('ACP tool_call_update must include status or content');
  }
  const toolCallId = requireString(update.toolCallId, 'ACP tool_call_update.toolCallId');
  return [synthesizeProgressUpdate(sessionId, toolCallId, update.status, update.content)];
}

function synthesizeProgressUpdate(
  sessionId: AgentSessionId,
  toolCallId: string,
  status: AcpToolStatus | undefined,
  content: AcpToolCallContent[] | undefined,
): AgentEvent {
  const event: AgentEvent = {
    kind: 'tool-call-update',
    sessionId,
    toolCallId,
  };
  if (status !== undefined) {
    event.status = mapToolStatus(status, 'pending');
  }

  const folded = foldToolCallContent(content);
  if (folded.body !== undefined) {
    event.body = folded.body;
  }
  if (folded.diff !== undefined) {
    event.diff = folded.diff;
  }
  return event;
}

function adaptPlan(sessionId: AgentSessionId, entries: AcpPlanEntry[]): AgentEvent[] {
  return [
    {
      kind: 'plan',
      sessionId,
      steps: entries.map((entry, index) => ({
        id: `${sessionId}:plan:${index}`,
        title: entry.content,
        status: mapPlanStatus(entry.status),
      })),
    },
  ];
}

interface FoldedToolContent {
  body?: string;
  diff?: { unified: string; path?: string };
}

function foldToolCallContent(content: AcpToolCallContent[] | undefined): FoldedToolContent {
  if (!content || content.length === 0) {
    return {};
  }

  const bodyParts: string[] = [];
  let diff: { unified: string; path?: string } | undefined;

  for (const entry of content) {
    if (entry.type === 'content') {
      const text = extractTextFromContentBlock(entry.content);
      if (text) bodyParts.push(text);
    } else if (entry.type === 'diff') {
      const diffEntry = requireDiffToolContent(entry);
      const oldText = typeof diffEntry.oldText === 'string' ? diffEntry.oldText : '';
      diff = {
        path: diffEntry.path,
        unified: buildUnifiedDiff(diffEntry.path, oldText, diffEntry.newText),
      };
    } else if (entry.type === 'terminal') {
      bodyParts.push(`_(terminal output id: ${entry.terminalId})_`);
    } else {
      assertNever(entry);
    }
  }

  const folded: FoldedToolContent = {};
  if (bodyParts.length > 0) {
    folded.body = bodyParts.join('\n\n');
  }
  if (diff) folded.diff = diff;
  return folded;
}

function buildUnifiedDiff(path: string, oldText: string, newText: string): string {
  // Minimal unified diff — Termy's renderer just needs the textual
  // payload inside a fenced ```diff block. A full diff library is
  // overkill; render the before/after as fenced sections.
  const oldLines = oldText.split('\n').map((line) => `-${line}`);
  const newLines = newText.split('\n').map((line) => `+${line}`);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@',
    ...oldLines,
    ...newLines,
  ].join('\n');
}

function extractTextFromContentBlock(block: AcpContentBlock): string {
  if (typeof block !== 'object' || block === null) {
    throw new Error('ACP content block must be an object');
  }
  const type = (block as { type?: unknown }).type;
  if (type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
    return (block as { text: string }).text;
  }
  if (type === 'resource_link') {
    const rl = block as { uri?: unknown; name?: unknown };
    const uri = requireString(rl.uri, 'ACP resource_link.uri');
    return typeof rl.name === 'string' && rl.name.length > 0
      ? `[${rl.name}](${uri})`
      : uri;
  }
  if (type === 'resource') {
    const r = block as { resource?: { uri?: string; text?: string } };
    if (typeof r.resource?.text === 'string') return r.resource.text;
    if (typeof r.resource?.uri === 'string') return r.resource.uri;
    throw new Error('ACP resource block must include resource.text or resource.uri');
  }
  throw new Error(`Unsupported ACP content block type: ${String(type)}`);
}

function mapToolKind(kind: AcpToolKind | undefined): AgentToolKind {
  switch (kind) {
    case 'read': return 'read_file';
    case 'edit': return 'edit_file';
    case 'delete': return 'delete_file';
    case 'search': return 'search';
    case 'execute': return 'terminal';
    case 'fetch': return 'fetch';
    case 'move':
    case 'think':
    case 'other':
    case undefined:
      return 'other';
    default:
      throw new Error(`Unsupported ACP tool kind: ${String(kind)}`);
  }
}

function mapToolStatus(
  status: AcpToolStatus | undefined,
  defaultStatus: AgentToolStatus,
): AgentToolStatus {
  switch (status) {
    case 'pending': return 'pending';
    case 'in_progress': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case undefined:
      return defaultStatus;
    default:
      throw new Error(`Unsupported ACP tool status: ${String(status)}`);
  }
}

function mapPlanStatus(
  status: AcpPlanEntry['status'] | undefined,
): 'pending' | 'in-progress' | 'completed' | 'failed' {
  switch (status) {
    case 'in_progress': return 'in-progress';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'pending':
    case undefined:
      return 'pending';
    default:
      throw new Error(`Unsupported ACP plan status: ${String(status)}`);
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function requireStringValue(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  return value;
}

function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value;
}

function requireDiffToolContent(entry: AcpToolCallContent): {
  readonly path: string;
  readonly oldText?: unknown;
  readonly newText: string;
} {
  const candidate = entry as { path?: unknown; oldText?: unknown; newText?: unknown };
  return {
    path: requireString(candidate.path, 'ACP diff content path'),
    oldText: candidate.oldText,
    newText: requireStringValue(candidate.newText, 'ACP diff content newText'),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported ACP variant: ${JSON.stringify(value)}`);
}
