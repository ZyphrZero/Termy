import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptMessageToEvents,
  adaptTranscriptToEvents,
} from './opencodeMessageAdapter.ts';
import type { OpenCodeMessageWithParts } from './opencodeHttpClient.ts';

const SESSION = 'opencode:test-session';

test('user message produces a single text chunk + done', () => {
  const message: OpenCodeMessageWithParts = {
    info: {
      id: 'msg_user_1',
      sessionID: 'ses_1',
      role: 'user',
      time: { created: 1 },
    },
    parts: [
      { id: 'p1', sessionID: 'ses_1', messageID: 'msg_user_1', type: 'text', text: 'hello world' },
    ],
  };

  const events = adaptMessageToEvents(SESSION, message);

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'text');
  if (events[0].kind === 'text') {
    assert.equal(events[0].channel, 'final');
    assert.match(events[0].delta, /\*\*You:\*\* hello world/);
  }
  assert.equal(events[1].kind, 'text-done');
});

test('assistant text + reasoning land on different channels', () => {
  const message: OpenCodeMessageWithParts = {
    info: {
      id: 'msg_assistant_1',
      sessionID: 'ses_1',
      role: 'assistant',
      time: { created: 2 },
    },
    parts: [
      { id: 'p1', sessionID: 'ses_1', messageID: 'msg_assistant_1', type: 'reasoning', text: 'thinking…' },
      { id: 'p2', sessionID: 'ses_1', messageID: 'msg_assistant_1', type: 'text', text: 'Sure thing.' },
    ],
  };

  const events = adaptMessageToEvents(SESSION, message);

  // 2 text events + 2 text-done events (one per channel)
  assert.equal(events.length, 4);
  const reasoning = events.find((e) => e.kind === 'text' && e.channel === 'thought');
  const final = events.find((e) => e.kind === 'text' && e.channel === 'final');
  assert.ok(reasoning);
  assert.ok(final);
});

test('tool part emits a tool-call followed by an update with status', () => {
  const message: OpenCodeMessageWithParts = {
    info: {
      id: 'msg_assistant_1',
      sessionID: 'ses_1',
      role: 'assistant',
      time: { created: 3 },
    },
    parts: [
      {
        id: 'p1',
        sessionID: 'ses_1',
        messageID: 'msg_assistant_1',
        type: 'tool',
        callID: 'call_42',
        tool: 'read',
        state: {
          status: 'completed',
          input: { filePath: 'notes/example.md' },
          output: 'file contents…',
        },
      },
    ],
  };

  const events = adaptMessageToEvents(SESSION, message);

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'tool-call');
  if (events[0].kind === 'tool-call') {
    assert.equal(events[0].toolCallId, 'call_42');
    assert.equal(events[0].toolName, 'read');
    assert.equal(events[0].toolKind, 'read_file');
    assert.equal(events[0].subtitle, 'notes/example.md');
    assert.equal(events[0].status, 'completed');
  }
  assert.equal(events[1].kind, 'tool-call-update');
  if (events[1].kind === 'tool-call-update') {
    assert.equal(events[1].toolCallId, 'call_42');
    assert.equal(events[1].status, 'completed');
    assert.equal(events[1].body, 'file contents…');
  }
});

test('unknown part types are ignored without throwing', () => {
  const message: OpenCodeMessageWithParts = {
    info: {
      id: 'msg_assistant_1',
      sessionID: 'ses_1',
      role: 'assistant',
      time: { created: 4 },
    },
    parts: [
      { id: 'p1', sessionID: 'ses_1', messageID: 'msg_assistant_1', type: 'snapshot', snapshot: 'sha' },
      { id: 'p2', sessionID: 'ses_1', messageID: 'msg_assistant_1', type: 'step-finish' },
      { id: 'p3', sessionID: 'ses_1', messageID: 'msg_assistant_1', type: 'agent', agent: 'general' },
    ],
  };

  const events = adaptMessageToEvents(SESSION, message);
  assert.equal(events.length, 0);
});

test('adaptTranscriptToEvents preserves message order', () => {
  const transcript: OpenCodeMessageWithParts[] = [
    {
      info: { id: 'm1', sessionID: 'ses', role: 'user', time: { created: 1 } },
      parts: [{ id: 'p1', sessionID: 'ses', messageID: 'm1', type: 'text', text: 'first' }],
    },
    {
      info: { id: 'm2', sessionID: 'ses', role: 'assistant', time: { created: 2 } },
      parts: [{ id: 'p1', sessionID: 'ses', messageID: 'm2', type: 'text', text: 'second' }],
    },
  ];

  const events = adaptTranscriptToEvents(SESSION, transcript);
  const finalText = events
    .filter((e) => e.kind === 'text')
    .map((e) => (e.kind === 'text' ? e.delta : ''));
  // 'first' shows up wrapped in **You:** prefix; 'second' is plain.
  assert.match(finalText[0], /first/);
  assert.match(finalText[1], /second/);
});
