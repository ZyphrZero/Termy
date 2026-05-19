import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptIdeBridgeEvent } from './ideBridgeEventAdapter.ts';

test('adaptIdeBridgeEvent maps client-connected to a running session-state', () => {
  const out = adaptIdeBridgeEvent({
    event: { kind: 'client-connected', clientId: 'c1', clientName: 'claude-code' },
    toolInvocationIndex: 0,
  });

  assert.ok(Array.isArray(out));
  assert.equal(out!.length, 1);
  const event = out![0];
  assert.equal(event.kind, 'session-state');
  if (event.kind === 'session-state') {
    assert.equal(event.sessionId, 'ide-bridge:c1');
    assert.equal(event.state, 'running');
    assert.match(event.detail!, /claude-code connected/);
  }
});

test('adaptIdeBridgeEvent reuses session id for connect and disconnect of the same client', () => {
  const connect = adaptIdeBridgeEvent({
    event: { kind: 'client-connected', clientId: 'c1', clientName: 'claude-code' },
    toolInvocationIndex: 0,
  });
  const disconnect = adaptIdeBridgeEvent({
    event: { kind: 'client-disconnected', clientId: 'c1' },
    toolInvocationIndex: 1,
  });

  const connectSession = connect![0];
  const disconnectSession = disconnect![0];
  assert.ok(connectSession.kind === 'session-state' && disconnectSession.kind === 'session-state');
  assert.equal(connectSession.sessionId, disconnectSession.sessionId);
  assert.equal(disconnectSession.state, 'finished');
});

test('adaptIdeBridgeEvent maps openFile to a read_file tool card with completed status', () => {
  const out = adaptIdeBridgeEvent({
    event: {
      kind: 'tool-invoked',
      clientId: 'c1',
      toolName: 'openFile',
      arguments: { filePath: 'notes/Example.md' },
    },
    toolInvocationIndex: 7,
  });

  assert.ok(Array.isArray(out));
  assert.equal(out!.length, 2);

  const call = out![0];
  assert.equal(call.kind, 'tool-call');
  if (call.kind === 'tool-call') {
    assert.equal(call.sessionId, 'ide-bridge:c1');
    assert.equal(call.toolCallId, 'c1:tool:7');
    assert.equal(call.toolKind, 'read_file');
    assert.equal(call.subtitle, 'notes/Example.md');
    assert.equal(call.status, 'completed');
  }

  const update = out![1];
  assert.equal(update.kind, 'tool-call-update');
  if (update.kind === 'tool-call-update') {
    assert.equal(update.toolCallId, 'c1:tool:7');
    assert.match(update.body!, /notes\/Example\.md/);
  }
});

test('adaptIdeBridgeEvent falls back to a generic card for unknown tools', () => {
  const out = adaptIdeBridgeEvent({
    event: {
      kind: 'tool-invoked',
      clientId: 'c1',
      toolName: 'openDiff',
      arguments: { oldPath: 'a.ts', newPath: 'b.ts' },
    },
    toolInvocationIndex: 1,
  });

  assert.ok(Array.isArray(out));
  assert.equal(out!.length, 1);
  const call = out![0];
  if (call.kind === 'tool-call') {
    assert.equal(call.toolKind, 'other');
    assert.equal(call.toolName, 'openDiff');
    assert.match(call.subtitle!, /oldPath: a\.ts/);
  } else {
    assert.fail('expected tool-call event');
  }
});

test('adaptIdeBridgeEvent omits subtitle when arguments are empty', () => {
  const out = adaptIdeBridgeEvent({
    event: {
      kind: 'tool-invoked',
      clientId: 'c1',
      toolName: 'rename',
      arguments: {},
    },
    toolInvocationIndex: 2,
  });

  const call = out![0];
  if (call.kind === 'tool-call') {
    assert.equal(call.subtitle, undefined);
  } else {
    assert.fail('expected tool-call event');
  }
});

test('adaptIdeBridgeEvent truncates very long argument summaries', () => {
  const longArg = 'a'.repeat(500);
  const out = adaptIdeBridgeEvent({
    event: {
      kind: 'tool-invoked',
      clientId: 'c1',
      toolName: 'paste',
      arguments: { text: longArg },
    },
    toolInvocationIndex: 1,
  });

  const call = out![0];
  if (call.kind === 'tool-call') {
    assert.ok(call.subtitle!.endsWith('…'));
    assert.ok(call.subtitle!.length <= 200);
  } else {
    assert.fail('expected tool-call event');
  }
});

test('adaptIdeBridgeEvent stringifies non-primitive arguments as [object]', () => {
  const out = adaptIdeBridgeEvent({
    event: {
      kind: 'tool-invoked',
      clientId: 'c1',
      toolName: 'rich',
      arguments: { config: { nested: 1 } },
    },
    toolInvocationIndex: 1,
  });

  const call = out![0];
  if (call.kind === 'tool-call') {
    assert.match(call.subtitle!, /config: \[object\]/);
  } else {
    assert.fail('expected tool-call event');
  }
});

test('adaptIdeBridgeEvent flags openFile without filePath gracefully', () => {
  const out = adaptIdeBridgeEvent({
    event: {
      kind: 'tool-invoked',
      clientId: 'c1',
      toolName: 'openFile',
      arguments: {},
    },
    toolInvocationIndex: 1,
  });

  assert.equal(out!.length, 2);
  const call = out![0];
  if (call.kind === 'tool-call') {
    assert.equal(call.subtitle, undefined);
    assert.equal(call.title, 'Open file');
  } else {
    assert.fail('expected tool-call event');
  }
});
