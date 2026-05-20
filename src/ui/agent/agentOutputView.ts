/**
 * Agent output view.
 *
 * Two-pane layout:
 *   - Left: provider tabs (OpenCode / Claude Code) + a session
 *     history list. Clicking a session loads its transcript and
 *     parks the input box on top of that session, so resuming a
 *     conversation that was started in the terminal is one click
 *     away.
 *   - Right: the transcript itself, rendered through
 *     {@link AgentSessionModel}. The model is provider-agnostic,
 *     so the same renderer handles whatever events the active
 *     source produces.
 *
 * Sources:
 *   - Live ACP source ({@link AcpAgentSource}) �?pushed into the
 *     bus in main.ts, the panel still picks it up here.
 *   - OpenCode HTTP �?the panel calls
 *     {@link OpenCodeHistoryService} directly for history listing,
 *     transcript loading, and prompt submission. Live updates flow
 *     through the same {@link AgentEventBus} via the bus listener
 *     wired up in {@link AgentOutputView.attachOpenCodeBus}.
 *
 * The view itself stays dumb where possible: rendering is driven
 * entirely by snapshots from {@link AgentSessionModel}, and any
 * change that affects the layout flows through {@link scheduleRender}.
 */

import type { Component, WorkspaceLeaf } from 'obsidian';
import { ItemView, Menu, Notice, setIcon, setTooltip } from 'obsidian';

import type { AgentEventBus } from '../../services/agentStream/agentEventBus';
import { AgentSessionModel, type AgentSessionSnapshot } from '../../services/agentStream/agentSessionModel';
import type { AgentSessionId } from '../../services/agentStream/agentEventTypes';
import {
  type AgentProviderId,
  AGENT_PROVIDER_ORDER,
  AGENT_PROVIDERS,
  DEFAULT_AGENT_PROVIDER,
} from '../../services/agent/agentProvider';
import { renderAgentBrandIcon } from './agentBrandIcon';
import type {
  OpenCodeHistoryService,
  OpenCodeHistorySession,
} from '../../services/agent/opencode/opencodeHistoryService';
import { adaptTranscriptToEvents, adaptMessageToEvents } from '../../services/agent/opencode/opencodeMessageAdapter';
import type { OpenCodeBusEvent, OpenCodeMessageWithParts } from '../../services/agent/opencode/opencodeHttpClient';
import type {
  ClaudeCodeHistoryService,
  ClaudeCodeSession,
} from '../../services/agent/claudeCode/claudeCodeHistoryService';
import { renderAgentSnapshot, type AgentSnapshotRenderer } from './agentMarkdownRenderer';
import { createAgentSnapshotRenderer } from './agentMarkdownRendererFactory';
import { t } from '../../i18n';
import { errorLog } from '../../utils/logger';

export const AGENT_OUTPUT_VIEW_TYPE = 'termy-agent-output-view';
const AGENT_OUTPUT_ICON = 'sparkles';

const SESSION_LIST_REFRESH_INTERVAL_MS = 30_000;

export interface AgentOutputViewOptions {
  /** Bus the view subscribes to. */
  bus: AgentEventBus;
  /**
   * Optional callback the view invokes when the user submits a
   * prompt to the **ACP agent path** (current OpenCode CLI ACP
   * source). The OpenCode HTTP path goes through
   * {@link getOpenCodeHistoryService} instead.
   */
  submitPrompt?: (text: string) => Promise<void> | void;
  /** Optional callback used by the cancel button to interrupt a turn. */
  cancelTurn?: () => void;
  /**
   * Returns the OpenCode history bridge if the host can provide
   * one. Returning `null` keeps the OpenCode tab visible but
   * disabled, with a "not available" empty state.
   */
  getOpenCodeHistoryService?: () => OpenCodeHistoryService | null;
  /**
   * Returns the Claude Code history bridge. Returning `null` keeps
   * the Claude Code tab visible but shows "not available".
   */
  getClaudeCodeHistoryService?: () => ClaudeCodeHistoryService | null;
  /**
   * Factory hook used to swap renderers in tests. Production code
   * passes the default factory which delegates to Obsidian's
   * {@link MarkdownRenderer}.
   */
  rendererFactory?: (view: AgentOutputView) => AgentSnapshotRenderer;
}

interface ProviderState {
  sessions: Array<OpenCodeHistorySession | ClaudeCodeSession>;
  loading: boolean;
  error: string | null;
  /** Stable session id for the currently displayed transcript, if any. */
  activeSessionId: string | null;
  /** Local OpenCode session ids that have an open bus subscription. */
  busAttached: boolean;
  /**
   * The bus listener instance for OpenCode is multiplexed across
   * sessions; we hold the unsubscribe so leaving the panel stops
   * listening.
   */
  busUnsubscribe: (() => void) | null;
}

export class AgentOutputView extends ItemView {
  private readonly bus: AgentEventBus;
  private readonly model = new AgentSessionModel();
  private readonly rendererFactory: (view: AgentOutputView) => AgentSnapshotRenderer;
  private readonly submitPrompt?: (text: string) => Promise<void> | void;
  private readonly cancelTurn?: () => void;
  private readonly getOpenCodeHistoryService?: () => OpenCodeHistoryService | null;
  private readonly getClaudeCodeHistoryService?: () => ClaudeCodeHistoryService | null;
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeModel: (() => void) | null = null;

  // Layout containers (populated in renderShell).
  private headerTitleEl: HTMLElement | null = null;
  private headerSubtitleEl: HTMLElement | null = null;
  private headerStatusEl: HTMLElement | null = null;
  private providerTabsEl: HTMLElement | null = null;
  private sessionsHeaderEl: HTMLElement | null = null;
  private sessionsListEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  private inputBarEl: HTMLElement | null = null;
  private inputTextareaEl: HTMLTextAreaElement | null = null;
  private inputSendBtnEl: HTMLElement | null = null;

  private renderHandle: number | null = null;
  private focusedSessionId: AgentSessionId | null = null;
  private renderToken = 0;
  private activeProvider: AgentProviderId = DEFAULT_AGENT_PROVIDER;
  /** Refresh-on-interval timer for the sessions sidebar. */
  private sessionsRefreshTimer: number | null = null;

  private readonly providerState: Record<AgentProviderId, ProviderState> = {
    opencode: defaultProviderState(),
    'claude-code': defaultProviderState(),
  };

  constructor(leaf: WorkspaceLeaf, options: AgentOutputViewOptions) {
    super(leaf);
    this.bus = options.bus;
    this.rendererFactory = options.rendererFactory ?? ((view) => createAgentSnapshotRenderer(view.app));
    this.submitPrompt = options.submitPrompt;
    this.cancelTurn = options.cancelTurn;
    this.getOpenCodeHistoryService = options.getOpenCodeHistoryService;
    this.getClaudeCodeHistoryService = options.getClaudeCodeHistoryService;
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

    // Reset transient state on every open so reopening the panel
    // does not surface a stale snapshot from a previous session
    // (e.g. a transcript the user had loaded earlier, or events
    // that streamed through the IDE bridge while the panel was
    // closed). The bus replay buffer would otherwise re-hydrate the
    // model with messages for a session the user is not currently
    // focused on.
    this.model.resetAll();
    this.focusedSessionId = null;
    for (const provider of AGENT_PROVIDER_ORDER) {
      this.providerState[provider].activeSessionId = null;
    }

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

    // Eager-load the active provider's session list so the sidebar
    // has something to show as soon as the panel opens. Both
    // providers are cheap to refresh, but we only need the list for
    // whichever tab is active by default.
    if (this.activeProvider === 'claude-code') {
      this.refreshClaudeCodeSessions();
    } else {
      void this.refreshOpenCodeSessions().catch((error) => {
        errorLog('[AgentOutputView] Failed to refresh sessions:', error);
      });
    }

    this.sessionsRefreshTimer = window.setInterval(() => {
      // Refresh whichever provider is active so the sidebar stays
      // in sync with sessions started in the terminal. Errors are
      // already surfaced in the sidebar; the periodic refresh
      // shouldn't spam the console.
      if (this.activeProvider === 'claude-code') {
        try {
          this.refreshClaudeCodeSessions();
        } catch {
          // sidebar shows error
        }
      } else {
        void this.refreshOpenCodeSessions().catch(() => {
          // sidebar shows error
        });
      }
    }, SESSION_LIST_REFRESH_INTERVAL_MS);

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
    if (this.sessionsRefreshTimer !== null) {
      window.clearInterval(this.sessionsRefreshTimer);
      this.sessionsRefreshTimer = null;
    }
    for (const provider of AGENT_PROVIDER_ORDER) {
      const state = this.providerState[provider];
      if (state.busUnsubscribe) {
        try {
          state.busUnsubscribe();
        } catch (error) {
          errorLog('[AgentOutputView] Failed to detach bus listener:', error);
        }
        state.busUnsubscribe = null;
        state.busAttached = false;
      }
    }
    this.contentEl.empty();
    return Promise.resolve();
  }

  /**
   * Drop every session and re-render. Bound to the toolbar's "clear"
   * action; not destructive �?agents continue to stream into the
   * empty model.
   */
  clear(): void {
    this.model.resetAll();
    this.focusedSessionId = null;
    for (const provider of AGENT_PROVIDER_ORDER) {
      this.providerState[provider].activeSessionId = null;
    }
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

    // Provider tabs ─────────────────────────────────────────────
    this.providerTabsEl = root.createDiv({ cls: 'termy-agent-provider-tabs' });
    this.renderProviderTabs();

    // Two-pane layout: sessions sidebar + transcript.
    const layout = root.createDiv({ cls: 'termy-agent-layout' });

    const sidebar = layout.createDiv({ cls: 'termy-agent-sidebar' });
    this.sessionsHeaderEl = sidebar.createDiv({ cls: 'termy-agent-sidebar-header' });
    this.renderSessionsHeader();

    this.sessionsListEl = sidebar.createDiv({ cls: 'termy-agent-sessions-list' });

    const main = layout.createDiv({ cls: 'termy-agent-main' });
    const body = main.createDiv({ cls: 'termy-agent-body' });
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

    // Render the input bar regardless of submitPrompt �?when the
    // OpenCode tab is active we route through the history service.
    this.renderInputBar(main);
    this.renderSessionsList();
  }

  private renderProviderTabs(): void {
    if (!this.providerTabsEl) return;
    this.providerTabsEl.empty();
    for (const providerId of AGENT_PROVIDER_ORDER) {
      const info = AGENT_PROVIDERS[providerId];
      const button = this.providerTabsEl.createEl('button', {
        cls: 'termy-agent-provider-tab',
        attr: { type: 'button' },
      });
      if (providerId === this.activeProvider) {
        button.addClass('is-active');
      }
      if (!info.enabled) {
        button.addClass('is-disabled');
        button.disabled = true;
        setTooltip(button, t('agent.sessionsComingSoon'));
      }
      const iconEl = button.createSpan({ cls: 'termy-agent-provider-tab-icon' });
      renderAgentBrandIcon(iconEl, info.lobeIconKey, 'sparkles');
      button.createSpan({ cls: 'termy-agent-provider-tab-label', text: info.label });
      button.addEventListener('click', () => {
        if (!info.enabled) return;
        this.switchProvider(providerId);
      });
    }
  }

  private renderSessionsHeader(): void {
    if (!this.sessionsHeaderEl) return;
    this.sessionsHeaderEl.empty();
    this.sessionsHeaderEl.createDiv({ cls: 'termy-agent-sidebar-title', text: t('agent.sessionsHeading') });

    const actions = this.sessionsHeaderEl.createDiv({ cls: 'termy-agent-sidebar-actions' });

    const refreshBtn = actions.createEl('button', {
      cls: 'clickable-icon termy-agent-sidebar-action',
      attr: { type: 'button' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    setTooltip(refreshBtn, t('agent.sessionsRefresh'));
    refreshBtn.addEventListener('click', () => {
      void this.refreshOpenCodeSessions(true).catch((error) => {
        errorLog('[AgentOutputView] Failed to refresh sessions:', error);
      });
    });

    const newBtn = actions.createEl('button', {
      cls: 'clickable-icon termy-agent-sidebar-action',
      attr: { type: 'button' },
    });
    setIcon(newBtn, 'plus');
    setTooltip(newBtn, t('agent.sessionsNewSession'));
    newBtn.addEventListener('click', () => {
      void this.createNewSession().catch((error) => {
        errorLog('[AgentOutputView] Failed to create session:', error);
        new Notice(this.formatLoadFailure(error));
      });
    });
  }

  private renderInputBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'termy-agent-input-bar' });
    this.inputBarEl = bar;

    const textarea = bar.createEl('textarea', {
      cls: 'termy-agent-input',
      attr: {
        rows: '2',
        placeholder: t('agent.inputPlaceholder'),
        spellcheck: 'false',
      },
    });
    this.inputTextareaEl = textarea;

    const actions = bar.createDiv({ cls: 'termy-agent-input-actions' });
    const sendBtn = actions.createEl('button', {
      cls: 'mod-cta termy-agent-send-btn',
      text: t('agent.sendButton'),
      attr: { type: 'button' },
    });
    this.inputSendBtnEl = sendBtn;

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
      if (!text) return;
      textarea.value = '';
      void this.handleSubmit(text);
    };

    sendBtn.addEventListener('click', () => submit());
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        submit();
      }
    });
  }

  private async handleSubmit(text: string): Promise<void> {
    try {
      if (this.activeProvider === 'opencode') {
        const service = this.getOpenCodeHistoryService?.() ?? null;
        if (!service) {
          new Notice(t('agent.sessionsProviderUnavailable'));
          return;
        }
        const state = this.providerState.opencode;
        // Ensure a session exists before we send the prompt; create
        // one on-the-fly when the user types into a fresh panel.
        let sessionId = state.activeSessionId;
        if (!sessionId) {
          const session = await service.createSession({});
          sessionId = session.id;
          state.activeSessionId = sessionId;
          state.sessions = [session, ...state.sessions];
          this.focusedSessionId = sessionIdFor('opencode', sessionId);
          this.renderSessionsList();
        }
        this.ensureOpenCodeBusAttached();
        await service.sendPrompt(sessionId, text);
        return;
      }

      if (this.activeProvider === 'claude-code') {
        const service = this.getClaudeCodeHistoryService?.() ?? null;
        if (!service) {
          new Notice(t('agent.sessionsProviderUnavailable'));
          return;
        }
        const state = this.providerState['claude-code'];
        const claudeSessionId = state.activeSessionId ?? undefined;
        const internalId = sessionIdFor('claude-code', claudeSessionId ?? 'new');
        this.focusedSessionId = internalId;

        // Echo the user message immediately.
        this.model.applyEvent({
          kind: 'text',
          sessionId: internalId,
          channel: 'final',
          delta: `\n\n**You:** ${text}\n\n`,
        });
        this.model.applyEvent({ kind: 'text-done', sessionId: internalId, channel: 'final' });

        const resolvedSid = await service.sendPrompt(
          internalId,
          claudeSessionId,
          text,
          (event) => {
            try {
              this.model.applyEvent(event);
            } catch (error) {
              errorLog('[AgentOutputView] Claude stream event error:', error);
            }
          },
        );

        if (resolvedSid && resolvedSid !== claudeSessionId) {
          state.activeSessionId = resolvedSid;
          this.refreshClaudeCodeSessions();
        }
        return;
      }

      if (this.submitPrompt) {
        const maybe = this.submitPrompt(text);
        if (maybe instanceof Promise) await maybe;
        return;
      }

      new Notice(t('agent.noticeSubmitFailed'));
    } catch (error) {
      errorLog('[AgentOutputView] Failed to submit prompt:', error);
      new Notice(t('agent.noticeSubmitFailed'));
    }
  }

  private switchProvider(providerId: AgentProviderId): void {
    if (this.activeProvider === providerId) return;
    this.activeProvider = providerId;
    this.renderProviderTabs();
    this.renderSessionsList();
    this.refocusActiveSession();
    this.scheduleRender();

    // Lazy-load sessions for the newly selected provider.
    if (providerId === 'claude-code') {
      this.refreshClaudeCodeSessions();
    } else if (providerId === 'opencode') {
      void this.refreshOpenCodeSessions().catch(() => { /* sidebar shows error */ });
    }
  }

  private async refreshOpenCodeSessions(force = false): Promise<void> {
    const service = this.getOpenCodeHistoryService?.() ?? null;
    const state = this.providerState.opencode;
    if (!service) {
      state.error = t('agent.sessionsProviderUnavailable');
      state.loading = false;
      this.renderSessionsList();
      return;
    }

    // Skip while a load is already in flight; the periodic timer
    // calls us, so duplicate requests are easy to trigger.
    if (state.loading && !force) return;
    state.loading = true;
    state.error = null;
    this.renderSessionsList();

    try {
      const sessions = await service.listSessions();
      state.sessions = sessions;
      state.error = null;
    } catch (error) {
      state.error = this.formatLoadFailure(error);
      errorLog('[AgentOutputView] OpenCode listSessions failed:', error);
    } finally {
      state.loading = false;
      this.renderSessionsList();
    }
  }

  private refreshClaudeCodeSessions(): void {
    const service = this.getClaudeCodeHistoryService?.() ?? null;
    const state = this.providerState['claude-code'];
    if (!service) {
      state.error = t('agent.sessionsProviderUnavailable');
      state.loading = false;
      this.renderSessionsList();
      return;
    }

    state.loading = true;
    state.error = null;
    this.renderSessionsList();

    try {
      const sessions = service.listSessions();
      state.sessions = sessions;
      state.error = null;
    } catch (error) {
      state.error = this.formatLoadFailure(error);
      errorLog('[AgentOutputView] Claude Code listSessions failed:', error);
    } finally {
      state.loading = false;
      this.renderSessionsList();
    }
  }

  private renderSessionsList(): void {
    if (!this.sessionsListEl) return;
    this.sessionsListEl.empty();

    const state = this.providerState[this.activeProvider];

    if (state.loading && state.sessions.length === 0) {
      this.sessionsListEl.createDiv({
        cls: 'termy-agent-sidebar-status',
        text: t('agent.sessionsLoading'),
      });
      return;
    }

    if (state.error) {
      this.sessionsListEl.createDiv({
        cls: 'termy-agent-sidebar-status is-error',
        text: state.error,
      });
      return;
    }

    if (state.sessions.length === 0) {
      this.sessionsListEl.createDiv({
        cls: 'termy-agent-sidebar-status',
        text: t('agent.sessionsEmpty'),
      });
      return;
    }

    for (const session of state.sessions) {
      const item = this.sessionsListEl.createDiv({
        cls: 'termy-agent-session-item',
      });
      if (session.id === state.activeSessionId) {
        item.addClass('is-active');
      }

      const titleText = session.title && session.title.length > 0
        ? session.title
        : t('agent.sessionItemUntitled');
      item.createDiv({
        cls: 'termy-agent-session-title',
        text: titleText,
      });

      // OpenCode sessions have `time.updated`; Claude sessions have `updatedAt`.
      const updated = 'updatedAt' in session
        ? (session as { updatedAt: number }).updatedAt
        : ('time' in session ? ((session as { time?: { updated?: number } }).time?.updated ?? Date.now()) : Date.now());
      item.createDiv({
        cls: 'termy-agent-session-meta',
        text: formatRelativeTime(updated, Date.now()),
      });

      const sessionId = session.id;
      item.addEventListener('click', () => {
        if (this.activeProvider === 'claude-code') {
          try {
            this.loadClaudeCodeSession(sessionId);
          } catch (error) {
            errorLog('[AgentOutputView] Failed to load Claude session:', error);
            new Notice(this.formatLoadFailure(error));
          }
        } else {
          void this.loadOpenCodeSession(sessionId).catch((error) => {
            errorLog('[AgentOutputView] Failed to load session:', error);
            new Notice(this.formatLoadFailure(error));
          });
        }
      });
    }
  }

  private async loadOpenCodeSession(sessionId: string): Promise<void> {
    const service = this.getOpenCodeHistoryService?.() ?? null;
    if (!service) {
      new Notice(t('agent.sessionsProviderUnavailable'));
      return;
    }

    const state = this.providerState.opencode;
    state.activeSessionId = sessionId;
    const internalId = sessionIdFor('opencode', sessionId);
    this.focusedSessionId = internalId;

    // Reset whatever was rendered for this session previously and
    // show a "loading" placeholder while we fetch the transcript.
    this.model.reset(internalId);
    this.scheduleRender();
    this.renderSessionsList();
    this.setBusyHint(t('agent.transcriptLoading'));

    try {
      const messages = await service.loadTranscript(sessionId);
      const events = adaptTranscriptToEvents(internalId, messages);
      this.model.applyEventsBatch(internalId, events);
      this.scheduleRender();
      this.setBusyHint(null);
    } catch (error) {
      this.setBusyHint(null);
      const message = this.formatLoadFailure(error);
      errorLog('[AgentOutputView] OpenCode loadTranscript failed:', error);
      new Notice(message);
      throw error;
    }

    this.ensureOpenCodeBusAttached();
  }

  private loadClaudeCodeSession(sessionId: string): void {
    const service = this.getClaudeCodeHistoryService?.() ?? null;
    if (!service) {
      new Notice(t('agent.sessionsProviderUnavailable'));
      return;
    }

    const state = this.providerState['claude-code'];
    state.activeSessionId = sessionId;
    const internalId = sessionIdFor('claude-code', sessionId);
    this.focusedSessionId = internalId;

    this.model.reset(internalId);
    this.renderSessionsList();
    this.setBusyHint(t('agent.transcriptLoading'));

    try {
      const events = service.loadTranscript(internalId, sessionId);
      this.model.applyEventsBatch(internalId, events);
      this.scheduleRender();
      this.setBusyHint(null);
    } catch (error) {
      this.setBusyHint(null);
      const message = this.formatLoadFailure(error);
      errorLog('[AgentOutputView] Claude Code loadTranscript failed:', error);
      new Notice(message);
    }
  }

  private async createNewSession(): Promise<void> {
    const service = this.getOpenCodeHistoryService?.() ?? null;
    if (!service) {
      new Notice(t('agent.sessionsProviderUnavailable'));
      return;
    }
    const session = await service.createSession({});
    const state = this.providerState.opencode;
    state.sessions = [session, ...state.sessions];
    state.activeSessionId = session.id;
    this.focusedSessionId = sessionIdFor('opencode', session.id);
    this.model.reset(this.focusedSessionId);
    this.renderSessionsList();
    this.scheduleRender();
    this.ensureOpenCodeBusAttached();
  }

  private ensureOpenCodeBusAttached(): void {
    const service = this.getOpenCodeHistoryService?.() ?? null;
    const state = this.providerState.opencode;
    if (!service || state.busAttached) return;

    const unsubscribe = service.subscribeBus((event) => this.handleOpenCodeBusEvent(event));
    state.busUnsubscribe = unsubscribe;
    state.busAttached = true;
  }

  private handleOpenCodeBusEvent(event: OpenCodeBusEvent): void {
    const state = this.providerState.opencode;
    if (!state.activeSessionId) return;

    const sessionId = extractSessionId(event);
    if (!sessionId || sessionId !== state.activeSessionId) return;

    const internalId = sessionIdFor('opencode', sessionId);

    if (event.type === 'session.message.updated' || event.type === 'session.part.updated') {
      const message = extractMessageFromEvent(event);
      if (!message) return;
      const events = adaptMessageToEvents(internalId, message);
      // The adapter is idempotent at the session-model level for
      // tool-call updates (it patches in place by toolCallId); the
      // text-block coalescing logic appends if a streaming block is
      // already open. To keep things simple we re-apply on every
      // notification �?tool-call updates land in the right spot, and
      // text duplication is bounded because OpenCode only emits one
      // notification per part state change.
      for (const e of events) {
        try {
          this.model.applyEvent(e);
        } catch (error) {
          errorLog('[AgentOutputView] Failed to apply opencode event:', error);
        }
      }
    }
  }

  private refocusActiveSession(): void {
    const state = this.providerState[this.activeProvider];
    if (state.activeSessionId) {
      this.focusedSessionId = sessionIdFor(this.activeProvider, state.activeSessionId);
    } else {
      this.focusedSessionId = null;
    }
  }

  private setBusyHint(text: string | null): void {
    if (!this.bodyEl) return;
    let hintEl = this.bodyEl.querySelector<HTMLElement>('.termy-agent-busy-hint');
    if (text === null) {
      if (hintEl) hintEl.remove();
      return;
    }
    if (!hintEl) {
      hintEl = this.bodyEl.createDiv({ cls: 'termy-agent-busy-hint' });
    }
    hintEl.setText(text);
  }

  private formatLoadFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return t('agent.sessionsLoadFailed', { message });
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

  private handleModelChange(_sessionId: AgentSessionId): void {
    // We intentionally do NOT auto-focus the first session that
    // appears in the model. Bus sources (ide-bridge, mock) and the
    // bus replay buffer can deposit envelopes for sessions the user
    // never asked about, and auto-focusing them surfaces stale
    // content the moment the panel opens. Focus is set explicitly
    // by sidebar clicks, new-session creation, and prompt
    // submission.
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
    const renderTarget = (snap: AgentSessionSnapshot, target: HTMLElement, owner: Component): void => {
      if (token !== this.renderToken) {
        return;
      }
      void renderAgentSnapshot(snap, target, owner, renderer);
    };
    renderTarget(snapshot, transcriptEl, this);

    // Auto-scroll to the latest content. Conservative �?only when
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
    this.headerTitleEl.setText(this.headerTitleFor(snapshot));
    const detail = snapshot.detail ?? this.describeState(snapshot.state);
    this.headerSubtitleEl.setText(detail);

    this.headerStatusEl.empty();
    const indicator = this.headerStatusEl.createSpan({
      cls: `termy-agent-state termy-agent-state-${snapshot.state}`,
      text: this.describeState(snapshot.state),
    });
    indicator.setAttribute('aria-label', this.describeState(snapshot.state));
  }

  /**
   * Resolve a human-friendly title for the panel header. Internal
   * snapshot ids look like `opencode:ses_abc123` — useless for the
   * user. We look up the matching session record from the sidebar
   * list and prefer its display title; falls back to the provider
   * label when no match is found.
   */
  private headerTitleFor(snapshot: AgentSessionSnapshot): string {
    const sid = snapshot.sessionId;
    const colonIndex = sid.indexOf(':');
    if (colonIndex === -1) return sid;
    const providerKey = sid.slice(0, colonIndex);
    const externalId = sid.slice(colonIndex + 1);

    let provider: AgentProviderId | null = null;
    if (providerKey === 'claude-code' || providerKey === 'opencode') {
      provider = providerKey;
    }
    if (!provider) return sid;

    const state = this.providerState[provider];
    const match = state.sessions.find((s) => s.id === externalId);
    if (match && match.title && match.title.length > 0) return match.title;
    return AGENT_PROVIDERS[provider].label;
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

  /**
   * The snapshot the panel is currently rendering. Returns `null`
   * when no session is focused — this matches the user's mental
   * model: clicking a session in the sidebar focuses it, until then
   * the empty state is shown. We deliberately do not fall back to
   * "any snapshot in the model" because the bus replay buffer can
   * leave stale sessions behind that the user was never looking at.
   */
  private getActiveSnapshot(): AgentSessionSnapshot | null {
    if (!this.focusedSessionId) return null;
    return this.model.getSnapshot(this.focusedSessionId);
  }

  private isScrolledToBottom(el: HTMLElement): boolean {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < 64;
  }
}

function defaultProviderState(): ProviderState {
  return {
    sessions: [],
    loading: false,
    error: null,
    activeSessionId: null,
    busAttached: false,
    busUnsubscribe: null,
  };
}

/**
 * Build the synthetic session id we feed into AgentSessionModel so
 * sessions from different providers cannot accidentally share state.
 * The provider prefix also lets us scope future bus-side filtering
 * if we need it.
 */
function sessionIdFor(provider: AgentProviderId, externalId: string): AgentSessionId {
  return `${provider}:${externalId}`;
}

function extractSessionId(event: OpenCodeBusEvent): string | null {
  const props = event.properties;
  const direct = props.sessionID;
  if (typeof direct === 'string') return direct;
  const info = props.info;
  if (typeof info === 'object' && info !== null) {
    const infoSession = (info as Record<string, unknown>).sessionID;
    if (typeof infoSession === 'string') return infoSession;
  }
  const part = props.part;
  if (typeof part === 'object' && part !== null) {
    const partSession = (part as Record<string, unknown>).sessionID;
    if (typeof partSession === 'string') return partSession;
  }
  return null;
}

function extractMessageFromEvent(event: OpenCodeBusEvent): OpenCodeMessageWithParts | null {
  // OpenCode emits two related event families:
  //   `session.message.updated` carries the full message.info shape
  //   `session.part.updated` carries a single part diff
  // The panel renders by re-applying the entire message envelope, so
  // we only handle `message.updated` for now. Live `part.updated`
  // events are surfaced to the UI on the next message-level update.
  if (event.type !== 'session.message.updated') return null;
  const props = event.properties;
  const info = props.info;
  if (typeof info !== 'object' || info === null) return null;
  const partsValue = props.parts;
  const parts = Array.isArray(partsValue) ? partsValue : [];
  return {
    info: info as OpenCodeMessageWithParts['info'],
    parts: parts as OpenCodeMessageWithParts['parts'],
  };
}

function formatRelativeTime(timestamp: number, now: number): string {
  const deltaSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (deltaSeconds < 60) return t('agent.sessionTimeJustNow');
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return t('agent.sessionTimeMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('agent.sessionTimeHours', { count: hours });
  const days = Math.floor(hours / 24);
  return t('agent.sessionTimeDays', { count: days });
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
