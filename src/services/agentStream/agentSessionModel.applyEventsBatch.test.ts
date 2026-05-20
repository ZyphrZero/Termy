import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AgentSessionModel } from './agentSessionModel.ts';
import type { AgentEvent } from './agentEventTypes.ts';

const SESSION = 'opencode:test-session';

test('applyEventsBatch reduces a transcript into the same blocks one-by-one would', () => {
  const events: AgentEvent[] = [
    { kind: 'text', sessionId: SESSION, channel: 'final', delta: '**You:** hi' },
    { kind: 'text-done', sessionId: SESSION, channel: 'final' },
    { kind: 'text', sessionId: SESSION, channel: 'final', delta: 'Hello!' },
    { kind: 'text-done', sessionId: SESSION, channel: 'final' },
  ];

  const batchModel = new AgentSessionModel();
  batchModel.applyEventsBatch(SESSION, events);

  const linearModel = new AgentSessionModel();
  for (const event of events) linearModel.applyEvent(event);

  assert.deepEqual(batchModel.getSnapshot(SESSION), linearModel.getSnapshot(SESSION));
});

test('applyEventsBatch fires one notification regardless of event count', () => {
  const model = new AgentSessionModel();
  let notifications = 0;
  model.subscribe(() => {
    notifications += 1;
  });

  const events: AgentEvent[] = Array.from({ length: 10 }, (_, i) => ({
    kind: 'text',
    sessionId: SESSION,
    channel: 'final',
    delta: `chunk ${i}`,
  }));

  model.applyEventsBatch(SESSION, events);
  assert.equal(notifications, 1);
});

test('applyEventsBatch ignores events for other sessions', () => {
  const model = new AgentSessionModel();
  const events: AgentEvent[] = [
    { kind: 'text', sessionId: SESSION, channel: 'final', delta: 'mine' },
    { kind: 'text', sessionId: 'other', channel: 'final', delta: 'other' },
  ];
  model.applyEventsBatch(SESSION, events);

  const ours = model.getSnapshot(SESSION);
  assert.ok(ours);
  assert.equal(ours.blocks.length, 1);
  assert.equal(model.getSnapshot('other'), null);
});
