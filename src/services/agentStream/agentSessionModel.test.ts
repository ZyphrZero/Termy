import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentSessionModel } from './agentSessionModel.ts';
import type { AgentEvent, AgentEventEnvelope } from './agentEventTypes.ts';

let nextId = 1;
function envelope(event: AgentEvent): AgentEventEnvelope {
  return {
    id: String(nextId++),
    timestamp: 0,
    source: 'test',
    event,
  };
}

test('AgentSessionModel concatenates streaming text chunks into one block', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({ kind: 'text', sessionId: 's1', channel: 'final', delta: 'Hello, ' }));
  model.apply(envelope({ kind: 'text', sessionId: 's1', channel: 'final', delta: 'world!' }));

  const snapshot = model.getSnapshot('s1');
  assert.ok(snapshot);
  assert.equal(snapshot.blocks.length, 1);
  const block = snapshot.blocks[0];
  assert.equal(block.kind, 'text');
  if (block.kind === 'text') {
    assert.equal(block.body, 'Hello, world!');
    assert.equal(block.streaming, true);
  }
});

test('AgentSessionModel seals a streaming block on text-done', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({ kind: 'text', sessionId: 's1', channel: 'final', delta: 'Hi' }));
  model.apply(envelope({ kind: 'text-done', sessionId: 's1', channel: 'final' }));
  model.apply(envelope({ kind: 'text', sessionId: 's1', channel: 'final', delta: 'World' }));

  const snapshot = model.getSnapshot('s1');
  assert.ok(snapshot);
  assert.equal(snapshot.blocks.length, 2);
  const first = snapshot.blocks[0];
  if (first.kind === 'text') {
    assert.equal(first.streaming, false);
  }
});

test('AgentSessionModel patches tool-call updates in place', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({
    kind: 'tool-call',
    sessionId: 's1',
    toolCallId: 't1',
    toolName: 'read_file',
    toolKind: 'read_file',
    title: 'Read note',
    status: 'running',
  }));
  model.apply(envelope({
    kind: 'tool-call-update',
    sessionId: 's1',
    toolCallId: 't1',
    status: 'completed',
    body: 'Read 12 lines',
  }));

  const snapshot = model.getSnapshot('s1');
  assert.ok(snapshot);
  assert.equal(snapshot.blocks.length, 1);
  const block = snapshot.blocks[0];
  if (block.kind === 'tool') {
    assert.equal(block.status, 'completed');
    assert.equal(block.body, 'Read 12 lines');
  } else {
    assert.fail('expected tool block');
  }
});

test('AgentSessionModel ignores updates for unknown tool ids', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({
    kind: 'tool-call-update',
    sessionId: 's1',
    toolCallId: 'ghost',
    status: 'completed',
  }));
  const snapshot = model.getSnapshot('s1');
  assert.ok(snapshot);
  assert.equal(snapshot.blocks.length, 0);
});

test('AgentSessionModel notifies subscribers on apply and reset', () => {
  const model = new AgentSessionModel();
  const seen: string[] = [];
  model.subscribe((sessionId) => seen.push(sessionId));

  model.apply(envelope({ kind: 'text', sessionId: 's1', channel: 'final', delta: 'hi' }));
  model.reset('s1');

  assert.deepEqual(seen, ['s1', 's1']);
  assert.equal(model.getSnapshot('s1'), null);
});

test('AgentSessionModel.resetAll clears every session', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({ kind: 'text', sessionId: 's1', channel: 'final', delta: 'a' }));
  model.apply(envelope({ kind: 'text', sessionId: 's2', channel: 'final', delta: 'b' }));

  model.resetAll();
  assert.equal(model.getAllSnapshots().length, 0);
});

test('AgentSessionModel.renameSession moves blocks to the new id', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({ kind: 'text', sessionId: 'placeholder', channel: 'final', delta: 'hi' }));
  model.apply(envelope({ kind: 'text-done', sessionId: 'placeholder', channel: 'final' }));

  const seen: string[] = [];
  model.subscribe((id) => seen.push(id));

  model.renameSession('placeholder', 'real-id');

  assert.equal(model.getSnapshot('placeholder'), null);
  const snap = model.getSnapshot('real-id');
  assert.ok(snap);
  assert.equal(snap?.blocks.length, 1);
  assert.deepEqual(seen, ['placeholder', 'real-id']);
});

test('AgentSessionModel.renameSession is a no-op when source is missing', () => {
  const model = new AgentSessionModel();
  let notified = 0;
  model.subscribe(() => notified++);
  model.renameSession('missing', 'other');
  assert.equal(notified, 0);
  assert.equal(model.getSnapshot('other'), null);
});

test('AgentSessionModel.renameSession drops placeholder when destination exists', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({ kind: 'text', sessionId: 'placeholder', channel: 'final', delta: 'a' }));
  model.apply(envelope({ kind: 'text', sessionId: 'real', channel: 'final', delta: 'b' }));

  model.renameSession('placeholder', 'real');

  assert.equal(model.getSnapshot('placeholder'), null);
  const realSnap = model.getSnapshot('real');
  assert.ok(realSnap);
  // The destination keeps its original blocks; the placeholder is dropped.
  assert.equal(realSnap?.blocks[0].kind, 'text');
});

test('AgentSessionModel deep-copies snapshots', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({
    kind: 'plan',
    sessionId: 's1',
    steps: [{ id: 'p1', title: 'one', status: 'pending' }],
  }));
  const snap = model.getSnapshot('s1');
  assert.ok(snap);
  snap.plan[0].title = 'mutated';

  const fresh = model.getSnapshot('s1');
  assert.ok(fresh);
  assert.equal(fresh.plan[0].title, 'one');
});

test('AgentSessionModel sets state to errored on error events', () => {
  const model = new AgentSessionModel();
  model.apply(envelope({ kind: 'error', sessionId: 's1', message: 'boom' }));
  const snap = model.getSnapshot('s1');
  assert.ok(snap);
  assert.equal(snap.state, 'errored');
  assert.equal(snap.blocks.length, 1);
  assert.equal(snap.blocks[0].kind, 'error');
});
