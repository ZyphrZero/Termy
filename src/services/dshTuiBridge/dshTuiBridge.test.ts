import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test, { after } from 'node:test';
import { WebSocket } from 'ws';

const obsidianModuleUrl = `data:text/javascript,${encodeURIComponent(String.raw`
  export class FileSystemAdapter {
    constructor(basePath) { this.basePath = basePath; }
    getBasePath() { return this.basePath; }
  }
  export class MarkdownView {}
`)}`;
const sourceRoot = new URL('../../', import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'obsidian') return { url: obsidianModuleUrl, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
    }
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.startsWith(sourceRoot.href)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { FileSystemAdapter } = await import(obsidianModuleUrl) as {
  FileSystemAdapter: new (basePath: string) => { getBasePath(): string };
};
const { DshTuiBridge } = await import('./dshTuiBridge.ts');
hooks.deregister();

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    require: createRequire(import.meta.url),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  },
});
after(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('dsh-TUI bridge authenticates, broadcasts selection, and removes its lock', async () => {
  const root = mkdtempSync(join(tmpdir(), 'termy-dsh-tui-bridge-'));
  const vaultRoot = join(root, 'vault');
  const listeners = new Map<string, () => void>();
  let activeEditor: {
    editor: { getCursor: (side: 'from' | 'to') => { line: number; ch: number }; getSelection: () => string };
    file: { path: string };
  } | undefined;
  const app = {
    vault: { adapter: new FileSystemAdapter(vaultRoot) },
    workspace: {
      on: (event: string, callback: () => void) => {
        listeners.set(event, callback);
        return { event };
      },
      offref: () => {},
      onLayoutReady: (callback: () => void) => callback(),
      getActiveFile: () => activeEditor?.file ?? null,
      getActiveViewOfType: () => null,
      get activeEditor() {
        return activeEditor;
      },
    },
  };
  const bridge = new DshTuiBridge(app as never, join(root, 'dsh-tui-data'));
  let client: WebSocket | null = null;
  let lockfilePath: string | null = null;

  try {
    await bridge.start();
    lockfilePath = bridge.getLockfilePath();
    assert.ok(lockfilePath);
    assert.equal(existsSync(lockfilePath), true);
    const lock = JSON.parse(readFileSync(lockfilePath, 'utf8')) as { port: number; token: string; workspaceFolders: string[] };
    assert.equal(lock.port, bridge.getPort());
    assert.equal(lock.workspaceFolders[0], vaultRoot);

    client = new WebSocket(`ws://127.0.0.1:${lock.port}`);
    const ackPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      client?.once('error', reject);
      client?.once('message', (data) => resolve(JSON.parse(String(data)) as Record<string, unknown>));
    });
    await new Promise<void>((resolve, reject) => {
      client?.once('open', () => resolve());
      client?.once('error', reject);
    });
    client.send(JSON.stringify({
      method: 'ide/hello',
      params: { token: lock.token, protocolVersion: 2 },
    }));
    assert.deepEqual(await ackPromise, {
      method: 'ide/hello_ack',
      params: { protocolVersion: 2, workspaceFolders: [vaultRoot] },
    });

    const selectionPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      client?.once('error', reject);
      client?.on('message', (data) => {
        const frame = JSON.parse(String(data)) as Record<string, unknown>;
        const params = frame.params as { text?: unknown } | undefined;
        if (params?.text === 'unsaved selection') resolve(frame);
      });
    });
    activeEditor = {
      file: { path: 'notes/demo.md' },
      editor: {
        getCursor: (side) => side === 'from' ? { line: 2, ch: 0 } : { line: 4, ch: 0 },
        getSelection: () => 'unsaved selection',
      },
    };
    listeners.get('editor-change')?.();
    assert.deepEqual(await selectionPromise, {
      method: 'selection_changed',
      params: {
        path: join(vaultRoot, 'notes/demo.md').replace(/\\/g, '/'),
        startLine: 2,
        endLine: 3,
        isEmpty: false,
        text: 'unsaved selection',
      },
    });
  } finally {
    if (client) {
      await new Promise<void>((resolve) => {
        if (client?.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        client?.once('close', () => resolve());
        client?.close();
      });
    }
    await bridge.stop();
    assert.equal(lockfilePath !== null && existsSync(lockfilePath), false);
    rmSync(root, { recursive: true, force: true });
  }
});
