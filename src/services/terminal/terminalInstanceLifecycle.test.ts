import * as assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { ShellEvent } from '../server/types';

type RuntimeTerminal = {
  destroy(): void;
  isAlive(): boolean;
  initXterm(): Promise<void>;
  initializeWithServerManager(server: { ensureServer(): Promise<void>; pty(): never }): Promise<void>;
  resetSessionProtocolState(): void;
  setupPtyClientHandlers(): void;
  onShellEvent(callback: (event: ShellEvent) => void): () => void;
  handleShellEvent(event: ShellEvent): void;
  shellEventCallbacks: Set<(event: ShellEvent) => void>;
  sessionId: string;
  xterm: { write(data: string): void; registerMarker?(): undefined };
  ptyClient: {
    isConnected(): boolean;
    onSessionOutput(): () => void;
    onSessionExit(id: string, callback: (code: number) => void): () => void;
    onSessionError(): () => void;
    onSessionShellEvent(): () => void;
  };
};

const terminalConstructor = (async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./terminalInstance.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  });
  const output = { exports: {} as { TerminalInstance: new () => RuntimeTerminal } };
  const nodeRequire = createRequire(import.meta.url);
  runInNewContext(result.outputFiles[0].text, {
    module: output, exports: output.exports, process, console,
    require: (id: string) => {
      if (id === 'obsidian') return { Notice: class {} };
      if (id === 'electron') return {};
      if (id.endsWith('.css')) return '';
      return nodeRequire(id);
    },
  });
  return output.exports.TerminalInstance;
})();

test('destroying a terminal before its renderer initializes is safe and idempotent', async () => {
  const Constructor = await terminalConstructor;
  const terminal = new Constructor();
  assert.doesNotThrow(() => terminal.destroy());
  assert.doesNotThrow(() => terminal.destroy());
  assert.equal(terminal.isAlive(), false);
});

test('a process exit makes input unavailable even while the PTY transport stays connected', async () => {
  const Constructor = await terminalConstructor;
  const terminal = new Constructor();
  let exit!: (code: number) => void;
  terminal.xterm = { write: () => {} };
  terminal.sessionId = 'session-example';
  terminal.ptyClient = {
    isConnected: () => true,
    onSessionOutput: () => () => {},
    onSessionExit: (_id, callback) => { exit = callback; return () => {}; },
    onSessionError: () => () => {},
    onSessionShellEvent: () => () => {},
  };
  terminal.setupPtyClientHandlers();
  assert.equal(terminal.isAlive(), true);
  exit(0);
  assert.equal(terminal.isAlive(), false);
  terminal.resetSessionProtocolState();
  assert.equal(terminal.isAlive(), true);
});

test('destroy during renderer loading prevents a late server restart', async () => {
  const Constructor = await terminalConstructor;
  const terminal = new Constructor();
  let release!: () => void;
  let ensured = 0;
  terminal.initXterm = () => new Promise<void>((resolve) => { release = resolve; });
  const initialization = terminal.initializeWithServerManager({
    ensureServer: () => { ensured += 1; return Promise.resolve(); },
    pty: () => { throw new Error('Destroyed terminal must not create a PTY'); },
  });
  terminal.destroy();
  release();
  await initialization;
  assert.equal(ensured, 0);
});

test('destroy while waiting for the server prevents a late PTY initialization', async () => {
  const Constructor = await terminalConstructor;
  const terminal = new Constructor();
  let release!: () => void;
  let started!: () => void;
  const ensuring = new Promise<void>((resolve) => { started = resolve; });
  terminal.initXterm = () => Promise.resolve();
  const initialization = terminal.initializeWithServerManager({
    ensureServer: () => { started(); return new Promise<void>((resolve) => { release = resolve; }); },
    pty: () => { throw new Error('Destroyed terminal must not create a PTY'); },
  });
  await ensuring;
  terminal.destroy();
  release();
  await initialization;
});
