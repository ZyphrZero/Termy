import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { LauncherInstallModalOptions } from './launcherInstallModal';

class Element {
  textContent = '';
  readonly children: Element[] = [];
  readonly classes = new Set<string>();
  addClass(name: string): void { this.classes.add(name); }
  empty(): void { this.children.length = 0; }
  setText(text: string): void { this.textContent = text; }
  createDiv(options: { cls?: string; text?: string } = {}): Element { return this.createEl('div', options); }
  createEl(_tag: string, options: { cls?: string; text?: string }): Element {
    const child = new Element();
    child.textContent = options.text ?? '';
    options.cls?.split(' ').forEach((name) => child.classes.add(name));
    this.children.push(child);
    return child;
  }
  addEventListener(): void {}
  find(name: string): Element | undefined {
    if (this.classes.has(name)) return this;
    return this.children.map((child) => child.find(name)).find((child) => child !== undefined);
  }
  texts(): string[] { return [this.textContent, ...this.children.flatMap((child) => child.texts())]; }
}

const constructor = (async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('./launcherInstallModal.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' });
  const output = { exports: {} as { LauncherInstallModal: new (app: unknown, options: LauncherInstallModalOptions) => { onOpen(): void; contentEl: Element } } };
  const nodeRequire = createRequire(import.meta.url);
  runInNewContext(result.outputFiles[0].text, {
    module: output, exports: output.exports, process, console,
    require: (id: string) => {
      if (id === 'obsidian') return { Modal: class { contentEl = new Element(); modalEl = new Element(); }, getLanguage: () => 'en' };
      if (id === 'electron') return {};
      return nodeRequire(id);
    },
  });
  return output.exports.LauncherInstallModal;
})();

test('installation guidance shows the command and copy control alongside missing Node.js prerequisites', async () => {
  const Modal = await constructor;
  const modal = new Modal({}, { name: 'Example agent', command: 'example-agent', installCommand: 'npm install -g @example/agent', installCommandKind: 'node-missing' });
  modal.onOpen();
  assert.equal(modal.contentEl.find('termy-launcher-install-command')?.textContent, 'npm install -g @example/agent');
  assert.ok(modal.contentEl.find('termy-launcher-install-command-copy'));
  assert.ok(modal.contentEl.texts().includes('Install Node.js first'));
  assert.equal(modal.contentEl.texts().includes('Install now'), false);
});
