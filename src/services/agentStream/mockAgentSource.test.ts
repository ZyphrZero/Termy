import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentEventBus } from './agentEventBus.ts';
import { MockAgentSource } from './mockAgentSource.ts';
import type { AgentEventEnvelope } from './agentEventTypes.ts';

/**
 * Synchronous scheduler that runs scheduled callbacks immediately.
 * The mock source still operates step by step (each `start` -> step ->
 * recurse), so we get deterministic ordering without real timers.
 */
function syncScheduler(callback: () => void, _ms: number): unknown {
  callback();
  return null;
}

function noopCancel(_handle: unknown): void {
  /* no-op for the synchronous scheduler */
}

test('MockAgentSource fires every scripted event in order through the bus', async () => {
  const bus = new AgentEventBus({ replayBufferSize: 1024 });
  const source = new MockAgentSource({
    scheduler: syncScheduler,
    cancelScheduler: noopCancel,
  });

  const received: AgentEventEnvelope[] = [];
  bus.subscribe((envelope) => {
    received.push(envelope);
  });

  await bus.addSource(source);

  // The first event should be a session-state announcement.
  assert.equal(received[0]?.event.kind, 'session-state');
  // The script ends with a 'session-state' transition to 'finished'.
  const finished = received.find(
    (e) => e.event.kind === 'session-state' && e.event.state === 'finished',
  );
  assert.ok(finished, 'mock script should reach a finished session-state');

  // Every text chunk in the script should belong to a single session.
  const sessionIds = new Set(
    received.flatMap((e) => ('sessionId' in e.event ? [e.event.sessionId] : [])),
  );
  assert.equal(sessionIds.size, 1, 'mock source emits a single session');
});

test('MockAgentSource stops emitting after stop()', async () => {
  const bus = new AgentEventBus({ replayBufferSize: 0 });
  const queue: Array<{ cb: () => void; ms: number }> = [];
  const handles = new Set<{ cb: () => void; ms: number }>();
  const source = new MockAgentSource({
    scheduler: (cb, ms) => {
      const handle = { cb, ms };
      queue.push(handle);
      handles.add(handle);
      return handle;
    },
    cancelScheduler: (handle) => {
      handles.delete(handle as { cb: () => void; ms: number });
    },
  });

  let received = 0;
  bus.subscribe(() => {
    received += 1;
  });
  await bus.addSource(source);

  // First step has delayMs: 0 in the script and fires synchronously.
  assert.equal(received, 1);

  // Drain one scheduled tick then stop.
  const next = queue.shift();
  next?.cb();
  const beforeStop = received;

  await source.stop();

  // Any remaining scheduled callbacks check `running` and exit silently.
  while (queue.length > 0) {
    const tick = queue.shift();
    tick?.cb();
  }

  assert.equal(received, beforeStop, 'no events emitted after stop');
});
