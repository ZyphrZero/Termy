import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { Setting, SettingDefinitionRender } from 'obsidian';
import type { TerminalSettingTab } from './settingsTab';
import type { TerminalSettingsRenderer } from './renderers/terminalSettingsRenderer';
import { en } from '../i18n/locales/en.ts';

class Element {
  readonly children: Element[] = [];
  readonly classes = new Set<string>();
  textContent = '';
  empty(): void { this.children.length = 0; }
  addClass(...names: string[]): void { names.forEach(name => this.classes.add(name)); }
  createEl(_tag: string, options: { cls?: string; text?: string } = {}): Element {
    const child = new Element();
    child.textContent = options.text ?? '';
    if (options.cls) child.addClass(...options.cls.split(' '));
    this.children.push(child);
    return child;
  }
  createDiv(options?: { cls?: string; text?: string }): Element { return this.createEl('div', options); }
  createSpan(options?: { cls?: string; text?: string }): Element { return this.createEl('span', options); }
  appendChild(child: Element): void { this.children.push(child); }
  appendText(text: string): void { this.textContent += text; }
  setAttribute(): void {}
  addEventListener(): void {}
  querySelector(): null { return null; }
}

class Control<T> {
  value?: T;
  change?: (value: T) => void;
  setValue(value: T): this { this.value = value; return this; }
  setPlaceholder(): this { return this; }
  addOption(): this { return this; }
  onChange(callback: (value: T) => void): this { this.change = callback; return this; }
}

const sources = Promise.all(['./settingsTab.ts', './renderers/terminalSettingsRenderer.ts'].map(async path => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'settings-boundaries', setup(builder) {
      builder.onResolve({ filter: /^\./ }, args => ({ path: args.path, external: true }));
    } }],
  });
  return result.outputFiles[0].text;
}));

async function fixture() {
  const [tabSource, rendererSource] = await sources;
  const rows: TestSetting[] = [];
  const presets: PresetRenderer[] = [];
  const rendered: string[] = [];
  let saves = 0;
  class TestSetting {
    readonly settingEl: Element;
    name = '';
    text?: Control<string>;
    constructor(container: Element) { this.settingEl = container.createDiv(); rows.push(this); }
    setName(name: string): this { this.name = name; return this; }
    setDesc(): this { return this; }
    setHeading(): this { return this; }
    addText(callback: (control: Control<string>) => unknown): this {
      this.text = new Control<string>(); callback(this.text); return this;
    }
    addDropdown(callback: (control: Control<string>) => unknown): this { callback(new Control<string>()); return this; }
    addToggle(callback: (control: Control<boolean>) => unknown): this { callback(new Control<boolean>()); return this; }
  }
  class PresetRenderer {
    disposed = 0;
    constructor() { presets.push(this); }
    render(): void { rendered.push('presets'); }
    dispose(): void { this.disposed += 1; }
  }
  const translate = (key: string): string => {
    let value: unknown = en;
    for (const part of key.split('.')) value = (value as Record<string, unknown>)[part];
    assert.equal(typeof value, 'string', `Missing translation: ${key}`);
    return value as string;
  };
  const plugin = {
    settings: { presetScripts: [{ name: 'Example workflow' }], shellType: 'bash', shellArgs: [], autoEnterVaultDirectory: true },
    saveSettings: () => { saves += 1; return Promise.resolve(); },
    getServerManager: () => { throw new Error('Indexing must not start the backend'); },
    warmRuntimeAndLaunchers: () => { throw new Error('Indexing must not probe CLIs'); },
  };
  const rendererOutput = { exports: {} as { TerminalSettingsRenderer: new () => TerminalSettingsRenderer } };
  runInNewContext(rendererSource, {
    module: rendererOutput, exports: rendererOutput.exports,
    require: (id: string) => {
      if (id === 'obsidian') return { Setting: TestSetting };
      if (id === '../../i18n') return { t: translate };
      if (id === './presetScriptSettings') return { PresetScriptSettings: PresetRenderer };
      if (id === '../settings') return {
        getCurrentPlatformShell: () => plugin.settings.shellType,
        setCurrentPlatformShell: (_settings: unknown, value: string) => { plugin.settings.shellType = value; },
      };
      if (id.endsWith('/shellProfiles')) return { getSelectableShellTypes: () => ['bash', 'custom'] };
      return {};
    },
  });
  const tabOutput = { exports: {} as { TerminalSettingTab: new (app: unknown, plugin: unknown) => TerminalSettingTab } };
  runInNewContext(tabSource, {
    module: tabOutput, exports: tabOutput.exports,
    require: (id: string) => {
      if (id === 'obsidian') return { PluginSettingTab: class {
        containerEl = new Element();
        app: unknown;
        constructor(app: unknown) { this.app = app; }
        hide(): void {}
      }, setIcon: () => {} };
      if (id === '../i18n') return { t: translate };
      if (id === '../ui/icons') return { createTermyLogoSvg: () => new Element() };
      if (id === './renderers/terminalSettingsRenderer') return rendererOutput.exports;
      throw new Error(`Unexpected settings dependency: ${id}`);
    },
  });
  const tab = new tabOutput.exports.TerminalSettingTab({}, plugin);
  return { tab, plugin, rows, rendered, presets, saves: () => saves };
}

function sections(tab: TerminalSettingTab): SettingDefinitionRender[] {
  return tab.getSettingDefinitions().filter((item): item is SettingDefinitionRender => 'render' in item && !!item.render);
}

test('settings indexing is pure and includes localized control names and workflow names', async () => {
  const f = await fixture();
  const definitions = sections(f.tab);
  assert.equal(definitions.length, 9);
  assert.equal(definitions[0].searchable, false);
  assert.ok(definitions.slice(1).every(item => item.name && item.aliases?.length));
  const terms = definitions.flatMap(item => [item.name, ...(item.aliases ?? [])]);
  for (const name of [en.settingsDetails.terminal.defaultShell, 'Node.js runtime', 'Font size', 'Offline mode', 'Example workflow']) {
    assert.ok(terms.includes(name), `Settings search must find ${name}`);
  }
  assert.equal(f.presets.length, 0);
  assert.equal(f.rows.length, 0);
  assert.equal(f.saves(), 0);
  f.plugin.settings.presetScripts.push({ name: 'Second workflow' });
  assert.ok(sections(f.tab).some(item => item.aliases?.includes('Second workflow')));
});

test('a declarative shell section preserves the existing control and save behavior', async () => {
  const f = await fixture();
  const shell = sections(f.tab).find(item => item.aliases?.includes(en.settingsDetails.terminal.defaultArgs));
  assert.ok(shell);
  const container = new Element();
  container.children.push(new Element());
  shell.render({ settingEl: container } as unknown as Setting, undefined!);
  assert.equal(container.children.length, 1, 'The host row must be cleared before rendering its card');
  const args = f.rows.find(row => row.name === en.settingsDetails.terminal.defaultArgs)?.text;
  assert.ok(args?.change);
  args.change('  --flag   example  ');
  assert.deepEqual([...f.plugin.settings.shellArgs], ['--flag', 'example']);
  assert.equal(f.saves(), 1);
});

test('legacy and declarative settings dispatch the same sections in the same order', async () => {
  const f = await fixture();
  const renderer = Reflect.get(f.tab, 'terminalRenderer') as TerminalSettingsRenderer;
  for (const name of ['Shell', 'InstanceBehavior', 'NodeRuntime', 'Display', 'Behavior', 'ServerConnection', 'Visibility']) {
    Reflect.set(renderer, `render${name}Settings`, () => f.rendered.push(name));
  }
  f.tab.display();
  const legacy = [...f.rendered];
  f.rendered.length = 0;
  for (const definition of sections(f.tab).slice(1)) {
    definition.render({ settingEl: new Element() } as unknown as Setting, undefined!);
  }
  assert.deepEqual(f.rendered, legacy);
  assert.equal(legacy.length, 8);
});

test('declarative teardown and tab hide release workflow subscriptions once', async () => {
  const f = await fixture();
  const workflow = sections(f.tab).find(item => item.name === en.settingsDetails.terminal.presetScripts);
  assert.ok(workflow);
  const setting = { settingEl: new Element() } as unknown as Setting;
  const cleanup = workflow.render(setting, undefined!);
  assert.equal(typeof cleanup, 'function');
  if (typeof cleanup === 'function') cleanup();
  workflow.render(setting, undefined!);
  f.tab.hide();
  assert.deepEqual(f.presets.map(renderer => renderer.disposed), [1, 1]);
});

test('appearance refresh searches the entire tab after other sections render', async () => {
  const f = await fixture();
  const renderer = Reflect.get(f.tab, 'terminalRenderer') as TerminalSettingsRenderer;
  Reflect.set(renderer, 'renderDisplaySettings', () => {});
  Reflect.set(renderer, 'renderVisibilitySettings', () => {});
  const definitions = sections(f.tab);
  for (const name of [en.settingsDetails.terminal.displaySettings, en.visibility.visibilitySettings]) {
    const definition = definitions.find(item => item.name === name);
    assert.ok(definition);
    definition.render({ settingEl: new Element() } as unknown as Setting, undefined!);
  }
  let searches = 0;
  const root = f.tab.containerEl as unknown as Element;
  root.querySelector = () => { searches += 1; return null; };
  const refresh = Reflect.get(renderer, 'updateBackgroundImageSettingsVisibility') as () => void;
  refresh.call(renderer);
  assert.equal(searches, 1, 'Background-image controls must be located from the tab, not the last rendered section');
});
