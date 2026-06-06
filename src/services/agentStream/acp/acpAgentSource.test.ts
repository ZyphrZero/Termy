import test from 'node:test';
import assert from 'node:assert/strict';

import { JsonRpcLineDecoder, encodeJsonRpcFrame } from './jsonRpcLine.ts';
import { AcpAgentSource } from './acpAgentSource.ts';
import type { AgentEvent } from '../agentEventTypes.ts';
import type { AcpTransport } from './acpClient.ts';

class FakeTransport implements AcpTransport {
  private readonly dataListeners = new Set<(chunk: Buffer) => void>();
  readonly sent: Buffer[] = [];

  start(): Promise<void> {
    return Promise.resolve();
  }

  send(frame: Buffer): void {
    this.sent.push(frame);
  }

  onData(listener: (chunk: Buffer) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onLog(listener: (text: string) => void): () => void {
    void listener;
    return () => undefined;
  }

  onClose(listener: (reason: string) => void): () => void {
    void listener;
    return () => undefined;
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  emit(payload: unknown): void {
    const frame = encodeJsonRpcFrame(payload);
    for (const listener of this.dataListeners) listener(frame);
  }

  popSent(): { method?: string; id?: number; params?: unknown } {
    const next = this.sent.shift();
    assert.ok(next, 'expected an outbound JSON-RPC frame');
    const decoder = new JsonRpcLineDecoder();
    const [frame] = decoder.feed(next);
    assert.equal(frame?.kind, 'message');
    return frame.payload as never;
  }
}

test('AcpAgentSource creates distinct ACP sessions and publishes panel-namespaced events', async () => {
  const transport = new FakeTransport();
  const events: AgentEvent[] = [];
  const source = new AcpAgentSource({
    name: 'acp:claude-code',
    agentId: 'claude-code',
    agentLabel: 'Claude Code',
    cwd: '/tmp/example',
    transportFactory: () => transport,
    clientInfo: { name: 'termy-test', version: '0.0.0' },
    testHooks: {
      scheduleTimeout: noopSchedule,
      cancelTimeout: noopCancel,
    },
  });

  const start = source.start((event) => events.push(event));
  await tick();
  const initialize = transport.popSent();
  assert.equal(initialize.method, 'initialize');
  transport.emit({ jsonrpc: '2.0', id: initialize.id, result: { protocolVersion: 1 } });
  await start;

  const first = source.newSession('/tmp/example');
  await tick();
  const firstNewSession = transport.popSent();
  assert.equal(firstNewSession.method, 'session/new');
  transport.emit({ jsonrpc: '2.0', id: firstNewSession.id, result: { sessionId: 'server-1' } });
  assert.equal(await first, 'server-1');

  transport.emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'server-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    },
  });
  assert.deepEqual(events.map((event) => event.sessionId), [
    'claude-code:server-1',
    'claude-code:server-1',
  ]);

  const second = source.newSession('/tmp/example');
  await tick();
  const secondNewSession = transport.popSent();
  transport.emit({ jsonrpc: '2.0', id: secondNewSession.id, result: { sessionId: 'server-2' } });
  assert.equal(await second, 'server-2');
  assert.equal(events.at(-1)?.sessionId, 'claude-code:server-2');

  const promptDone = source.submitPrompt('server-2', 'Hi');
  await tick();
  const prompt = transport.popSent();
  assert.equal(prompt.method, 'session/prompt');
  assert.equal((prompt.params as { sessionId?: string }).sessionId, 'server-2');
  transport.emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'server-2',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'enriched prompt payload' },
      },
    },
  });
  transport.emit({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } });
  await promptDone;
  const echoedPrompt = events.find((event) => (
    event.kind === 'text' && event.delta.includes('enriched prompt payload')
  ));
  assert.equal(echoedPrompt, undefined);
  assert.equal(events.at(-1)?.sessionId, 'claude-code:server-2');
});

test('AcpAgentSource loads a persisted session and publishes replayed history', async () => {
  const transport = new FakeTransport();
  const events: AgentEvent[] = [];
  const source = new AcpAgentSource({
    name: 'acp:claude-code',
    agentId: 'claude-code',
    agentLabel: 'Claude Code',
    cwd: '/tmp/example',
    transportFactory: () => transport,
    clientInfo: { name: 'termy-test', version: '0.0.0' },
    testHooks: {
      scheduleTimeout: noopSchedule,
      cancelTimeout: noopCancel,
    },
  });

  const start = source.start((event) => events.push(event));
  await tick();
  const initialize = transport.popSent();
  transport.emit({ jsonrpc: '2.0', id: initialize.id, result: { protocolVersion: 1 } });
  await start;

  const load = source.loadSession('history-1', '/tmp/example');
  await tick();
  const loadRequest = transport.popSent();
  assert.equal(loadRequest.method, 'session/load');
  assert.equal((loadRequest.params as { sessionId?: string }).sessionId, 'history-1');

  transport.emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'history-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'old question' },
      },
    },
  });
  transport.emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'history-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'imported reply' },
      },
    },
  });
  transport.emit({ jsonrpc: '2.0', id: loadRequest.id, result: {} });
  await load;

  const textEvents = events.filter((event) => event.kind === 'text');
  assert.equal(textEvents.length, 2);
  assert.equal(textEvents[0]?.sessionId, 'claude-code:history-1');
  assert.match(textEvents[0]?.delta ?? '', /old question/);
  assert.match(textEvents[1]?.delta ?? '', /imported reply/);
  assert.equal(events.at(-1)?.sessionId, 'claude-code:history-1');
});

test('AcpAgentSource shares concurrent loads for the same persisted session', async () => {
  const transport = new FakeTransport();
  const source = new AcpAgentSource({
    name: 'acp:claude-code',
    agentId: 'claude-code',
    agentLabel: 'Claude Code',
    cwd: '/tmp/example',
    transportFactory: () => transport,
    clientInfo: { name: 'termy-test', version: '0.0.0' },
    testHooks: {
      scheduleTimeout: noopSchedule,
      cancelTimeout: noopCancel,
    },
  });

  const start = source.start(() => undefined);
  await tick();
  const initialize = transport.popSent();
  transport.emit({ jsonrpc: '2.0', id: initialize.id, result: { protocolVersion: 1 } });
  await start;

  const first = source.loadSession('history-1', '/tmp/example');
  const second = source.loadSession('history-1', '/tmp/example');
  await tick();

  const loadRequest = transport.popSent();
  assert.equal(loadRequest.method, 'session/load');
  assert.equal(transport.sent.length, 0);

  transport.emit({ jsonrpc: '2.0', id: loadRequest.id, result: {} });
  await Promise.all([first, second]);
});

test('AcpAgentSource lists persisted sessions without adding a cwd filter', async () => {
  const transport = new FakeTransport();
  const source = new AcpAgentSource({
    name: 'acp:claude-code',
    agentId: 'claude-code',
    agentLabel: 'Claude Code',
    cwd: '/tmp/example',
    transportFactory: () => transport,
    clientInfo: { name: 'termy-test', version: '0.0.0' },
    testHooks: {
      scheduleTimeout: noopSchedule,
      cancelTimeout: noopCancel,
    },
  });

  const start = source.start(() => undefined);
  await tick();
  const initialize = transport.popSent();
  transport.emit({ jsonrpc: '2.0', id: initialize.id, result: { protocolVersion: 1 } });
  await start;

  const listed = source.listSessions({});
  await tick();
  const firstList = transport.popSent();
  assert.equal(firstList.method, 'session/list');
  assert.deepEqual(firstList.params, {});
  transport.emit({
    jsonrpc: '2.0',
    id: firstList.id,
    result: {
      sessions: [
        {
          sessionId: 'history-1',
          cwd: '/workspace/one',
          title: 'History one',
          updatedAt: '2026-06-06T00:00:00.000Z',
        },
      ],
      nextCursor: 'next',
    },
  });

  await tick();
  const secondList = transport.popSent();
  assert.equal(secondList.method, 'session/list');
  assert.deepEqual(secondList.params, { cursor: 'next' });
  transport.emit({
    jsonrpc: '2.0',
    id: secondList.id,
    result: {
      sessions: [
        {
          sessionId: 'history-2',
          cwd: '/workspace/two',
          title: 'History two',
          updatedAt: '2026-06-06T01:00:00.000Z',
        },
      ],
    },
  });

  assert.deepEqual(
    (await listed).map((session) => session.sessionId),
    ['history-1', 'history-2'],
  );
});

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function noopSchedule(_callback: () => void, _ms: number): unknown {
  return null;
}

function noopCancel(_handle: unknown): void {
  return undefined;
}
