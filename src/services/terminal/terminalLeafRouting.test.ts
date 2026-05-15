import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceLeaf } from 'obsidian';

import { getLeafForTerminalRoute } from './terminalLeafRouting.ts';
import type { TerminalSettings } from '../../settings/settings.ts';

type FakeLeaf = WorkspaceLeaf & { name: string };

type FakeWorkspaceOptions = {
  activeLeaf?: FakeLeaf | null;
  leaves?: FakeLeaf[];
  leftLeaf?: FakeLeaf | null;
  rightLeaf?: FakeLeaf | null;
  rootRecentLeaf?: FakeLeaf | null;
};

function createLeaf(name: string, root: unknown): FakeLeaf {
  return {
    name,
    getRoot: () => root,
  } as FakeLeaf;
}

function createWorkspace(options: FakeWorkspaceOptions = {}) {
  const leftSplit = { name: 'leftSplit' };
  const rightSplit = { name: 'rightSplit' };
  const rootSplit = { name: 'rootSplit' };
  const getLeafCalls: Array<{ mode?: unknown; direction?: unknown; activeLeaf: FakeLeaf | null }> = [];
  const setActiveLeafCalls: Array<{ leaf: FakeLeaf; focus?: boolean }> = [];

  const workspace = {
    activeLeaf: options.activeLeaf ?? null,
    leftSplit,
    rightSplit,
    rootSplit,
    getLeavesOfType: () => options.leaves ?? [],
    getLeaf: (mode?: unknown, direction?: unknown) => {
      getLeafCalls.push({ mode, direction, activeLeaf: workspace.activeLeaf });
      return createLeaf('created', rootSplit);
    },
    getLeftLeaf: () => options.leftLeaf ?? null,
    getRightLeaf: () => options.rightLeaf ?? null,
    getMostRecentLeaf: () => options.rootRecentLeaf ?? null,
    setActiveLeaf: (leaf: FakeLeaf, params?: { focus?: boolean }) => {
      workspace.activeLeaf = leaf;
      setActiveLeafCalls.push({ leaf, focus: params?.focus });
    },
  };

  return { workspace, leftSplit, rightSplit, rootSplit, getLeafCalls, setActiveLeafCalls };
}

function createSettings(
  overrides: Partial<Pick<TerminalSettings, 'createInstanceNearExistingOnes' | 'newInstanceBehavior'>> = {},
): Pick<TerminalSettings, 'createInstanceNearExistingOnes' | 'newInstanceBehavior'> {
  return {
    createInstanceNearExistingOnes: true,
    newInstanceBehavior: 'newHorizontalSplit',
    ...overrides,
  };
}

test('terminal routing ignores the tracked always-on-top leaf when creating near existing terminals', () => {
  const mainRoot = { name: 'mainRoot' };
  const popoutRoot = { name: 'popoutRoot' };
  const mainTerminal = createLeaf('main-terminal', mainRoot);
  const alwaysOnTopTerminal = createLeaf('always-on-top-terminal', popoutRoot);
  const { workspace, getLeafCalls, setActiveLeafCalls } = createWorkspace({
    activeLeaf: alwaysOnTopTerminal,
    leaves: [mainTerminal, alwaysOnTopTerminal],
  });

  getLeafForTerminalRoute(workspace, createSettings(), {
    terminalViewType: 'terminal-view',
    excludedLeaf: alwaysOnTopTerminal,
  });

  assert.equal(setActiveLeafCalls.length, 1);
  assert.equal(setActiveLeafCalls[0].leaf, mainTerminal);
  assert.equal(setActiveLeafCalls[0].focus, false);
  assert.deepEqual(getLeafCalls.map(({ mode, direction }) => ({ mode, direction })), [
    { mode: 'tab', direction: undefined },
  ]);
  assert.equal(getLeafCalls[0].activeLeaf, mainTerminal);
});

test('terminal routing falls back to normal behavior from the root split when only the always-on-top terminal exists', () => {
  const popoutRoot = { name: 'popoutRoot' };
  const rootMainLeaf = createLeaf('root-main-leaf', { name: 'mainRoot' });
  const alwaysOnTopTerminal = createLeaf('always-on-top-terminal', popoutRoot);
  const { workspace, getLeafCalls, setActiveLeafCalls } = createWorkspace({
    activeLeaf: alwaysOnTopTerminal,
    leaves: [alwaysOnTopTerminal],
    rootRecentLeaf: rootMainLeaf,
  });

  getLeafForTerminalRoute(workspace, createSettings({ newInstanceBehavior: 'newVerticalSplit' }), {
    terminalViewType: 'terminal-view',
    excludedLeaf: alwaysOnTopTerminal,
  });

  assert.equal(setActiveLeafCalls.length, 1);
  assert.equal(setActiveLeafCalls[0].leaf, rootMainLeaf);
  assert.deepEqual(getLeafCalls.map(({ mode, direction }) => ({ mode, direction })), [
    { mode: 'split', direction: 'vertical' },
  ]);
  assert.equal(getLeafCalls[0].activeLeaf, rootMainLeaf);
});

test('terminal routing still creates near non-excluded sidebar terminals', () => {
  const options: FakeWorkspaceOptions = {};
  const { workspace, leftSplit } = createWorkspace(options);
  const leftTerminal = createLeaf('left-terminal', leftSplit);
  const leftDestination = createLeaf('left-destination', leftSplit);
  options.leaves = [leftTerminal];
  options.leftLeaf = leftDestination;

  const leaf = getLeafForTerminalRoute(workspace, createSettings(), {
    terminalViewType: 'terminal-view',
    excludedLeaf: null,
  });

  assert.equal(leaf, leftDestination);
});
