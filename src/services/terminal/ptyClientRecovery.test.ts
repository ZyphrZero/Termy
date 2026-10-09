import * as assert from 'node:assert/strict';
import test from 'node:test';

import { PtyClient } from '../server/ptyClient.ts';

class TestWebSocket {
  static readonly OPEN = 1;

  readonly readyState = TestWebSocket.OPEN;
  readonly sent: string[] = [];

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(typeof data === 'string' ? data : '[binary]');
  }
}

async function withFakeBrowser(run: () => Promise<void>): Promise<void> {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const webSocketDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: TestWebSocket });

  try {
    await run();
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }

    if (webSocketDescriptor) {
      Object.defineProperty(globalThis, 'WebSocket', webSocketDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
}

test('PtyClient sends an attach request and resolves on success', async () => {
  await withFakeBrowser(async () => {
    const client = new PtyClient();
    const socket = new TestWebSocket();
    client.setWebSocket(socket as unknown as WebSocket);

    const attached = client.attach('session-1');
    assert.deepEqual(JSON.parse(socket.sent[0]), {
      module: 'pty',
      type: 'attach',
      session_id: 'session-1',
    });

    client.handleMessage({
      module: 'pty',
      type: 'attach_complete',
      session_id: 'session-1',
      success: true,
    });
    await assert.doesNotReject(attached);
    client.destroy();
  });
});

test('PtyClient rejects an attach request when the session is missing', async () => {
  await withFakeBrowser(async () => {
    const client = new PtyClient();
    const socket = new TestWebSocket();
    client.setWebSocket(socket as unknown as WebSocket);

    const attached = client.attach('missing-session');
    client.handleMessage({
      module: 'pty',
      type: 'attach_complete',
      session_id: 'missing-session',
      success: false,
      message: 'SESSION_NOT_FOUND',
    });

    await assert.rejects(attached, /SESSION_NOT_FOUND/);
    client.destroy();
  });
});
