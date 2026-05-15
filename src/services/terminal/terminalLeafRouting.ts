import type { WorkspaceLeaf } from 'obsidian';
import type { TerminalSettings } from '../../settings/settings';

type NewInstanceBehavior = TerminalSettings['newInstanceBehavior'];

type SplitDirection = 'horizontal' | 'vertical';
type LeafMode = 'tab' | 'split' | 'window' | boolean;

type WorkspaceLike = {
  activeLeaf: WorkspaceLeaf | null;
  leftSplit: unknown;
  rightSplit: unknown;
  rootSplit?: unknown;
  getLeavesOfType(type: string): WorkspaceLeaf[];
  getLeaf(mode?: LeafMode, direction?: SplitDirection): WorkspaceLeaf;
  getLeftLeaf(split: boolean): WorkspaceLeaf | null;
  getRightLeaf(split: boolean): WorkspaceLeaf | null;
  getMostRecentLeaf?(root?: unknown): WorkspaceLeaf | null;
  setActiveLeaf(leaf: WorkspaceLeaf, params?: { focus?: boolean }): void;
};

type TerminalRouteSettings = Pick<TerminalSettings, 'createInstanceNearExistingOnes' | 'newInstanceBehavior'>;

export type TerminalLeafRouteOptions = {
  excludedLeaf?: WorkspaceLeaf | null;
  terminalViewType: string;
};

export function getLeafForTerminalRoute(
  workspace: WorkspaceLike,
  settings: TerminalRouteSettings,
  options: TerminalLeafRouteOptions,
): WorkspaceLeaf {
  if (settings.createInstanceNearExistingOnes) {
    const existingLeaf = findLastNonExcludedLeaf(
      workspace.getLeavesOfType(options.terminalViewType),
      options.excludedLeaf ?? null,
    );

    if (existingLeaf) {
      const root = existingLeaf.getRoot();

      if (root === workspace.leftSplit) {
        const leftLeaf = workspace.getLeftLeaf(false);
        if (leftLeaf) return leftLeaf;
      }

      if (root === workspace.rightSplit) {
        const rightLeaf = workspace.getRightLeaf(false);
        if (rightLeaf) return rightLeaf;
      }

      workspace.setActiveLeaf(existingLeaf, { focus: false });
      return workspace.getLeaf('tab');
    }
  }

  ensureExcludedLeafDoesNotAnchorRoute(workspace, options.excludedLeaf ?? null);
  return getLeafForBehavior(workspace, settings.newInstanceBehavior);
}

function findLastNonExcludedLeaf(
  leaves: WorkspaceLeaf[],
  excludedLeaf: WorkspaceLeaf | null,
): WorkspaceLeaf | null {
  for (let index = leaves.length - 1; index >= 0; index -= 1) {
    const leaf = leaves[index];
    if (leaf !== excludedLeaf) {
      return leaf;
    }
  }

  return null;
}

function ensureExcludedLeafDoesNotAnchorRoute(
  workspace: WorkspaceLike,
  excludedLeaf: WorkspaceLeaf | null,
): void {
  if (!excludedLeaf || workspace.activeLeaf !== excludedLeaf) {
    return;
  }

  const fallbackLeaf = workspace.getMostRecentLeaf?.(workspace.rootSplit);
  if (fallbackLeaf && fallbackLeaf !== excludedLeaf) {
    workspace.setActiveLeaf(fallbackLeaf, { focus: false });
  }
}

function getLeafForBehavior(
  workspace: WorkspaceLike,
  behavior: NewInstanceBehavior,
): WorkspaceLeaf {
  switch (behavior) {
    case 'replaceTab':
      return workspace.getLeaf();

    case 'newTab':
      return workspace.getLeaf('tab');

    case 'newLeftTab': {
      const leftLeaf = workspace.getLeftLeaf(false);
      return leftLeaf ?? workspace.getLeaf('split');
    }

    case 'newLeftSplit': {
      const leftLeaf = workspace.getLeftLeaf(true);
      return leftLeaf ?? workspace.getLeaf('split');
    }

    case 'newRightTab': {
      const rightLeaf = workspace.getRightLeaf(false);
      return rightLeaf ?? workspace.getLeaf('split');
    }

    case 'newRightSplit': {
      const rightLeaf = workspace.getRightLeaf(true);
      return rightLeaf ?? workspace.getLeaf('split');
    }

    case 'newHorizontalSplit':
      return workspace.getLeaf('split', 'horizontal');

    case 'newVerticalSplit':
      return workspace.getLeaf('split', 'vertical');

    case 'newWindow':
      return workspace.getLeaf('window');

    default:
      return workspace.getLeaf('split', 'vertical');
  }
}
