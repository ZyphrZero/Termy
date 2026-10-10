import * as assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { RendererContext } from '../types';
import { DEFAULT_PRESET_SCRIPTS, type PresetScript } from '../settings.ts';
import { getAiLauncherEntry } from '../../services/terminal/aiLauncherCatalog.ts';
import type { AiLauncherCatalogEntry } from '../../services/terminal/aiLauncherCatalog';
import type { AiLauncherStatusSnapshot } from '../../services/terminal/aiLauncherStatus';

// Exercise UI state with lightweight elements; CLI cache behavior is tested with real processes separately.
class RowElement {
  textContent = '';
  disabled = false;
  isConnected = true;
  readonly children: RowElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (event?: { stopPropagation(): void }) => void>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    toggle: (name: string, force: boolean) => this.toggleClass(name, force),
  };
  toggleClass(name: string, force: boolean): void {
    if (force) this.classes.add(name);
    else this.classes.delete(name);
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  setText(value: string): void { this.textContent = value; }
  empty(): void { this.children.length = 0; }
  createDiv(options: { cls?: string; text?: string } = {}): RowElement {
    return this.createEl('div', options);
  }
  createEl(_tag: string, options: { cls?: string; text?: string } = {}): RowElement {
    const child = new RowElement();
    options.cls?.split(' ').forEach((name) => child.classes.add(name));
    child.textContent = options.text ?? '';
    this.children.push(child);
    return child;
  }
  addEventListener(event: string, listener: (event?: { stopPropagation(): void }) => void): void { this.listeners.set(event, listener); }
  findByClass(name: string): RowElement | undefined {
    if (this.classes.has(name)) return this;
    for (const child of this.children) {
      const match = child.findByClass(name);
      if (match) return match;
    }
    return undefined;
  }
}

class TestSetting {
  readonly settingEl = new RowElement();
  setName(): this { return this; }
  setDesc(): this { return this; }
  addToggle(): this { return this; }
}

class TestToggle {
  readonly toggleEl = new RowElement();
  setValue(): this { return this; }
  onChange(): this { return this; }
}

type Elements = {
  badge: RowElement;
  versionEl: RowElement;
  installationsButton: RowElement;
  updateButton: RowElement;
  installButton: RowElement;
};

type PresetSettings = {
  render(container: RowElement): void;
  refreshLauncherStatuses(button: RowElement): Promise<void>;
  attachLauncherSnapshotInfo(elements: Elements, entry: AiLauncherCatalogEntry): void;
  renderPresetScriptsList(list: { isConnected: boolean; empty(): void; createDiv(): RowElement }): void;
  dispose(): void;
};

const constructor = (async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./presetScriptSettings.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{
      name: 'ui-boundaries',
      setup(plugin) {
        plugin.onResolve({ filter: /\/(presetScriptModal|presetScriptIcons|launcherInstallationsModal)$/ },
          (args) => ({ path: args.path, external: true }));
      },
    }],
  });
  const output = { exports: {} as { PresetScriptSettings: new (context: RendererContext) => PresetSettings } };
  const nodeRequire = createRequire(import.meta.url);
  runInNewContext(result.outputFiles[0].text, {
    module: output, exports: output.exports, process, console,
    require: (id: string) => {
      if (id === 'obsidian') return { Modal: class {}, Setting: TestSetting, ToggleComponent: TestToggle, setIcon: () => {}, getLanguage: () => 'en' };
      if (id.endsWith('/presetScriptIcons')) return { renderPresetScriptIcon: () => {} };
      if (/\/(presetScriptModal|presetScriptIcons|launcherInstallationsModal)$/.test(id)) return {};
      return nodeRequire(id);
    },
  });
  return output.exports.PresetScriptSettings;
})();

const snapshot = (readiness: AiLauncherStatusSnapshot['readiness']): AiLauncherStatusSnapshot => ({
  readiness, local: readiness === 'not-installed' ? null : '1.0.0', latest: '2.0.0',
  installations: [], installationIssue: null, discoveryErrors: [],
});
const elements = (): Elements => ({
  badge: new RowElement(), versionEl: new RowElement(),
  installationsButton: new RowElement(), updateButton: new RowElement(),
  installButton: new RowElement(),
});

async function fixture(launcher?: AiLauncherCatalogEntry) {
  const Constructor = await constructor;
  const listeners = new Set<(id: string, value: AiLauncherStatusSnapshot) => void>();
  const entry: AiLauncherCatalogEntry = launcher ?? {
    presetId: 'example-launcher', category: 'coding-agent', detectCommand: 'example-cli',
    upgradeCommands: { win32: 'example-cli upgrade', darwin: 'example-cli upgrade', linux: 'example-cli upgrade' },
  };
  const plugin = {
    settings: { presetScripts: [] as PresetScript[] },
    getAiLauncherSnapshot: () => snapshot('ready'),
    refreshAiLauncherSnapshot: () => Promise.resolve(snapshot('ready')),
    refreshAiLauncherStatusFromSettings: (_options: { force?: boolean }): Promise<void> => Promise.resolve(),
    openAiLauncherInstallModalForPreset: (_script: PresetScript) => true,
    onAiLauncherSnapshotsChanged: (listener: (id: string, value: AiLauncherStatusSnapshot) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    settings: new Constructor({ plugin } as unknown as RendererContext), entry, listeners, plugin,
    emit: (value: AiLauncherStatusSnapshot) => {
      listeners.forEach((listener) => listener(entry.presetId, value));
    },
  };
}

test('launcher row updates its own badge and button from the same snapshot', async () => {
  const f = await fixture();
  const row = elements();
  f.settings.attachLauncherSnapshotInfo(row, f.entry);
  assert.equal(row.updateButton.classes.has('is-hidden'), true);
  f.emit(snapshot('update-available'));
  assert.equal(row.badge.classes.has('is-update-available'), true);
  assert.equal(row.versionEl.textContent, 'v1.0.0 → v2.0.0');
  assert.equal(row.updateButton.classes.has('is-hidden'), false);
  f.emit(snapshot('ready'));
  assert.equal(row.updateButton.classes.has('is-hidden'), true);
  f.settings.dispose();
});

test('list refresh releases old row subscriptions and tab disposal releases the current rows', async () => {
  const f = await fixture();
  const previous = elements();
  f.settings.attachLauncherSnapshotInfo(previous, f.entry);
  assert.equal(f.listeners.size, 1);
  f.settings.renderPresetScriptsList({ isConnected: true, empty: () => {}, createDiv: () => new RowElement() });
  assert.equal(f.listeners.size, 0);
  const current = elements();
  f.settings.attachLauncherSnapshotInfo(current, f.entry);
  f.emit(snapshot('update-available'));
  assert.equal(previous.versionEl.textContent, 'v1.0.0');
  assert.equal(current.versionEl.textContent, 'v1.0.0 → v2.0.0');
  f.settings.dispose();
  f.settings.dispose();
  assert.equal(f.listeners.size, 0);
  f.settings.renderPresetScriptsList({
    isConnected: true,
    empty: () => { assert.fail('Closed settings must not rebuild the list'); },
    createDiv: () => { throw new Error('Closed settings must not subscribe to rows'); },
  });
  f.emit(snapshot('ready'));
  assert.equal(current.updateButton.classes.has('is-hidden'), false);
});
