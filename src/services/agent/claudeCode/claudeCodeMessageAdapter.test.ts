import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adaptClaudeTranscriptToEvents, adaptClaudeStreamLine } from './claudeCodeMessageAdapter.ts';
import type { ClaudeNativeMessage } from './claudeCodeTypes.ts';

const SESSION = 'claude-code:test-session';

test('user message produces a text chunk with "You:" prefix', () => {
  const msg: ClaudeNativeMessage = {
    type: 'user',
    uuid: 'u1',
    message: { role: 'user', content: 'hello' },
  };
  const events = adaptClaudeTranscriptToEvents(SESSION, [msg]);
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'text');
  if (events[0].kind === 'text') {
    assert.match(events[0].delta, /\*\*You:\*\* hello/);
  }
  assert.equal(events[1].kind, 'text-done');
});

test('assistant text block emits on final channel', () => {
  const msg: ClaudeNativeMessage = {
    type: 'assistant',
    uuid: 'a1',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'world' }],
    },
  };
  const events = adaptClaudeTranscriptToEvents(SESSION, [msg]);
  assert.equal(events.length, 2);
  if (events[0].kind === 'text') {
    assert.equal(events[0].channel, 'final');
    assert.equal(events[0].delta, 'world');
  }
});

test('assistant thinking block emits on thought channel', () => {
  const msg: ClaudeNativeMessage = {
    type: 'assistant',
    uuid: 'a2',
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'hmm' }],
    },
  };
  const events = adaptClaudeTranscriptToEvents(SESSION, [msg]);
  assert.equal(events.length, 2);
  if (events[0].kind === 'text') {
    assert.equal(events[0].channel, 'thought');
    assert.equal(events[0].delta, 'hmm');
  }
});

test('tool_use block emits a tool-call event', () => {
  const msg: ClaudeNativeMessage = {
    type: 'assistant',
    uuid: 'a3',
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'call_1',
        name: 'Read',
        input: { file_path: 'notes/example.md' },
      }],
    },
  };
  const events = adaptClaudeTranscriptToEvents(SESSION, [msg]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'tool-call');
  if (events[0].kind === 'tool-call') {
    assert.equal(events[0].toolCallId, 'call_1');
    assert.equal(events[0].toolName, 'Read');
    assert.equal(events[0].toolKind, 'read_file');
    assert.equal(events[0].subtitle, 'notes/example.md');
  }
});

test('unknown message types are silently skipped', () => {
  const messages: ClaudeNativeMessage[] = [
    { type: 'permission-mode', permissionMode: 'default' },
    { type: 'ai-title', aiTitle: 'Test' },
    { type: 'file-history-snapshot' },
    { type: 'system', subtype: 'init' },
  ];
  const events = adaptClaudeTranscriptToEvents(SESSION, messages);
  assert.equal(events.length, 0);
});

test('adaptClaudeStreamLine handles text_delta stream events', () => {
  const msg: ClaudeNativeMessage = {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'hello' },
    },
  };
  const events = adaptClaudeStreamLine(SESSION, msg);
  assert.equal(events.length, 1);
  if (events[0].kind === 'text') {
    assert.equal(events[0].channel, 'final');
    assert.equal(events[0].delta, 'hello');
  }
});

test('adaptClaudeStreamLine handles thinking_delta stream events', () => {
  const msg: ClaudeNativeMessage = {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'pondering' },
    },
  };
  const events = adaptClaudeStreamLine(SESSION, msg);
  assert.equal(events.length, 1);
  if (events[0].kind === 'text') {
    assert.equal(events[0].channel, 'thought');
    assert.equal(events[0].delta, 'pondering');
  }
});

test('adaptClaudeStreamLine emits awaiting-input on result', () => {
  const msg: ClaudeNativeMessage = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
  };
  const events = adaptClaudeStreamLine(SESSION, msg);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'session-state');
  if (events[0].kind === 'session-state') {
    assert.equal(events[0].state, 'awaiting-input');
  }
});

test('adaptClaudeStreamLine emits errored on error result', () => {
  const msg: ClaudeNativeMessage = {
    type: 'result',
    subtype: 'error',
    is_error: true,
    result: 'API error',
  };
  const events = adaptClaudeStreamLine(SESSION, msg);
  assert.equal(events.length, 1);
  if (events[0].kind === 'session-state') {
    assert.equal(events[0].state, 'errored');
  }
});
