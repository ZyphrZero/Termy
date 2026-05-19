/**
 * Agent output view.
 *
 * A read-only Obsidian `ItemView` that mirrors the
 * {@link AgentEventBus}'s structured event stream as Markdown.
 * Conceptually equivalent to Zed's agent panel: the user can keep
 * the regular xterm.js terminal next to it and let AI assistants
 * stream their replies into the panel as Markdown / tool cards
 * instead of into raw bytes.
 *
 * The view itself stays dumb. All state lives in
 * {@link AgentSessionModel}; this class only translates session
 * snapshots into DOM nodes.
 */

import type { Component, WorkspaceLeaf } from 'obsidian';
import { ItemView, Menu, Notice, setIcon, setTooltip } from 'obsidian';

import type { AgentEventBus } from '../../services/agentStream/agentEventBus';
import { AgentSessionModel, type AgentSessionSnapshot } from '../../services/agentStream/agentSessionModel';
import type { AgentSessionId } from '../../services/agentStream/agentEventTypes';
import { renderAgentSnapshot, type AgentSnapshotRenderer } from './agentMarkdownRenderer';
import { createAgentSnapshotRenderer } from './agentMarkdownRendererFactory';
import { t } from '../../i18n';
import { errorLog } from '../../utils/logger';

export const AGENT_OUTPUT_VIEW_TYPE = 'termy-agent-output-view';
const AGENT_OUTPUT_ICON = 'sparkles';

export interface AgentOutputViewOptions {
  /** Bus the view subscribes to. */
  bus: AgentEventBus;
  /**
   * Optional callback the view invokes when the user submits a
   * prompt. Until this callback is supplied (the bridge-only setup
   * has no way to inject text), the input box is hidden.
   */
  submitPrompt?: (text: string) => Promise<void> | void;
  /** Optional callback used by the cancel button to interrupt a turn. */
  cancelTurn?: () => void;
  /**
   * Factory hook used to swap renderers in tests. Production code
   * passes the default factory which delegates to Obsidian's
   * {@link MarkdownRenderer}.
   */
  rendererFactory?: (view: AgentOutputView) => AgentSnapshotRenderer;
}

export class AgentOutputView extends ItemView {
  private readonly bus: AgentEventBus;
  private readonly model = new AgentSessionModel();
  private readonly rendererFactory: (view: AgentOutputView) => AgentSnapshotRenderer;
  private readonly submitPrompt?: (text: string) => Promise<void> | void;
  private readonly cancelTurn?: () => void;
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeModel: (() => void) | null = null;

  private headerTitleEl: HTMLElement | null = null;
  private headerSubtitleEl: HTMLElement | null = null;
  private headerStatusEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  private renderHandle: number | null = null;
  private focusedSessionId: AgentSessionId | null = null;
  private renderToken = 0;

  constructor(leaf: WorkspaceLeaf, options: AgentOutputViewOptions) {
    super(leaf);
    this.bus = options.bus;
    this.rendererFactory = options.rendererFactory ?? ((view) => createAgentSnapshotRenderer(view.app));
    this.submitPrompt = options.submitPrompt;
    this.cancelTurn = options.cancelTurn;
  }

  getViewType(): string {
    return AGENT_OUTPUT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('agent.viewTitle');
  }

  getIcon(): string {
    return AGENT_OUTPUT_ICON;
  }

  protected onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('termy-agent-view');

    this.renderShell(contentEl);

    this.unsubscribeModel = this.model.subscribe((sessionId) => {
      this.handleModelChange(sessionId);
    });

    this.unsubscribeBus = this.bus.subscribe((envelope) => {
      try {
        this.model.apply(envelope);
      } catch (error) {
        errorLog('[AgentOutputView] Failed to apply envelope:', error);
      }
    });

    this.scheduleRender();
    return Promise.resolve();
  }

  protected onClose(): Promise<void> {
    if (this.renderHandle !== null) {
      window.cancelAnimationFrame?.(this.renderHandle);
      this.renderHandle = null;
    }
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    if (this.unsubscribeModel) {
      this.unsubscribeModel();
      this.unsubscribeModel = null;
    }
    this.contentEl.empty();
    return Promise.resolve();
  }

  /**
   * Drop every session and re-render. Bound to the toolbar's "clear"
   * action; not destructive — agents continue to stream into the
   * empty model.
   */
  clear(): void {
    this.model.resetAll();
    this.focusedSessionId = null;
    this.scheduleRender();
  }

  /**
   * Force a re-render. Exposed for tests and for callers that change
   * the snapshot externally (currently nothing in production does).
   */
  refresh(): void {
    this.scheduleRender();
  }

  private renderShell(root: HTMLElement): void {
    const header = root.createDiv({ cls: 'termy-agent-header' });
    const titleGroup = header.createDiv({ cls: 'termy-agent-header-title-group' });
    const iconEl = titleGroup.createDiv({ cls: 'termy-agent-header-icon' });
    setIcon(iconEl, AGENT_OUTPUT_ICON);

    const titleStack = titleGroup.createDiv({ cls: 'termy-agent-header-title-stack' });
    this.headerTitleEl = titleStack.createDiv({
      cls: 'termy-agent-header-title',
      text: t('agent.headerIdle'),
    });
    this.headerSubtitleEl = titleStack.createDiv({
      cls: 'termy-agent-header-subtitle',
      text: t('agent.headerSubtitleIdle'),
    });

    this.headerStatusEl = header.createDiv({ cls: 'termy-agent-header-status' });
    this.headerStatusEl.setText('');

    const actions = header.createDiv({ cls: 'termy-agent-header-actions' });
    const clearBtn = actions.createEl('button', {
      cls: 'clickable-icon termy-agent-header-action',
      attr: { type: 'button' },
    });
    setIcon(clearBtn, 'eraser');
    setTooltip(clearBtn, t('agent.clearTooltip'));
    clearBtn.addEventListener('click', () => {
      this.clear();
    });

    const menuBtn = actions.createEl('button', {
      cls: 'clickable-icon termy-agent-header-action',
      attr: { type: 'button' },
    });
    setIcon(menuBtn, 'more-vertical');
    setTooltip(menuBtn, t('agent.moreActions'));
    menuBtn.addEventListener('click', (event) => {
      this.showHeaderMenu(event);
    });

    const body = root.createDiv({ cls: 'termy-agent-body' });
    this.bodyEl = body;
    this.emptyStateEl = body.createDiv({ cls: 'termy-agent-empty' });
    this.emptyStateEl.createDiv({
      cls: 'termy-agent-empty-title',
      text: t('agent.emptyTitle'),
    });
    this.emptyStateEl.createDiv({
      cls: 'termy-agent-empty-body',
      text: t('agent.emptyBody'),
    });

    if (this.submitPrompt) {
      this.renderInputBar(root);
    }
  }

  private renderInputBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'termy-agent-input-bar' });

    const textarea = bar.createEl('textarea', {
      cls: 'termy-agent-input',
      attr: {
        rows: '2',
        placeholder: t('agent.inputPlaceholder'),
        spellcheck: 'false',
      },
    });

    const actions = bar.createDiv({ cls: 'termy-agent-input-actions' });
    const sendBtn = actions.createEl('button', {
      cls: 'mod-cta termy-agent-send-btn',
      text: t('agent.sendButton'),
      attr: { type: 'button' },
    });

    if (this.cancelTurn) {
      const cancelBtn = actions.createEl('button', {
        cls: 'termy-agent-cancel-btn',
        text: t('agent.cancelButton'),
        attr: { type: 'button' },
      });
      cancelBtn.addEventListener('click', () => {
        this.cancelTurn?.();
      });
    }

    const submit = (): void => {
      const text = textarea.value.trim();
      if (!text || !this.submitPrompt) return;
      textarea.value = '';
      try {
        const maybe = this.submitPrompt(text);
        if (maybe instanceof Promise) {
          maybe.catch((error: unknown) => {
            errorLog('[AgentOutputView] submitPrompt failed:', error);
            new Notice(t('agent.noticeSubmitFailed'));
          });
        }
      } catch (error) {
        errorLog('[AgentOutputView] submitPrompt failed:', error);
        new Notice(t('agent.noticeSubmitFailed'));
      }
    };

    sendBtn.addEventListener('click', () => submit());
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        submit();
      }
    });
  }

  private showHeaderMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(t('agent.menuClear'));
      item.setIcon('eraser');
      item.onClick(() => this.clear());
    });
    menu.addItem((item) => {
      item.setTitle(t('agent.menuCopyTranscript'));
      item.setIcon('clipboard-copy');
      item.onClick(() => {
        void this.copyTranscriptToClipboard();
      });
    });
    menu.showAtMouseEvent(event);
  }

  private async copyTranscriptToClipboard(): Promise<void> {
    const snapshot = this.getActiveSnapshot();
    if (!snapshot) {
      new Notice(t('agent.noticeNothingToCopy'));
      return;
    }
    const text = serializeSnapshotToMarkdown(snapshot);
    try {
      await navigator.clipboard.writeText(text);
      new Notice(t('agent.noticeTranscriptCopied'));
    } catch (error) {
      errorLog('[AgentOutputView] Failed to copy transcript:', error);
      new Notice(t('agent.noticeCopyFailed'));
    }
  }

  private handleModelChange(sessionId: AgentSessionId): void {
    if (this.focusedSessionId === null) {
      this.focusedSessionId = sessionId;
    }
    if (this.focusedSessionId !== sessionId) {
      // We do not yet expose multi-session switching, but we still
      // render so the empty state goes away when the first event
      // arrives in any session.
    }
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderHandle !== null) {
      return;
    }
    this.renderHandle = window.requestAnimationFrame(() => {
      this.renderHandle = null;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (!this.bodyEl) {
      return;
    }
    const snapshot = this.getActiveSnapshot();
    this.updateHeader(snapshot);

    if (!snapshot || snapshot.blocks.length === 0) {
      this.bodyEl.empty();
      this.emptyStateEl = this.bodyEl.createDiv({ cls: 'termy-agent-empty' });
      this.emptyStateEl.createDiv({
        cls: 'termy-agent-empty-title',
        text: t('agent.emptyTitle'),
      });
      this.emptyStateEl.createDiv({
        cls: 'termy-agent-empty-body',
        text: t('agent.emptyBody'),
      });
      return;
    }

    this.emptyStateEl = null;
    this.bodyEl.empty();
    const transcriptEl = this.bodyEl.createDiv({ cls: 'termy-agent-transcript' });
    const renderer = this.rendererFactory(this);

    const token = ++this.renderToken;
    const renderTarget = (snapshot: AgentSessionSnapshot, target: HTMLElement, owner: Component): void => {
      if (token !== this.renderToken) {
        return;
      }
      void renderAgentSnapshot(snapshot, target, owner, renderer);
    };
    renderTarget(snapshot, transcriptEl, this);

    // Auto-scroll to the latest content. Conservative — only when
    // the user is already pinned to the bottom.
    if (this.isScrolledToBottom(this.bodyEl)) {
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    }
  }

  private updateHeader(snapshot: AgentSessionSnapshot | null): void {
    if (!this.headerTitleEl || !this.headerSubtitleEl || !this.headerStatusEl) {
      return;
    }
    if (!snapshot) {
      this.headerTitleEl.setText(t('agent.headerIdle'));
      this.headerSubtitleEl.setText(t('agent.headerSubtitleIdle'));
      this.headerStatusEl.setText('');
      return;
    }
    this.headerTitleEl.setText(snapshot.sessionId);
    const detail = snapshot.detail ?? this.describeState(snapshot.state);
    this.headerSubtitleEl.setText(detail);

    this.headerStatusEl.empty();
    const indicator = this.headerStatusEl.createSpan({
      cls: `termy-agent-state termy-agent-state-${snapshot.state}`,
      text: this.describeState(snapshot.state),
    });
    indicator.setAttribute('aria-label', this.describeState(snapshot.state));
  }

  private describeState(state: AgentSessionSnapshot['state']): string {
    switch (state) {
      case 'idle': return t('agent.stateIdle');
      case 'running': return t('agent.stateRunning');
      case 'awaiting-input': return t('agent.stateAwaitingInput');
      case 'finished': return t('agent.stateFinished');
      case 'errored': return t('agent.stateErrored');
      default: return state;
    }
  }

  private getActiveSnapshot(): AgentSessionSnapshot | null {
    if (this.focusedSessionId) {
      const focused = this.model.getSnapshot(this.focusedSessionId);
      if (focused) {
        return focused;
      }
    }
    const all = this.model.getAllSnapshots();
    return all.length > 0 ? all[all.length - 1] : null;
  }

  private isScrolledToBottom(el: HTMLElement): boolean {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < 64;
  }
}

/**
 * Plain-text serialization used by the "copy transcript" action.
 * Tool cards and errors are flattened into Markdown so that pasting
 * into a note keeps the structure recognizable.
 */
function serializeSnapshotToMarkdown(snapshot: AgentSessionSnapshot): string {
  const parts: string[] = [];
  parts.push(`# ${snapshot.sessionId}`);
  if (snapshot.detail) {
    parts.push(`_${snapshot.detail}_`);
  }
  if (snapshot.plan.length > 0) {
    parts.push('## Plan');
    for (const step of snapshot.plan) {
      const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
      parts.push(`- ${checkbox} ${step.title} _(${step.status})_`);
    }
  }
  for (const block of snapshot.blocks) {
    if (block.kind === 'text') {
      parts.push(block.body);
    } else if (block.kind === 'tool') {
      parts.push(`### ${block.title} _(${block.status})_`);
      if (block.subtitle) {
        parts.push(`_${block.subtitle}_`);
      }
      if (block.body) {
        parts.push(block.body);
      }
      if (block.output) {
        parts.push('```');
        parts.push(block.output);
        parts.push('```');
      }
      if (block.diff) {
        parts.push('```diff');
        parts.push(block.diff.unified);
        parts.push('```');
      }
    } else if (block.kind === 'error') {
      parts.push(`> [!warning] ${block.message}`);
      if (block.details) {
        parts.push(block.details);
      }
    }
  }
  return parts.join('\n\n');
}
