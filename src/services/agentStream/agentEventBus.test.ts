import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentEventBus } from './agentEventBus.ts';
import type { AgentEvent, AgentEventEnvelope } from './agentEventTypes.ts';
import type { AgentEventPublisher, AgentEventSource } from './agentEventSource.ts';

class CapturingSource implements AgentEventSource {
  readonly name: string;
  private publish: AgentEventPublisher | null = null;
  startCount = 0;
  stopCount = 0;

  constructor(name: string) {
    this.name = name;
  }

  start(publish: AgentEventPublisher): Promise<void> {
    this.startCount += 1;
    this.publish = publish;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopCount += 1;
    this.publish = null;
    return Promise.resolve();
  }

  emit(event: AgentEvent): void {
    if (!this.publish) {
      throw new Error(`Source ${this.name} not started`);
    }
    this.publish(event);
  }
}

function textEvent(delta: string): AgentEvent {
  return { kind: 'text', sessionId: 'session-1', channel: 'final', delta };
}

test('AgentEventBus stamps envelopes with monotonically increasing ids', async () => {
  const bus = new AgentEventBus();
  bus.setClockForTesting(() => 1_700_000_000_000);

  const source = new CapturingSource('src-a');
  await bus.addSource(source);

  const received: AgentEventEnvelope[] = [];
  bus.subscribe((envelope) => {
    received.push(envelope);
  });

  source.emit(textEvent('alpha'));
  source.emit(textEvent('beta'));

  assert.equal(received.length, 2);
  assert.equal(received[0].id, '1');
  assert.equal(received[1].id, '2');
  assert.equal(received[0].source, 'src-a');
  assert.equal(received[0].timestamp, 1_700_000_000_000);
});

test('AgentEventBus replays buffered events to late subscribers', async () => {
  const bus = new AgentEventBus({ replayBufferSize: 4 });
  const source = new CapturingSource('src-a');
  await bus.addSource(source);

  source.emit(textEvent('one'));
  source.emit(textEvent('two'));
  source.emit(textEvent('three'));

  const received: string[] = [];
  bus.subscribe((envelope) => {
    if (envelope.event.kind === 'text') {
      received.push(envelope.event.delta);
    }
  });

  assert.deepEqual(received, ['one', 'two', 'three']);
});

test('AgentEventBus replay buffer drops oldest events past the limit', async () => {
  const bus = new AgentEventBus({ replayBufferSize: 2 });
  const source = new CapturingSource('src-a');
  await bus.addSource(source);

  source.emit(textEvent('one'));
  source.emit(textEvent('two'));
  source.emit(textEvent('three'));

  const received: string[] = [];
  bus.subscribe((envelope) => {
    if (envelope.event.kind === 'text') {
      received.push(envelope.event.delta);
    }
  });

  assert.deepEqual(received, ['two', 'three']);
});

test('AgentEventBus allows subscribers to unsubscribe mid-iteration', async () => {
  const bus = new AgentEventBus({ replayBufferSize: 0 });
  const source = new CapturingSource('src-a');
  await bus.addSource(source);

  const aDeltas: string[] = [];
  const bDeltas: string[] = [];

  let unsubscribeA: (() => void) | null = null;
  unsubscribeA = bus.subscribe((envelope) => {
    if (envelope.event.kind === 'text') {
      aDeltas.push(envelope.event.delta);
      if (envelope.event.delta === 'second') {
        unsubscribeA?.();
      }
    }
  });
  bus.subscribe((envelope) => {
    if (envelope.event.kind === 'text') {
      bDeltas.push(envelope.event.delta);
    }
  });

  source.emit(textEvent('first'));
  source.emit(textEvent('second'));
  source.emit(textEvent('third'));

  assert.deepEqual(aDeltas, ['first', 'second']);
  assert.deepEqual(bDeltas, ['first', 'second', 'third']);
});

test('AgentEventBus isolates subscriber errors from other subscribers', async () => {
  const errors: unknown[] = [];
  const bus = new AgentEventBus({
    replayBufferSize: 0,
    onSubscriberError: (err) => errors.push(err),
  });
  const source = new CapturingSource('src-a');
  await bus.addSource(source);

  bus.subscribe(() => {
    throw new Error('boom');
  });
  const goodReceived: string[] = [];
  bus.subscribe((envelope) => {
    if (envelope.event.kind === 'text') {
      goodReceived.push(envelope.event.delta);
    }
  });

  source.emit(textEvent('hello'));

  assert.equal(goodReceived.length, 1);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /boom/);
});

test('AgentEventBus replaces a source registered under the same name', async () => {
  const bus = new AgentEventBus({ replayBufferSize: 0 });
  const first = new CapturingSource('shared');
  const second = new CapturingSource('shared');

  await bus.addSource(first);
  await bus.addSource(second);

  assert.equal(first.stopCount, 1, 'first source stopped when replaced');
  assert.equal(second.startCount, 1);
  assert.equal(bus.sourceCount, 1);
});

test('AgentEventBus.stopAll stops every registered source', async () => {
  const bus = new AgentEventBus({ replayBufferSize: 0 });
  const a = new CapturingSource('a');
  const b = new CapturingSource('b');
  await bus.addSource(a);
  await bus.addSource(b);

  await bus.stopAll();

  assert.equal(a.stopCount, 1);
  assert.equal(b.stopCount, 1);
  assert.equal(bus.sourceCount, 0);
});
