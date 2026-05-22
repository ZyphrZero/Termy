/**
 * Pure adapter: Codex CLI v2 wire payloads → AgentEvent[].
 *
 * Entry point:
 *   - {@link adaptThreadTurnsToEvents}: batch-converts a list of `Turn`
 *     objects (from `thread/resume` or `thread/turns/list`) into
 *     events for `AgentSessionModel.applyEventsBatch`. Used by the
 *     "load history into panel" path.
 *
 * The mapping table for `ThreadItem.type` → AgentEvent kind:
 *
 *   | ThreadItem.type     | AgentEvent kind(s)                           |
 *   |---------------------|----------------------------------------------|
 *   | userMessage         | (skipped — panel renders user input itself) |
 *   | agentMessage        | text(channel=final) + text-done              |
 *   | reasoning           | text(channel=thought) + text-done            |
 *   | plan                | (handled by `turn/plan/updated`)             |
 *   | commandExecution    | tool-call (kind=terminal) + tool-call-update |
 *   | fileChange          | tool-call (kind=edit_file) + tool-call-update with diff |
 *   | mcpToolCall         | tool-call + tool-call-update                 |
 *   | dynamicToolCall     | tool-call + tool-call-update                 |
 *   | webSearch           | tool-call (kind=fetch) + tool-call-update    |
 *   | imageView           | tool-call (kind=read_file)                   |
 *   | contextCompaction   | (informational; skipped in transcript)       |
 *   | <unknown>           | (silently skipped)                           |
 *
 * The adapter is intentionally permissive: unknown payload shapes are
 * silently skipped so a Codex CLI upgrade that adds new variants never
 * breaks the panel.
 */

import type {
  AgentEvent,
  AgentSessionId,
  AgentToolKind,
  AgentToolStatus,
} from '../../agentStream/agentEventTypes.ts';
import type {
  CommandExecutionItem,
  DynamicToolCallItem,
  FileChangeItem,
  ImageViewItem,
  McpToolCallItem,
  ThreadItem,
  Turn,
  WebSearchItem,
} from './codexTypes.ts';

// ─── Transcript (batch) adapter ──────────────────────────────────

/**
 * Convert a list of `Turn` objects (with their `items`) into events
 * suitable for `AgentSessionModel.applyEventsBatch`. This is the
 * "load history" path — used after `thread/resume` or
 * `thread/turns/list`.
 */
export function adaptThreadTurnsToEvents(
  sessionId: AgentSessionId,
  turns: ReadonlyArray<Turn>,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      events.push(...itemToCompletedEvents(sessionId, item));
    }
  }
  return events;
}

// ─── ThreadItem dispatch ─────────────────────────────────────────

function itemToCompletedEvents(sessionId: AgentSessionId, item: ThreadItem): AgentEvent[] {
  switch (item.type) {
    case 'userMessage':
      // Skipped — the panel renders user input from its own model.
      return [];

    case 'agentMessage': {
      const text = (item as { text?: string }).text ?? '';
      if (text.length === 0) return [];
      return [
        { kind: 'text', sessionId, channel: 'final', delta: text },
        { kind: 'text-done', sessionId, channel: 'final' },
      ];
    }

    case 'reasoning': {
      const reasoning = item as { summary?: string[]; content?: string[] };
      const parts = [
        ...(reasoning.summary ?? []).filter((s): s is string => typeof s === 'string' && s.length > 0),
        ...(reasoning.content ?? []).filter((s): s is string => typeof s === 'string' && s.length > 0),
      ];
      const text = parts.join('\n');
      if (text.length === 0) return [];
      return [
        { kind: 'text', sessionId, channel: 'thought', delta: text },
        { kind: 'text-done', sessionId, channel: 'thought' },
      ];
    }

    case 'plan':
      // Plan items do not surface as transcript blocks; the renderer
      // shows the live plan via `turn/plan/updated` events.
      return [];

    case 'commandExecution': {
      const exec = item as CommandExecutionItem;
      const events: AgentEvent[] = [];
      // Emit a started event for transcript replay so the card exists.
      events.push({
        kind: 'tool-call',
        sessionId,
        toolCallId: exec.id,
        toolName: 'commandExecution',
        toolKind: 'terminal',
        title: 'Run command',
        subtitle: truncate(exec.command, 120),
        status: 'running',
      });
      events.push({
        kind: 'tool-call-update',
        sessionId,
        toolCallId: exec.id,
        status: mapCommandExecStatus(exec.status),
        output: exec.aggregatedOutput ?? undefined,
        exitCode: typeof exec.exitCode === 'number' ? exec.exitCode : undefined,
      });
      return events;
    }

    case 'fileChange': {
      const fileChange = item as FileChangeItem;
      const events: AgentEvent[] = [];
      const firstPath = fileChange.changes?.[0]?.path;
      events.push({
        kind: 'tool-call',
        sessionId,
        toolCallId: fileChange.id,
        toolName: 'fileChange',
        toolKind: 'edit_file',
        title: 'Edit files',
        subtitle: firstPath ? truncate(firstPath, 120) : undefined,
        status: 'running',
      });
      const unifiedDiff = composeUnifiedDiff(fileChange);
      events.push({
        kind: 'tool-call-update',
        sessionId,
        toolCallId: fileChange.id,
        status: mapPatchApplyStatus(fileChange.status),
        diff: unifiedDiff
          ? { unified: unifiedDiff, path: firstPath ?? undefined }
          : undefined,
      });
      return events;
    }

    case 'mcpToolCall': {
      const mcp = item as McpToolCallItem;
      const events: AgentEvent[] = [];
      events.push({
        kind: 'tool-call',
        sessionId,
        toolCallId: mcp.id,
        toolName: `${mcp.server}/${mcp.tool}`,
        toolKind: inferToolKindFromName(mcp.tool),
        title: mcp.tool,
        subtitle: mcp.server,
        status: 'running',
      });
      events.push({
        kind: 'tool-call-update',
        sessionId,
        toolCallId: mcp.id,
        status: mapMcpStatus(mcp.status, mcp.error),
        body: stringifyToolResult(mcp.result),
      });
      return events;
    }

    case 'dynamicToolCall': {
      const dyn = item as DynamicToolCallItem;
      const events: AgentEvent[] = [];
      events.push({
        kind: 'tool-call',
        sessionId,
        toolCallId: dyn.id,
        toolName: dyn.tool,
        toolKind: inferToolKindFromName(dyn.tool),
        title: dyn.tool,
        subtitle: dyn.namespace ?? undefined,
        status: 'running',
      });
      events.push({
        kind: 'tool-call-update',
        sessionId,
        toolCallId: dyn.id,
        status: mapDynamicToolStatus(dyn.status, dyn.success),
        body: stringifyToolResult(dyn.contentItems),
      });
      return events;
    }

    case 'webSearch': {
      const search = item as WebSearchItem;
      const events: AgentEvent[] = [];
      events.push({
        kind: 'tool-call',
        sessionId,
        toolCallId: search.id,
        toolName: 'webSearch',
        toolKind: 'fetch',
        title: 'Web search',
        subtitle: truncate(search.query, 120),
        status: 'running',
      });
      events.push({
        kind: 'tool-call-update',
        sessionId,
        toolCallId: search.id,
        status: 'completed',
      });
      return events;
    }

    case 'imageView': {
      const view = item as ImageViewItem;
      return [{
        kind: 'tool-call',
        sessionId,
        toolCallId: view.id,
        toolName: 'imageView',
        toolKind: 'read_file',
        title: 'View image',
        subtitle: truncate(view.path, 120),
        status: 'completed',
      }];
    }

    case 'contextCompaction':
    default:
      return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function inferToolKindFromName(name: string): AgentToolKind {
  const lower = name.toLowerCase();
  if (lower.includes('read')) return 'read_file';
  if (lower.includes('write') || lower.includes('edit') || lower.includes('patch')) return 'edit_file';
  if (lower.includes('create')) return 'create_file';
  if (lower.includes('delete') || lower.includes('remove')) return 'delete_file';
  if (lower.includes('search') || lower.includes('grep') || lower.includes('find')) return 'search';
  if (
    lower.includes('bash') ||
    lower.includes('shell') ||
    lower.includes('exec') ||
    lower.includes('terminal') ||
    lower.includes('command')
  ) return 'terminal';
  if (lower.includes('fetch') || lower.includes('http')) return 'fetch';
  return 'other';
}

function mapCommandExecStatus(status: string): AgentToolStatus {
  switch (status) {
    case 'inProgress': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    default: return 'completed';
  }
}

function mapPatchApplyStatus(status: string): AgentToolStatus {
  switch (status) {
    case 'inProgress': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    default: return 'completed';
  }
}

function mapMcpStatus(status: string, error: unknown): AgentToolStatus {
  if (error) return 'failed';
  switch (status) {
    case 'inProgress': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    default: return 'completed';
  }
}

function mapDynamicToolStatus(status: string, success: boolean | null | undefined): AgentToolStatus {
  if (success === false) return 'failed';
  switch (status) {
    case 'inProgress': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    default: return 'completed';
  }
}

function truncate(text: string | undefined | null, max: number): string | undefined {
  if (!text) return undefined;
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function stringifyToolResult(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

/**
 * Combine the per-file `unifiedDiff` strings from a `fileChange` item
 * into a single unified-diff payload for the renderer. When no
 * unified diff is available we return undefined so the renderer falls
 * back to the structured changes list.
 */
function composeUnifiedDiff(fileChange: FileChangeItem): string | undefined {
  const sections: string[] = [];
  for (const change of fileChange.changes ?? []) {
    const diff = (change as { unifiedDiff?: string | null }).unifiedDiff;
    if (typeof diff === 'string' && diff.length > 0) {
      sections.push(diff);
    }
  }
  if (sections.length === 0) return undefined;
  return sections.join('\n');
}
