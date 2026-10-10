import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareVersions, clearCommandVersionCache, probeCommandVersion, type CommandVersionResult } from './services/terminal/commandVersionProbe.ts';
import { getPathEnvKey } from './services/terminal/envHelpers.ts';
import { buildAiLauncherStatusSnapshot, type AiLauncherStatusSnapshot } from './services/terminal/aiLauncherStatus.ts';
import type { AiLauncherCatalogEntry } from './services/terminal/aiLauncherCatalog';
import { getInstallCommandForPlatform } from './services/terminal/aiLauncherCatalog.ts';
import { buildNpmPackageInstallCommand, getNodeRuntimeRecommendation, getNodeDownloadUrl } from './services/terminal/nodeRuntime.ts';
import type { LauncherInstallModalOptions } from './ui/terminal/launcherInstallModal';
import type { ShellEvent } from './services/server/types';

class ShellEvents {
  readonly listeners = new Set<(event: ShellEvent) => void>();
  alive = true;
  isAlive(): boolean { return this.alive; }
  onShellEvent(listener: (event: ShellEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  complete(exitCode = 0): void {
    for (const listener of this.listeners) listener({ type: 'command_end', source: 'osc133', exitCode });
  }
}

class Element {
  className = '';
  textContent = '';
  readonly dataset: Record<string, string> = {};
  readonly children: Element[] = [];
  readonly toggles = new Map<string, boolean>();
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (event: { stopPropagation(): void }) => void>();
  readonly classList = {
    add: () => {}, remove: () => {},
    toggle: (name: string, force: boolean) => this.toggles.set(name, force),
  };
  tooltip = '';
  appendChild(child: Element): void { this.children.push(child); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: (event: { stopPropagation(): void }) => void): void { this.listeners.set(name, listener); }
  remove(): void {}
  querySelectorAll(): Element[] {
    return this.children.flatMap((child) => [...(child.dataset.scriptId ? [child] : []), ...child.querySelectorAll()]);
  }
}

type Plugin = {
  refreshAiLauncherSnapshot(entry: AiLauncherCatalogEntry): Promise<AiLauncherStatusSnapshot | null>;
  probeLauncher(command: string): Promise<{ pathAvailable: 'ready'; localVersion: CommandVersionResult }>;
  startUpgradeWatchdog(entry: AiLauncherCatalogEntry, before: AiLauncherStatusSnapshot, intent: 'upgrade' | 'install', terminal: ShellEvents): void;
  stopUpgradeWatchdog(id: string): void;
  getAiLauncherSnapshot(id: string): AiLauncherStatusSnapshot | undefined;
  setAiLauncherSnapshot(id: string, snapshot: AiLauncherStatusSnapshot): void;
  createAiLauncherMenuItem(script: { id: string; name: string; actions: [] }, entry: AiLauncherCatalogEntry): Element;
  mountPresetScriptsMenu(menu: Element): void;
  closePresetScriptsMenu(): void;
  openAiLauncherInstallModalForPreset(script: { id: string; name: string; actions: [] }): boolean;
  resolveLauncherInstallPlan(entry: AiLauncherCatalogEntry, snapshot: AiLauncherStatusSnapshot): { command: string | null; kind: 'launcher' | 'node-missing' };
  _aiLauncherSnapshotListeners: Set<unknown>;
  settings: { checkAiLauncherUpdates: boolean };
};

const source = (async () => {
  const entry = fileURLToPath(new URL('./main.ts', import.meta.url));
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'plugin-boundaries', setup(builder) {
      builder.onResolve({ filter: /^\./ }, (args) => ({ path: args.path, external: true }));
    } }],
  });
  return result.outputFiles[0].text;
})();

const snapshot = (local: string | null, latest: string | null = null): AiLauncherStatusSnapshot =>
  buildAiLauncherStatusSnapshot({ pathAvailable: 'ready', local: { version: local, resolvedFrom: '/example/bin/agent' }, latest: { version: latest } });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture() {
  const notices: string[] = [];
  const errors: unknown[][] = [];
  const cleared: string[] = [];
  const openedModals: LauncherInstallModalOptions[] = [];
  const timers = new Map<number, () => void>();
  const terminal = new ShellEvents();
  const entry: AiLauncherCatalogEntry = {
    presetId: 'example-agent', category: 'coding-agent', detectCommand: 'example-agent',
    installCommands: { win32: 'example-agent install', linux: 'example-agent install', darwin: 'example-agent install' },
  };
  let now = 0;
  let timerId = 0;
  const document = { body: new Element(), createElement: () => new Element(), addEventListener: () => {}, removeEventListener: () => {} };
  const output = { exports: {} as { default: new () => Plugin } };
  runInNewContext(await source, {
    module: output, exports: output.exports, process, console, activeDocument: document,
    Date: class extends Date { static now(): number { return now; } },
    window: { setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id: number) => timers.delete(id) },
    require: (id: string) => {
      if (id === 'obsidian') return { Plugin: class {}, Notice: class { constructor(text: string) { notices.push(text); } }, setIcon: () => {}, setTooltip: (el: Element, text: string) => { el.tooltip = text; } };
      if (id === './i18n') return { t: (key: string, args?: Record<string, string>) => `${key} ${JSON.stringify(args ?? {})}` };
      if (id === './utils/logger') return { errorLog: (...args: unknown[]) => errors.push(args) };
      if (id === './ui/terminal/terminalView') return { TerminalView: class {} };
      if (id === './services/terminal/commandVersionProbe') return { compareVersions, clearCommandVersionCache: (command: string) => { cleared.push(command); clearCommandVersionCache(command); } };
      if (id === './services/terminal/aiLauncherStatus') return { buildAiLauncherStatusSnapshot, readinessToBadge: (value: string) => value === 'unknown' ? 'checking' : value };
      if (id === './services/terminal/aiLauncherCatalog') return { getInstallCommandForPlatform, getUpgradeCommandForPlatform: () => 'example-agent update', getAiLauncherEntry: (presetId: string) => presetId === entry.presetId ? entry : undefined };
      if (id === './services/terminal/nodeRuntime') return { buildNpmPackageInstallCommand, getNodeRuntimeRecommendation, getNodeDownloadUrl };
      if (id === './ui/terminal/launcherInstallModal') return { LauncherInstallModal: class { constructor(_app: unknown, options: LauncherInstallModalOptions) { openedModals.push(options); } open(): void {} } };
      if (id === './services/terminal/latestVersionRegistry') return { clearLatestVersionCache: () => {} };
      if (id === './ui/terminal/presetScriptIcons') return { renderPresetScriptIcon: () => {} };
      return {};
    },
  });
  const plugin = new output.exports.default();
  plugin.settings = { checkAiLauncherUpdates: false };
  return { plugin, entry, terminal, notices, errors, timers, cleared, openedModals,
    tick: async (elapsed = 5_000) => {
      now += elapsed;
      const next = timers.entries().next().value as [number, () => void] | undefined;
      assert.ok(next, 'An unfinished update must retain a scheduled check');
      timers.delete(next[0]);
      next[1]();
      await flush();
    },
  };
}

test('a missing launcher exposes installation instructions in its menu action', async () => {
  const f = await fixture();
  const missing = buildAiLauncherStatusSnapshot({ pathAvailable: 'not-installed', local: { version: null, resolvedFrom: null }, latest: null });
  f.plugin.setAiLauncherSnapshot(f.entry.presetId, missing);
  f.plugin.refreshAiLauncherSnapshot = () => Promise.resolve(missing);
  const item = f.plugin.createAiLauncherMenuItem({ id: f.entry.presetId, name: 'Example agent', actions: [] }, f.entry);
  const button = item.children.find((child) => child.className.includes('preset-scripts-menu-action-setup'));
  assert.ok(button);
  assert.equal(button.toggles.get('is-hidden'), false);
  assert.ok(button.attributes.get('aria-label')?.includes('aiLauncherInstallInstructions'));
  button.listeners.get('click')?.({ stopPropagation: () => {} });
  assert.equal(f.openedModals.length, 1);
  assert.equal(f.openedModals[0].installCommand, 'example-agent install');
  assert.equal(f.openedModals[0].updateAvailable, false);
});

test('npm installation commands remain visible when Node.js is missing, with execution gated on setup', async () => {
  const f = await fixture();
  f.entry.npmPackage = '@example/agent';
  f.entry.installCommands = { win32: 'npm install -g @example/agent', linux: 'npm install -g @example/agent', darwin: 'npm install -g @example/agent' };
  const missing = buildAiLauncherStatusSnapshot({
    pathAvailable: 'not-installed', local: { version: null, resolvedFrom: null }, latest: null,
    nodeRuntime: {
      customNodePath: null,
      node: { command: 'node', availability: 'not-installed', version: null, path: null },
      npm: { command: 'npm', availability: 'not-installed', version: null, path: null },
    },
  });
  f.plugin.setAiLauncherSnapshot(f.entry.presetId, missing);
  assert.equal(f.plugin.openAiLauncherInstallModalForPreset({ id: f.entry.presetId, name: 'Example agent', actions: [] }), true);
  assert.equal(f.openedModals[0].installCommand, 'npm install -g @example/agent');
  assert.equal(f.openedModals[0].installCommandKind, 'node-missing');
  assert.equal(f.openedModals[0].onRunInstall, undefined);
});

test('native install commands remain available without requiring an npm runtime', async () => {
  const f = await fixture();
  f.entry.npmPackage = '@example/agent';
  f.entry.installCommands = { win32: 'example-agent install', linux: 'example-agent install', darwin: 'example-agent install' };
  const missing = { ...snapshot(null), nodeRuntime: {
    customNodePath: null,
    node: { command: 'node', availability: 'not-installed' as const, version: null, path: null },
    npm: { command: 'npm', availability: 'not-installed' as const, version: null, path: null },
  } };
  assert.equal(f.plugin.resolveLauncherInstallPlan(f.entry, missing).kind, 'launcher');
});
