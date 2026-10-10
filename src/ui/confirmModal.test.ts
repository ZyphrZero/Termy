import * as assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

class ModalElement {
  text = '';
  readonly children: ModalElement[] = [];
  readonly listeners = new Map<string, () => void>();
  createDiv(): ModalElement { return this.createEl(); }
  createEl(_tag?: string, options?: { text?: string }): ModalElement {
    const child = new ModalElement();
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }
  addEventListener(type: string, listener: () => void): void { this.listeners.set(type, listener); }
  empty(): void { this.children.length = 0; }
}

const load = async () => {
  let current!: TestModal;
  class TestModal {
    readonly contentEl = new ModalElement();
    constructor() { current = this; }
    open(): void { (this as unknown as { onOpen(): void }).onOpen(); }
    close(): void { (this as unknown as { onClose(): void }).onClose(); }
  }
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./confirmModal.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  });
  const output = { exports: {} as { confirmAction(app: unknown, message: string): Promise<boolean> } };
  runInNewContext(result.outputFiles[0].text, {
    module: output, exports: output.exports,
    require: (id: string) => {
      if (id === 'obsidian') return { Modal: TestModal, getLanguage: () => 'en' };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  return { confirm: output.exports.confirmAction, modal: () => current };
};

test('dismissing a confirmation resolves as cancellation', async () => {
  const f = await load();
  const result = f.confirm({}, 'Remove example?');
  f.modal().close();
  assert.equal(await result, false);
});

test('confirm and cancel buttons resolve according to the selected action', async () => {
  const f = await load();
  for (const confirmed of [true, false]) {
    const result = f.confirm({}, 'Remove example?');
    const buttons = f.modal().contentEl.children.at(-1)!.children;
    buttons[confirmed ? 1 : 0].listeners.get('click')!();
    assert.equal(await result, confirmed);
  }
});
