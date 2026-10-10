import * as assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceLeaf } from 'obsidian';
import type { CreateTerminalOptions } from '../../api.ts';
import type { TerminalInstance } from '../../services/terminal/terminalInstance.ts';
import type { TerminalLaunchSpec } from '../../services/terminal/terminalTypes.ts';
import type { TerminalService } from '../../services/terminal/terminalService.ts';
import { TERMINAL_VIEW_TYPE } from './terminalViewType.ts';
import { TerminalWorkspaceController } from './terminalWorkspaceController.ts';

class TestTerminal {
  readonly id = 'terminal-example';
  title = 'Project A';
  focuses = 0;
  getTitle(): string { return this.title; }
  setTitle(title: string): void { this.title = title; }
  isAlive(): boolean { return true; }
  write(): void {}
  focus(): void { this.focuses += 1; }
}

type TestView = {
  getViewType(): string;
  getTerminalInstance(): TestTerminal | null;
  waitForTerminalInstance(): Promise<TestTerminal>;
};

type TestLeaf = {
  view: TestView;
  active?: boolean;
  attachFocus?: boolean;
  detached: boolean;
  setPinned(pinned: boolean): void;
  setViewState(state: { type: string; active: boolean }): Promise<void>;
  loadIfDeferred(): Promise<void>;
  detach(): void;
};

async function fixture() {
  const terminal = new TestTerminal();
  let available = true;
  let unavailableOnCreate = false;
  let viewError: Error | undefined;
  let destroyed = 0;
  let focusNewInstance = true;
  const launchSpecs: TerminalLaunchSpec[] = [];
  const leaves: TestLeaf[] = [];
  const activated: TestLeaf[] = [];
  const service = {
    createTerminal: (options: TerminalLaunchSpec) => {
      launchSpecs.push(options);
      if (unavailableOnCreate) available = false;
      return Promise.resolve(terminal);
    },
    getTerminal: () => destroyed === 0 ? terminal : undefined,
    destroyTerminal: () => { destroyed += 1; return Promise.resolve(); },
  };
  const workspace = {
    getLeaf(mode: 'tab'): WorkspaceLeaf {
      assert.equal(mode, 'tab');
      let attached: TestTerminal | null = null;
      const leaf: TestLeaf = {
        detached: false,
        setPinned: () => {},
        setViewState: (state) => {
          if (viewError) return Promise.reject(viewError);
          if (state.type !== TERMINAL_VIEW_TYPE) return Promise.reject(new Error('Unexpected view type'));
          leaf.active = state.active;
          const request = controller.consumePendingMount(leaf as unknown as WorkspaceLeaf);
          attached = request?.terminal as unknown as TestTerminal ?? null;
          leaf.attachFocus = request?.focus;
          return Promise.resolve();
        },
        loadIfDeferred: () => Promise.resolve(),
        detach: () => { leaf.detached = true; },
        view: {
          getViewType: () => TERMINAL_VIEW_TYPE,
          getTerminalInstance: () => attached,
          waitForTerminalInstance: () => attached ? Promise.resolve(attached) : Promise.reject(new Error('No terminal')),
        },
      };
      leaves.push(leaf);
      return leaf as unknown as WorkspaceLeaf;
    },
    getLeavesOfType: () => leaves.filter((leaf) => !leaf.detached) as unknown as WorkspaceLeaf[],
    setActiveLeaf: (leaf: WorkspaceLeaf) => { activated.push(leaf as unknown as TestLeaf); },
    revealLeaf: () => Promise.resolve(),
  };
  const controller = new TerminalWorkspaceController({
    workspace,
    getTerminalService: () => Promise.resolve(service as unknown as TerminalService),
    isAvailable: () => available,
    focusNewInstance: () => focusNewInstance,
    lockNewInstance: () => true,
  });
  return {
    controller, terminal, workspace, launchSpecs, leaves, activated,
    setAvailable: (value: boolean) => { available = value; },
    setUnavailableOnCreate: () => { unavailableOnCreate = true; },
    setFocusNewInstance: (value: boolean) => { focusNewInstance = value; },
    failView: (error: Error) => { viewError = error; },
    getDestroyed: () => destroyed,
  };
}

test('controller maps API options, opens a fresh background tab, and returns its handle', async () => {
  const f = await fixture();
  const options = { executable: 'tmux', args: ['attach'], cwd: '/example/project-a', title: 'Project A', focus: false };
  const handlePromise = f.controller.createPublicTerminal(options);
  options.focus = true;
  const handle = await handlePromise;
  assert.deepEqual(f.launchSpecs, [{
    shellType: 'custom:tmux', shellArgs: ['attach'], cwd: '/example/project-a', title: 'Project A',
  }]);
  assert.equal(f.leaves[0].active, false);
  assert.equal(f.leaves[0].attachFocus, false);
  assert.equal(f.activated.length, 0);
  assert.equal(f.terminal.focuses, 0);
  assert.equal(handle.id, f.terminal.id);
  await handle.focus();
  assert.equal(f.activated[0], f.leaves[0]);
  await handle.close();
  assert.equal(f.leaves[0].detached, true);
  assert.equal(f.getDestroyed(), 1);
  assert.equal(handle.isClosed, true);
});

test('controller respects the configured focus default when focus is omitted', async () => {
  const f = await fixture();
  f.setFocusNewInstance(false);
  await f.controller.createPublicTerminal({});
  assert.equal(f.leaves[0].active, false);
});

test('view initialization failure preserves its error and cleans up the PTY', async () => {
  const f = await fixture();
  const error = new Error('Workspace view failed');
  f.failView(error);
  await assert.rejects(f.controller.createPublicTerminal({}), (actual) => actual === error);
  assert.equal(f.getDestroyed(), 1);
  assert.equal(f.leaves[0].detached, true);
});

test('unload during creation closes the PTY without mounting a view', async () => {
  const f = await fixture();
  f.setUnavailableOnCreate();
  await assert.rejects(f.controller.createPublicTerminal({}), /not loaded/);
  assert.equal(f.leaves.length, 0);
  assert.equal(f.getDestroyed(), 1);
});

test('controller consumes one mount request and carries its focus policy', async () => {
  const f = await fixture();
  const leaf = f.workspace.getLeaf('tab');
  const terminal = f.terminal as unknown as TerminalInstance;
  f.controller.setPendingMount(leaf, terminal, false);
  assert.deepEqual(f.controller.consumePendingMount(leaf), { terminal, focus: false });
  assert.equal(f.controller.consumePendingMount(leaf), null);
});

test('handle follows a terminal moved while the workspace reveals its leaf', async () => {
  const f = await fixture();
  const handle = await f.controller.createPublicTerminal({ focus: false });
  const original = f.leaves[0];
  let moved = false;
  const destination = {
    ...original,
    detached: false,
    view: {
      getViewType: () => TERMINAL_VIEW_TYPE,
      getTerminalInstance: () => f.terminal,
    },
  } as TestLeaf;
  destination.detach = () => { destination.detached = true; };
  f.workspace.revealLeaf = () => {
    original.detached = true;
    moved = true;
    return Promise.resolve();
  };
  f.workspace.getLeavesOfType = () => (moved ? [destination] : f.leaves.filter((leaf) => !leaf.detached)) as unknown as WorkspaceLeaf[];
  await handle.focus();
  assert.equal(f.activated.at(-1), destination);
  await handle.close();
  assert.equal(destination.detached, true);
});

test('invalid API options reject before requesting a terminal service', async () => {
  const f = await fixture();
  await assert.rejects(f.controller.createPublicTerminal({ executable: '' } as CreateTerminalOptions), TypeError);
  f.setAvailable(false);
  await assert.rejects(f.controller.createPublicTerminal({}), /not loaded/);
  assert.equal(f.launchSpecs.length, 0);
});
