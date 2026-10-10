import * as assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { App } from 'obsidian';
import { DEFAULT_TERMINAL_SETTINGS } from '../../settings/settings.ts';
import type { ServerManager } from '../server/serverManager.ts';
import type { TerminalOptions } from './terminalInstance.ts';
import type { TerminalService } from './terminalService.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Exercise the real service with a controllable PTY boundary; no Obsidian renderer runs in Node.
class TestTerminal {
  static nextId = 0;
  readonly id = `terminal-${TestTerminal.nextId++}`;
  readonly options: TerminalOptions;
  title = 'Terminal';
  destroyed = false;

  constructor(options: TerminalOptions) { this.options = options; }
  setTitle(title: string): void { this.title = title; }
  initializeWithServerManager(server: TestServer): Promise<void> { return server.initialize(this); }
  destroy(): void { this.destroyed = true; }
}

class TestServer {
  readonly started: TestTerminal[] = [];
  shutdowns = 0;
  running = false;
  beforeEnsure: () => Promise<void> = () => Promise.resolve();
  beforeInitialize: (terminal: TestTerminal) => Promise<void> = () => Promise.resolve();
  on(): void {}
  async ensureServer(): Promise<void> { await this.beforeEnsure(); this.running = true; }
  initialize(terminal: TestTerminal): Promise<void> {
    this.started.push(terminal);
    return this.beforeInitialize(terminal);
  }
  isServerRunning(): boolean { return this.running; }
  shutdown(): Promise<void> { this.shutdowns += 1; this.running = false; return Promise.resolve(); }
}

const serviceConstructor = (async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./terminalService.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'],
    plugins: [{
      name: 'controlled-terminal-instance',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]terminalInstance\.ts$/ }, () => ({
          contents: 'export const TerminalInstance = globalThis.TestTerminal;', loader: 'js',
        }));
      },
    }],
  });
  const output = { exports: {} as { TerminalService: typeof TerminalService } };
  const nodeRequire = createRequire(import.meta.url);
  runInNewContext(result.outputFiles[0].text, {
    module: output, exports: output.exports, process, console, TestTerminal,
    require: (id: string) => id === 'obsidian' ? { Notice: class {} } : nodeRequire(id),
  });
  return output.exports.TerminalService;
})();

async function fixture() {
  const Constructor = await serviceConstructor;
  const server = new TestServer();
  const settings = structuredClone(DEFAULT_TERMINAL_SETTINGS);
  settings.shellArgs = ['--login'];
  settings.autoEnterVaultDirectory = true;
  const app = { vault: { adapter: { getBasePath: () => '/example-vault' } } };
  const service = new Constructor(app as unknown as App, settings, server as unknown as ServerManager);
  return { service, server, settings };
}

test('service serializes concurrent launches and forwards isolated launch options', async () => {
  const { service, server, settings } = await fixture();
  const started = deferred();
  const release = deferred();
  server.beforeInitialize = () => {
    started.resolve();
    return server.started.length === 1 ? release.promise : Promise.resolve();
  };
  const args = ['attach', '-t', 'project-a'];
  const first = service.createTerminal({ shellType: 'custom:tmux', shellArgs: args, cwd: '/projects/project-a', title: 'Project A' });
  const second = service.createTerminal({ shellType: 'custom:zmx', shellArgs: [] });
  await started.promise;
  assert.equal(server.started.length, 1);
  release.resolve();
  const terminals = await Promise.all([first, second]);
  assert.notEqual(terminals[0].id, terminals[1].id);
  assert.equal(server.started.length, 2);
  assert.deepEqual(Array.from(server.started[0].options.shellArgs ?? []), ['attach', '-t', 'project-a']);
  assert.equal(server.started[0].options.shellType, 'custom:tmux');
  assert.equal(server.started[0].options.cwd, '/projects/project-a');
  assert.equal(server.started[0].title, 'Project A');
  assert.deepEqual(Array.from(server.started[1].options.shellArgs ?? []), []);
  assert.equal(server.started[1].options.cwd, '/example-vault');
  assert.deepEqual(settings.shellArgs, ['--login']);
  assert.equal(service.getTerminalCount(), 2);
  await service.shutdown();
});

test('failed PTY initialization cleans up and allows the next queued launch', async () => {
  const { service, server } = await fixture();
  server.beforeInitialize = () => server.started.length === 1
    ? Promise.reject(new Error('Native spawn failed')) : Promise.resolve();
  const failed = service.createTerminal({ shellType: 'custom:missing-program', shellArgs: [] });
  const rejected = assert.rejects(failed, /Native spawn failed/);
  const next = service.createTerminal({ shellType: 'custom:tmux', shellArgs: [] });
  await rejected;
  const terminal = await next;
  assert.equal(server.started[0].destroyed, true);
  assert.equal(service.getTerminal(server.started[0].id), undefined);
  assert.equal(service.getTerminal(terminal.id), terminal);
  assert.equal(service.getTerminalCount(), 1);
  await service.shutdown();
});

test('unload destroys an in-flight terminal and rejects queued launches without restarting', async () => {
  const { service, server } = await fixture();
  const started = deferred();
  const release = deferred();
  server.beforeInitialize = () => { started.resolve(); return release.promise; };
  const first = service.createTerminal();
  const second = service.createTerminal();
  const firstRejected = assert.rejects(first, /unloading/);
  const secondRejected = assert.rejects(second, /unloading/);
  await started.promise;
  const shutdown = service.shutdown();
  assert.equal(server.started[0].destroyed, true);
  release.resolve();
  await Promise.all([firstRejected, secondRejected, shutdown]);
  assert.equal(server.started.length, 1);
  assert.equal(service.getTerminalCount(), 0);
  assert.equal(server.shutdowns, 1);
  assert.equal(server.running, false);
});

test('closing the last ready terminal does not stop a server with a pending launch', async () => {
  const { service, server } = await fixture();
  const first = await service.createTerminal();
  const ensuring = deferred();
  const release = deferred();
  server.beforeEnsure = () => { ensuring.resolve(); return release.promise; };
  const next = service.createTerminal();
  await ensuring.promise;
  await service.destroyTerminal(first.id);
  assert.equal(server.shutdowns, 0);
  release.resolve();
  const second = await next;
  await service.destroyTerminal(second.id);
  assert.equal(server.shutdowns, 1);
});
