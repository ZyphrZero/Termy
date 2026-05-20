/**
 * Pure adapter: Claude Code native messages → AgentEvent[].
 *
 * Two entry points:
 *   - {@link adaptClaudeTranscriptToEvents}: batch-converts a full
 *     JSONL transcript (for "load history into panel").
 *   - {@link adaptClaudeStreamLine}: converts a single stream-json
 *     stdout line (for live streaming during a resume/new turn).
 *
 * The adapter is intentionally permissive: unknown message types are
 * silently skipped so a CLI upgrade never breaks the panel.
 */

import type {
  AgentEvent,
  AgentSessionId,
  AgentToolKind,
  AgentToolStatus,
} from '../../agentStream/agentEventTypes.ts';
import type { ClaudeContentBlock, ClaudeNativeMessage, ClaudeStreamEvent } from './claudeCodeTypes.ts';

/**
 * Convert a full on-disk transcript into events suitable for
 * `AgentSessionModel.applyEventsBatch`.
 */
export function adaptClaudeTranscriptToEvents(
  sessionId: AgentSessionId,
  messages: ReadonlyArray<ClaudeNativeMessage>,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const msg of messages) {
    pushMessageEvents(events, sessionId, msg);
  }
  return events;
}

/**
 * Convert a single stream-json stdout line into zero or more events.
 * Called on every line the child process emits during a live turn.
 */
export function adaptClaudeStreamLine(
  sessionId: AgentSessionId,
  msg: ClaudeNativeMessage,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  if (msg.type === 'stream_event' && msg.event) {
    pushStreamEvent(events, sessionId, msg.event);
    return events;
  }

  if (msg.type === 'result') {
    events.push({
      kind: 'session-state',
      sessionId,
      state: msg.is_error ? 'errored' : 'awaiting-input',
      detail: msg.is_error ? (msg.result ?? 'Turn failed') : 'Turn complete',
    });
    return events;
  }

  // During --include-partial-messages, the CLI also emits full
  // `assistant` messages after each content block completes. We
  // skip these because the stream_event deltas already fed the
  // model incrementally — re-applying the full message would
  // duplicate text.
  return events;
}

function pushMessageEvents(
  events: AgentEvent[],
  sessionId: AgentSessionId,
  msg: ClaudeNativeMessage,
): void {
  switch (msg.type) {
    case 'user':
      pushUserMessage(events, sessionId, msg);
      return;
    case 'assistant':
      pushAssistantMessage(events, sessionId, msg);
      return;
    case 'result':
      // In transcript replay, `result` is informational — we don't
      // need to emit a state event because the panel is already in
      // "loaded" state.
      return;
    default:
      // ai-title, permission-mode, file-history-snapshot, attachment,
      // system, stream_event, queue-operation — none belong in the
      // transcript view.
      return;
  }
}

function pushUserMessage(
  events: AgentEvent[],
  sessionId: AgentSessionId,
  msg: ClaudeNativeMessage,
): void {
  const content = msg.message?.content;
  const text = typeof content === 'string'
    ? content
    : extractTextFromBlocks(content);
  if (text.length === 0) return;

  // Truncate very long user messages in the panel (e.g. pasted files).
  const display = text.length > 2000 ? `${text.slice(0, 1997)}…` : text;
  events.push({ kind: 'text', sessionId, channel: 'final', delta: `\n\n**You:** ${display}\n\n` });
  events.push({ kind: 'text-done', sessionId, channel: 'final' });
}

function pushAssistantMessage(
  events: AgentEvent[],
  sessionId: AgentSessionId,
  msg: ClaudeNativeMessage,
): void {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return;

  for (const b of content) {
    switch (b.type) {
      case 'text':
        if (b.text && b.text.length > 0) {
          events.push({ kind: 'text', sessionId, channel: 'final', delta: b.text });
          events.push({ kind: 'text-done', sessionId, channel: 'final' });
        }
        break;
      case 'thinking':
        if (b.thinking && b.thinking.length > 0) {
          events.push({ kind: 'text', sessionId, channel: 'thought', delta: b.thinking });
          events.push({ kind: 'text-done', sessionId, channel: 'thought' });
        }
        break;
      case 'tool_use':
        pushToolUseBlock(events, sessionId, b);
        break;
      default:
        break;
    }
  }
}

function pushToolUseBlock(
  events: AgentEvent[],
  sessionId: AgentSessionId,
  block: ClaudeContentBlock,
): void {
  const toolCallId = block.id ?? `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const toolName = block.name ?? 'tool';
  const subtitle = describeToolInput(block.input);

  events.push({
    kind: 'tool-call',
    sessionId,
    toolCallId,
    toolName,
    toolKind: mapToolKind(toolName),
    title: toolName,
    subtitle,
    status: 'completed' as AgentToolStatus,
  });
}

function pushStreamEvent(
  events: AgentEvent[],
  sessionId: AgentSessionId,
  streamEvent: ClaudeStreamEvent,
): void {
  switch (streamEvent.type) {
    case 'content_block_delta': {
      const delta = streamEvent.delta;
      if (!delta) return;
      if (delta.type === 'text_delta' && delta.text) {
        events.push({ kind: 'text', sessionId, channel: 'final', delta: delta.text });
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        events.push({ kind: 'text', sessionId, channel: 'thought', delta: delta.thinking });
      }
      return;
    }
    case 'content_block_stop': {
      // We don't know which channel just stopped from the event
      // alone, but emitting text-done on both is safe — the model
      // ignores done events for channels that have no active block.
      events.push({ kind: 'text-done', sessionId, channel: 'final' });
      events.push({ kind: 'text-done', sessionId, channel: 'thought' });
      return;
    }
    case 'content_block_start': {
      const block = streamEvent.content_block;
      if (block?.type === 'tool_use') {
        // Tool use blocks are announced at start; we emit a pending
        // tool-call card. The CLI will later emit the full assistant
        // message with the completed tool, but we skip that (see
        // adaptClaudeStreamLine).
        const toolCallId = (block as { id?: string }).id ?? `tool-stream-${Date.now()}`;
        const toolName = (block as { name?: string }).name ?? 'tool';
        events.push({
          kind: 'tool-call',
          sessionId,
          toolCallId,
          toolName,
          toolKind: mapToolKind(toolName),
          title: toolName,
          status: 'running',
        });
      }
      return;
    }
    default:
      // message_start, message_delta, message_stop — lifecycle
      // signals we don't need to surface in the transcript.
      return;
  }
}

function extractTextFromBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as { type?: string; text?: string };
      if (b.type === 'text' && typeof b.text === 'string') {
        parts.push(b.text);
      }
    }
  }
  return parts.join('').trim();
}

function mapToolKind(toolName: string): AgentToolKind {
  const lower = toolName.toLowerCase();
  if (lower === 'read' || lower.includes('read')) return 'read_file';
  if (lower === 'edit' || lower === 'write' || lower.includes('edit')) return 'edit_file';
  if (lower === 'bash' || lower === 'powershell' || lower.includes('shell')) return 'terminal';
  if (lower === 'glob' || lower === 'grep' || lower.includes('search')) return 'search';
  if (lower === 'webfetch' || lower === 'websearch' || lower.includes('fetch')) return 'fetch';
  return 'other';
}

function describeToolInput(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const candidates = [record.file_path, record.path, record.command, record.pattern, record.query, record.url];
  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 200 ? `${value.slice(0, 197)}…` : value;
    }
  }
  return undefined;
}
