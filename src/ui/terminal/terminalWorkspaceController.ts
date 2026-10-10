import type { WorkspaceLeaf } from 'obsidian';
import type { CreateTerminalOptions, TerminalHandle } from '../../api';
import type { TerminalService } from '../../services/terminal/terminalService';
import type { TerminalInstance } from '../../services/terminal/terminalInstance';
import { createTerminalApiHandle } from '../../services/terminal/terminalApiHandle.ts';
import { createTerminalLaunchRequest } from '../../services/terminal/terminalCreationOptions.ts';
import { errorLog } from '../../utils/logger.ts';
import { TERMINAL_VIEW_TYPE } from './terminalViewType.ts';
import type { TerminalView } from './terminalView';

type WorkspaceLike = {
  getLeaf(mode: 'tab'): WorkspaceLeaf;
  getLeavesOfType(type: string): WorkspaceLeaf[];
  setActiveLeaf(leaf: WorkspaceLeaf, params?: { focus?: boolean }): void;
  revealLeaf(leaf: WorkspaceLeaf): Promise<void>;
};

type ControllerDependencies = {
  workspace: WorkspaceLike;
  getTerminalService: () => Promise<TerminalService>;
  isAvailable: () => boolean;
  focusNewInstance: () => boolean;
  lockNewInstance: () => boolean;
};

export type TerminalMountRequest = {
  terminal: TerminalInstance;
  focus: boolean;
};

/** Coordinates the small boundary between TerminalService and Obsidian workspace views. */
export class TerminalWorkspaceController {
  private readonly pendingMounts: WeakMap<WorkspaceLeaf, TerminalMountRequest> = new WeakMap();
  private readonly dependencies: ControllerDependencies;

  constructor(dependencies: ControllerDependencies) {
    this.dependencies = dependencies;
  }

  async createPublicTerminal(options: CreateTerminalOptions): Promise<TerminalHandle> {
    const request = createTerminalLaunchRequest(options);
    if (!this.dependencies.isAvailable()) throw new Error('Termy is not loaded');
    const service = await this.dependencies.getTerminalService();
    if (!this.dependencies.isAvailable()) throw new Error('Termy is not loaded');

    const terminal = await service.createTerminal(request.launchSpec);
    const focus = request.focus ?? this.dependencies.focusNewInstance();
    let leaf: WorkspaceLeaf | undefined;
    try {
      if (!this.dependencies.isAvailable()) throw new Error('Termy is not loaded');
      leaf = this.dependencies.workspace.getLeaf('tab');
      this.setPendingMount(leaf, terminal, focus);
      if (this.dependencies.lockNewInstance()) leaf.setPinned(true);
      await leaf.setViewState({ type: TERMINAL_VIEW_TYPE, active: focus });
      const view = await this.waitForTerminalView(leaf);
      if (!view) throw new Error('Termy terminal view did not load');
      const attached = await view.waitForTerminalInstance();
      if (attached !== terminal) throw new Error('Termy terminal view did not attach the requested terminal');
      if (!this.dependencies.isAvailable()) throw new Error('Termy is not loaded');
      if (focus) {
        this.dependencies.workspace.setActiveLeaf(leaf, { focus: true });
        terminal.focus();
      }
      return this.createHandle(terminal, service);
    } catch (error) {
      if (leaf) this.pendingMounts.delete(leaf);
      try {
        await service.destroyTerminal(terminal.id);
      } catch (cleanupError) {
        errorLog('[TerminalWorkspaceController] Failed to clean up terminal creation:', cleanupError);
      }
      leaf?.detach();
      throw error;
    }
  }

  setPendingMount(leaf: WorkspaceLeaf, terminal: TerminalInstance, focus = true): void {
    this.pendingMounts.set(leaf, { terminal, focus });
  }

  consumePendingMount(leaf: WorkspaceLeaf): TerminalMountRequest | null {
    const request = this.pendingMounts.get(leaf);
    this.pendingMounts.delete(leaf);
    return request ?? null;
  }

  clearPendingMount(leaf: WorkspaceLeaf): void {
    this.pendingMounts.delete(leaf);
  }

  private async waitForTerminalView(
    leaf: WorkspaceLeaf,
    timeoutMs = 2000,
  ): Promise<TerminalView | null> {
    await leaf.loadIfDeferred?.();
    const deadline = Date.now() + timeoutMs;
    do {
      const view = leaf.view;
      if (view && typeof (view as TerminalView).getTerminalInstance === 'function'
        && view.getViewType() === TERMINAL_VIEW_TYPE) {
        return view as TerminalView;
      }
      if (Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    const view = leaf.view;
    return view && typeof (view as TerminalView).getTerminalInstance === 'function'
      && view.getViewType() === TERMINAL_VIEW_TYPE ? view as TerminalView : null;
  }

  private createHandle(terminal: TerminalInstance, service: TerminalService): TerminalHandle {
    const isClosed = () => !this.dependencies.isAvailable() || service.getTerminal(terminal.id) !== terminal;
    const findView = () => this.dependencies.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE)
      .map((leaf) => ({ leaf, view: leaf.view as TerminalView }))
      .find(({ view }) => view.getTerminalInstance?.() === terminal);
    return createTerminalApiHandle(terminal, {
      isClosed,
      focus: async () => {
        const current = findView();
        if (!current) throw new Error('Termy terminal view is unavailable');
        await this.dependencies.workspace.revealLeaf(current.leaf);
        if (isClosed()) throw new Error('Termy terminal is closed');
        const moved = findView();
        if (!moved) throw new Error('Termy terminal view is unavailable');
        this.dependencies.workspace.setActiveLeaf(moved.leaf, { focus: true });
      },
      close: async () => {
        if (isClosed()) return;
        await service.destroyTerminal(terminal.id);
        findView()?.leaf.detach();
      },
    });
  }
}
