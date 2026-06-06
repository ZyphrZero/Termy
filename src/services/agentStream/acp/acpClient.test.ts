import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcLineDecoder, encodeJsonRpcFrame } from './jsonRpcLine.ts';
import { AcpClient, type AcpTransport } from './acpClient.ts';

class FakeTransport implements AcpTransport {
  private dataListeners = new Set<(chunk: Buffer) => void>();
  private logListeners = new Set<(text: string) => void>();
  private closeListeners = new Set<(reason: string) => void>();
  sent: Buffer[] = [];
  startCalls = 0;
  stopCalls = 0;
  closed = false;

  start(): Promise<void> {
    this.startCalls += 1;
    return Promise.resolve();
  }

  send(frame: Buffer): void {
    if (this.closed) {
      throw new Error('transport closed');
    }
    this.sent.push(frame);
  }

  onData(listener: (chunk: Buffer) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onLog(listener: (text: string) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  stop(): Promise<void> {
    this.stopCalls += 1;
    this.closed = true;
    return Promise.resolve();
  }

  /** Emit a JSON-RPC payload to the client. */
  emit(payload: unknown): void {
    const buf = encodeJsonRpcFrame(payload);
    for (const listener of this.dataListeners) {
      listener(buf);
    }
  }

  /** Emit a transport close event. */
  closeFromAgent(reason: string): void {
    for (const listener of this.closeListeners) {
      listener(reason);
    }
  }

  /** Read the latest sent payload as a parsed object (for assertions). */
  popLastSent(): { method?: string; id?: number; result?: unknown; params?: unknown; error?: unknown } | null {
    const last = this.sent.pop();
    if (!last) return null;
    const decoder = new JsonRpcLineDecoder();
    const frames = decoder.feed(last);
    if (frames.length === 0 || frames[0].kind !== 'message') return null;
    return frames[0].payload as never;
  }

  drainSent(): Array<{ method?: string; id?: number; result?: unknown; params?: unknown }> {
    const out: Array<Record<string, unknown>> = [];
    const decoder = new JsonRpcLineDecoder();
    for (const buf of this.sent) {
      for (const frame of decoder.feed(buf)) {
        if (frame.kind === 'message') {
          out.push(frame.payload as Record<string, unknown>);
        }
      }
      decoder.reset();
    }
    return out as never;
  }
}

const noopSchedule = (_cb: () => void, _ms: number): unknown => null;
const noopCancel = (_handle: unknown): void => undefined;

function makeClient(transport: FakeTransport, callbacks?: ConstructorParameters<typeof AcpClient>[0]['callbacks']): AcpClient {
  return new AcpClient({
    transport,
    clientInfo: { name: 'termy-test', version: '0.0.0' },
    callbacks,
    scheduleTimeout: noopSchedule,
    cancelTimeout: noopCancel,
  });
}

test('AcpClient.start sends an `initialize` request and resolves with the server response', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport);

  const resultPromise = client.start();
  // Yield once so transport.start()'s microtask resolves and the
  // initialize request is enqueued before we inspect `sent`.
  await new Promise((resolve) => setImmediate(resolve));

  // Server responds with initialize result.
  const sent = transport.popLastSent();
  assert.equal(sent?.method, 'initialize');
  assert.ok(typeof sent?.id === 'number');

  transport.emit({
    jsonrpc: '2.0',
    id: sent!.id,
    result: {
      protocolVersion: 1,
      agentInfo: { name: 'fake-agent', version: '0.0.1' },
    },
  });

  const result = await resultPromise;
  assert.equal(result.protocolVersion, 1);
  assert.equal(result.agentInfo?.name, 'fake-agent');
});

test('AcpClient.newSession returns the server-assigned sessionId', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport);

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({
    jsonrpc: '2.0',
    id: 1,
    result: { protocolVersion: 1 },
  });
  await startPromise;

  const sessionPromise = client.newSession('/tmp/example');
  await new Promise((resolve) => setImmediate(resolve));
  // The new-session request is the second outbound message.
  const lastSent = transport.popLastSent();
  assert.equal(lastSent?.method, 'session/new');
  transport.emit({
    jsonrpc: '2.0',
    id: lastSent!.id,
    result: { sessionId: 'sess-1' },
  });
  const sessionId = await sessionPromise;
  assert.equal(sessionId, 'sess-1');
  assert.equal(client.sessionId, 'sess-1');
});

test('AcpClient.loadSession sends session/load and remembers the restored sessionId', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport);

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
  await startPromise;

  const loadPromise = client.loadSession('sess-history', '/tmp/example');
  await new Promise((resolve) => setImmediate(resolve));
  const sent = transport.popLastSent();
  assert.equal(sent?.method, 'session/load');
  assert.deepEqual(sent?.params, {
    sessionId: 'sess-history',
    cwd: '/tmp/example',
    mcpServers: [],
  });

  transport.emit({ jsonrpc: '2.0', id: sent!.id, result: {} });
  await loadPromise;
  assert.equal(client.sessionId, 'sess-history');
});

test('AcpClient.listSessions sends session/list with cwd and cursor', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport);

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
  await startPromise;

  const listPromise = client.listSessions({ cwd: '/tmp/example', cursor: '123' });
  await new Promise((resolve) => setImmediate(resolve));
  const sent = transport.popLastSent();
  assert.equal(sent?.method, 'session/list');
  assert.deepEqual(sent?.params, {
    cwd: '/tmp/example',
    cursor: '123',
  });

  transport.emit({
    jsonrpc: '2.0',
    id: sent!.id,
    result: {
      sessions: [
        {
          sessionId: 'sess-1',
          cwd: '/tmp/example',
          title: 'Imported',
          updatedAt: '2026-06-06T00:00:00.000Z',
        },
      ],
    },
  });
  const result = await listPromise;
  assert.equal(result.sessions[0]?.sessionId, 'sess-1');
});

test('AcpClient.listSessions sends an empty request without cwd filtering', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport);

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
  await startPromise;

  const listPromise = client.listSessions({});
  await new Promise((resolve) => setImmediate(resolve));
  const sent = transport.popLastSent();
  assert.equal(sent?.method, 'session/list');
  assert.deepEqual(sent?.params, {});

  transport.emit({
    jsonrpc: '2.0',
    id: sent!.id,
    result: { sessions: [] },
  });
  const result = await listPromise;
  assert.deepEqual(result.sessions, []);
});

test('AcpClient.prompt resolves with the stop reason', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport);

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
  await startPromise;

  const promptPromise = client.prompt('sess-1', 'Hi');
  await new Promise((resolve) => setImmediate(resolve));
  const sent = transport.popLastSent();
  assert.equal(sent?.method, 'session/prompt');
  transport.emit({
    jsonrpc: '2.0',
    id: sent!.id,
    result: { stopReason: 'end_turn' },
  });
  const stop = await promptPromise;
  assert.equal(stop, 'end_turn');
});

test('AcpClient routes session/update notifications to the callback', async () => {
  const transport = new FakeTransport();
  const seen: unknown[] = [];
  const client = makeClient(transport, {
    onSessionUpdate: (n) => seen.push(n),
  });

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
  await startPromise;

  transport.emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hi' },
      },
    },
  });

  assert.equal(seen.length, 1);
  const notification = seen[0] as { sessionId: string };
  assert.equal(notification.sessionId, 'sess-1');
});

test('AcpClient rejects permission requests when no onPermissionRequest handler is provided', async () => {
  const transport = new FakeTransport();
  const errors: Error[] = [];
  const client = makeClient(transport, {
    onError: (err) => errors.push(err),
  });

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
  await startPromise;

  // Drain the initialize frame so popLastSent only sees the permission response.
  transport.sent.length = 0;

  transport.emit({
    jsonrpc: '2.0',
    id: 99,
    method: 'session/request_permission',
    params: {
      sessionId: 'sess-1',
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    },
  });

  // Wait a tick for the async permission decision to resolve.
  await new Promise((resolve) => setImmediate(resolve));

  const sent = transport.popLastSent();
  assert.equal(sent?.id, 99);
  const result = sent?.result as { outcome?: { kind?: string } } | undefined;
  assert.equal(result?.outcome?.kind, 'cancelled');
  // Error event should have been emitted
  assert.equal(errors.length, 1);
  assert.ok(errors[0].message.includes('no onPermissionRequest handler'));
});

test('AcpClient surfaces JSON-RPC errors through pending request rejections', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport);

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32603, message: 'Internal error' },
  });

  await assert.rejects(startPromise, /Internal error/);
});

test('AcpClient.stop rejects pending requests', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport);

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  // Don't reply to initialize; just stop.
  await client.stop('test shutdown');

  await assert.rejects(startPromise, /transport closing|transport closed/);
});

test('AcpClient closes when the transport reports a close event', async () => {
  const transport = new FakeTransport();
  let closeReason: string | null = null;
  const client = makeClient(transport, {
    onClose: (reason) => {
      closeReason = reason;
    },
  });

  const startPromise = client.start();
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
  await startPromise;

  transport.closeFromAgent('agent process exited (1)');
  assert.equal(closeReason, 'agent process exited (1)');
});
