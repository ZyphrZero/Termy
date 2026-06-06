/**
 * Agent output view — data-driven rewrite.
 *
 * Two-pane layout:
 *   - Left: dynamic agent tabs (from settings) + session history list.
 *   - Right: transcript rendered through {@link AgentSessionModel}.
 *
 * The view is driven by `settings.getEnabledAgents()` — tabs are
 * generated from the live agent configuration array, and
 * `settings.onAgentsChange` triggers re-renders while preserving
 * the user's focus (Property 6.2).
 *
 * Sources:
 *   - Live ACP source via {@link AgentManager}.
 *   - Termy-owned imported ACP thread history.
 *
 * The view stays dumb: rendering is driven entirely by snapshots
 * from {@link AgentSessionModel}, and any change that affects the
 * layout flows through {@link scheduleRender}.
 */

import type { Component, WorkspaceLeaf } from 'obsidian';
import { ItemView, Menu, Notice, setIcon, setTooltip } from 'obsidian';

import type { AgentEventBus } from '../../services/agentStream/agentEventBus';
import { AgentSessionModel, type AgentSessionSnapshot } from '../../services/agentStream/agentSessionModel';
import type { AgentEvent, AgentSessionId } from '../../services/agentStream/agentEventTypes';
import type { SettingsAccessor } from '../../settings/settingsAccessor';
import type { AgentManager } from '../../services/agentStream/agentManager';
import type { PermissionQueue } from '../../services/agentStream/permissionQueue';
import type {
  ImportedAgentThreadHistoryService,
  ImportedAgentThreadListItem,
} from '../../services/agent/importedAgentThreadHistoryService';
import { renderAgentSnapshot, type AgentSnapshotRenderer } from './agentMarkdownRenderer';
import { createAgentSnapshotRenderer } from './agentMarkdownRendererFactory';
import { enrichPromptWithContext } from '../../services/agent/panelContextEncoder';
import type { AgentContextBridge } from '../../services/context/agentContextBridge';
import {
  renderProviderTabs,
  renderStatusIndicator,
  type TabRenderContext,
} from './agentOutputView.tabs';
import { buildProviderTabs, type ProviderTabConfig } from './agentProviderTabs';
import {
  isLiveAgentSession,
  buildThreadPoolItems,
  mergeLiveAgentSessions,
  requireSessionCwd,
  upsertLiveAgentSession,
  type LiveAgentSession,
  type ProviderIconConfig,
  type ProviderThreadSource,
  type ThreadPoolItem,
} from './agentProviderSessions';
import { renderInputBar } from './agentOutputView.input';
import { t } from '../../i18n';
import { errorLog } from '../../utils/logger';
import type { TerminalService } from '../../services/terminal/terminalService';
import type { TerminalSettings } from '../../settings/settings';
import {
  AgentTerminalThreadController,
  type TerminalThreadSnapshot,
} from './agentTerminalThreadController';
import { renderAgentBrandIcon } from './agentBrandIcon';
import { RenameTerminalModal } from '../terminal/renameTerminalModal';

export const AGENT_OUTPUT_VIEW_TYPE = 'termy-agent-output-view';
const AGENT_OUTPUT_ICON = 'sparkles';
const SESSION_LIST_REFRESH_INTERVAL_MS = 30_000;
const TERMINAL_PROVIDER_ID = 'terminal';

export interface AgentOutputViewOptions {
  /** Bus the view subscribes to. */
  bus: AgentEventBus;
  /** Settings accessor for dynamic agent configuration. */
  settings: SettingsAccessor;
  /** Agent lifecycle manager. */
  agentManager: AgentManager;
  /** Permission queue for pending-count indicator. */
  permissionQueue: PermissionQueue;
  /** Returns Termy's imported ACP thread history store. */
  getImportedHistoryService?: () => ImportedAgentThreadHistoryService | null;
  /** Returns the agent context bridge. */
  getAgentContextBridge?: () => AgentContextBridge | null;
  /** Returns the terminal service used for terminal threads. */
  getTerminalService?: () => Promise<TerminalService>;
  /** Returns live plugin settings used for terminal appearance refreshes. */
  getSettings?: () => TerminalSettings;
  /** Factory hook for renderers (tests). */
  rendererFactory?: (view: AgentOutputView) => AgentSnapshotRenderer;
}

interface ProviderState {
  sessions: Array<ProviderSession>;
  loading: boolean;
  error: string | null;
  activeSessionId: string | null;
}

type ProviderSession =
  | ImportedAgentThreadListItem
  | TerminalThreadSnapshot
  | LiveAgentSession;

export class AgentOutputView extends ItemView {
  private readonly bus: AgentEventBus;
  private readonly settings: SettingsAccessor;
  private readonly agentManager: AgentManager;
  private readonly permissionQueue: PermissionQueue;
  private readonly model = new AgentSessionModel();
  private readonly rendererFactory: (view: AgentOutputView) => AgentSnapshotRenderer;
  private readonly getImportedHistoryService?: () => ImportedAgentThreadHistoryService | null;
  private readonly getAgentContextBridge?: () => AgentContextBridge | null;
  private readonly terminalThreads: AgentTerminalThreadController | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeModel: (() => void) | null = null;
  private unsubscribeAgentsChange: (() => void) | null = null;

  private headerTitleEl: HTMLElement | null = null;
  private headerSubtitleEl: HTMLElement | null = null;
  private headerStatusEl: HTMLElement | null = null;
  private providerTabsEl: HTMLElement | null = null;
  private sessionsHeaderEl: HTMLElement | null = null;
  private sessionsListEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private inputTextareaEl: HTMLTextAreaElement | null = null;
  private inputSendBtnEl: HTMLButtonElement | null = null;
  private inputCancelBtnEl: HTMLButtonElement | null = null;

  private renderHandle: number | null = null;
  private focusedSessionId: AgentSessionId | null = null;
  private renderToken = 0;
  private sessionsRefreshTimer: number | null = null;

  // Data-driven state (Req 6 AC 1 / Property 6.1).
  private selectedAgentId: string | null = null;
  private readonly providerState: Map<string, ProviderState> = new Map();
  private readonly loadedHistorySessions = new Set<AgentSessionId>();

  constructor(leaf: WorkspaceLeaf, options: AgentOutputViewOptions) {
    super(leaf);
    this.bus = options.bus;
    this.settings = options.settings;
    this.agentManager = options.agentManager;
    this.permissionQueue = options.permissionQueue;
    this.rendererFactory = options.rendererFactory ?? ((view) => createAgentSnapshotRenderer(view.app));
    this.getImportedHistoryService = options.getImportedHistoryService;
    this.getAgentContextBridge = options.getAgentContextBridge;
    if (options.getTerminalService) {
      if (!options.getSettings) {
        throw new Error('Terminal thread settings dependency is required');
      }
      this.terminalThreads = new AgentTerminalThreadController({
        getTerminalService: options.getTerminalService,
        getSettings: options.getSettings,
        onChanged: () => this.handleTerminalThreadsChanged(),
      });
    }
    const enabled = this.getProviderTabs();
    this.selectedAgentId = enabled[0]?.id ?? null;
  }

  getViewType(): string { return AGENT_OUTPUT_VIEW_TYPE; }
  getDisplayText(): string { return t('agent.viewTitle'); }
  getIcon(): string { return AGENT_OUTPUT_ICON; }

  protected onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('termy-agent-view');
    this.renderShell(contentEl);
    this.model.resetAll();
    this.focusedSessionId = null;
    this.providerState.clear();

    this.unsubscribeModel = this.model.subscribe(() => this.scheduleRender());
    this.unsubscribeBus = this.bus.subscribe((envelope) => {
      try { this.model.apply(envelope); }
      catch (error) { errorLog('[AgentOutputView] Failed to apply envelope:', error); }
    });
    this.unsubscribeAgentsChange = this.settings.onAgentsChange(() => this.handleAgentsChange());
    this.refreshActiveAgentSessions();
    this.sessionsRefreshTimer = window.setInterval(() => this.refreshActiveAgentSessions(), SESSION_LIST_REFRESH_INTERVAL_MS);
    this.scheduleRender();
    return Promise.resolve();
  }

  protected async onClose(): Promise<void> {
    if (this.renderHandle !== null) { window.cancelAnimationFrame?.(this.renderHandle); this.renderHandle = null; }
    if (this.unsubscribeBus) { this.unsubscribeBus(); this.unsubscribeBus = null; }
    if (this.unsubscribeModel) { this.unsubscribeModel(); this.unsubscribeModel = null; }
    if (this.unsubscribeAgentsChange) { this.unsubscribeAgentsChange(); this.unsubscribeAgentsChange = null; }
    if (this.sessionsRefreshTimer !== null) { window.clearInterval(this.sessionsRefreshTimer); this.sessionsRefreshTimer = null; }
    await this.terminalThreads?.dispose();
    this.contentEl.empty();
  }

  clear(): void {
    this.model.resetAll();
    this.focusedSessionId = null;
    this.providerState.clear();
    this.loadedHistorySessions.clear();
    this.scheduleRender();
  }

  refresh(): void { this.scheduleRender(); }

  /* ── Shell layout ─────────────────────────────────────────────── */

  private renderShell(root: HTMLElement): void {
    const header = root.createDiv({ cls: 'termy-agent-header' });
    const titleGroup = header.createDiv({ cls: 'termy-agent-header-title-group' });
    const iconEl = titleGroup.createDiv({ cls: 'termy-agent-header-icon' });
    setIcon(iconEl, AGENT_OUTPUT_ICON);
    const titleStack = titleGroup.createDiv({ cls: 'termy-agent-header-title-stack' });
    this.headerTitleEl = titleStack.createDiv({ cls: 'termy-agent-header-title', text: t('agent.headerIdle') });
    this.headerSubtitleEl = titleStack.createDiv({ cls: 'termy-agent-header-subtitle', text: t('agent.headerSubtitleIdle') });
    this.headerStatusEl = header.createDiv({ cls: 'termy-agent-header-status' });

    const actions = header.createDiv({ cls: 'termy-agent-header-actions' });
    const clearBtn = actions.createEl('button', { cls: 'clickable-icon termy-agent-header-action', attr: { type: 'button' } });
    setIcon(clearBtn, 'eraser');
    setTooltip(clearBtn, t('agent.clearTooltip'));
    clearBtn.addEventListener('click', () => this.handleClearAction());
    const menuBtn = actions.createEl('button', { cls: 'clickable-icon termy-agent-header-action', attr: { type: 'button' } });
    setIcon(menuBtn, 'more-vertical');
    setTooltip(menuBtn, t('agent.moreActions'));
    menuBtn.addEventListener('click', (event) => this.showHeaderMenu(event));

    this.bannerEl = root.createDiv({ cls: 'termy-agent-banner is-hidden' });
    this.providerTabsEl = root.createDiv({ cls: 'termy-agent-provider-tabs' });
    this.doRenderTabs();

    const layout = root.createDiv({ cls: 'termy-agent-layout' });
    const sidebar = layout.createDiv({ cls: 'termy-agent-sidebar' });
    this.sessionsHeaderEl = sidebar.createDiv({ cls: 'termy-agent-sidebar-header' });
    this.renderSessionsHeader();
    this.sessionsListEl = sidebar.createDiv({ cls: 'termy-agent-sessions-list' });

    const main = layout.createDiv({ cls: 'termy-agent-main' });
    const body = main.createDiv({ cls: 'termy-agent-body' });
    this.bodyEl = body;
    this.emptyStateEl = body.createDiv({ cls: 'termy-agent-empty' });
    this.emptyStateEl.createDiv({ cls: 'termy-agent-empty-title', text: t('agent.emptyTitle') });
    this.emptyStateEl.createDiv({ cls: 'termy-agent-empty-body', text: t('agent.emptyBody') });

    const { inputBarEl: _bar, inputTextareaEl, inputSendBtnEl, inputCancelBtnEl } = renderInputBar(main, {
      onSubmit: (text) => { void this.handleSubmit(text); },
      onCancel: () => { this.handleCancel(); },
    });
    void _bar;
    this.inputTextareaEl = inputTextareaEl;
    this.inputSendBtnEl = inputSendBtnEl;
    this.inputCancelBtnEl = inputCancelBtnEl;
    this.renderSessionsList();
  }

  /* ── Tab rendering (delegates to sub-module) ─────────────────── */

  private doRenderTabs(): void {
    if (!this.providerTabsEl) return;
    const enabledAgents = this.getProviderTabs();
    const ctx: TabRenderContext = {
      providerTabsEl: this.providerTabsEl,
      headerStatusEl: this.headerStatusEl,
      selectedAgentId: this.selectedAgentId,
      agentManager: this.agentManager,
      permissionQueue: this.permissionQueue,
      getActiveSnapshot: () => this.getActiveSnapshot(),
      onTabClick: (id) => this.switchAgent(id),
      onOpenSettings: () => {
        const appWithSetting = this.app as { setting?: { open?: () => void } };
        appWithSetting.setting?.open?.();
      },
    };
    renderProviderTabs(enabledAgents, ctx);
  }

  /* ── Agent config change handling (Property 6.2) ─────────────── */

  private handleAgentsChange(): void {
    const enabledAgents = this.getProviderTabs();
    const stillExists = enabledAgents.some((a) => a.id === this.selectedAgentId);
    if (!stillExists) {
      this.showBanner(t('agent.agentRemoved'));
      this.selectedAgentId = enabledAgents[0]?.id ?? null;
    }
    this.doRenderTabs();
    this.renderSessionsHeader();
    this.renderSessionsList();
    this.scheduleRender();
  }

  private showBanner(message: string): void {
    if (!this.bannerEl) return;
    this.bannerEl.empty();
    this.bannerEl.removeClass('is-hidden');
    this.bannerEl.createDiv({ cls: 'termy-agent-banner-text', text: message });
    window.setTimeout(() => { this.bannerEl?.addClass('is-hidden'); }, 5000);
  }

  private switchAgent(agentId: string): void {
    if (this.selectedAgentId === agentId) return;
    this.selectedAgentId = agentId;
    this.doRenderTabs();
    this.renderSessionsHeader();
    this.renderSessionsList();
    this.refocusActiveSession();
    if (!this.isTerminalProviderSelected()) {
      this.terminalThreads?.detach();
    }
    this.scheduleRender();
    this.refreshActiveAgentSessions();
  }

  /* ── Submit handling ──────────────────────────────────────────── */

  private async handleSubmit(text: string): Promise<void> {
    try {
      if (!this.selectedAgentId) {
        throw new Error('No agent provider selected');
      }
      if (this.isTerminalProviderSelected()) {
        this.submitTerminalInput(text);
        return;
      }
      const snapshot = this.getAgentContextBridge?.()?.getCurrentSnapshot() ?? null;
      const state = this.getProviderState(this.selectedAgentId);
      const isFirstMessage = !state?.activeSessionId;
      const { enrichedPrompt, displayText } = enrichPromptWithContext(text, snapshot, {
        includeCurrentNote: isFirstMessage,
        includeSelection: !!snapshot?.selection && !snapshot.selection.isEmpty,
      });

      const agentId = this.selectedAgentId;

      let sessionId = state?.activeSessionId;
      if (!sessionId) {
        const vaultRoot = this.getVaultRoot();
        this.setProviderLoading(agentId, true);
        try {
          sessionId = await this.agentManager.newSession(agentId, { cwd: vaultRoot });
          this.addLiveAgentSession(agentId, sessionId);
        } finally {
          this.setProviderLoading(agentId, false);
        }
      }

      const internalId = sessionIdFor(agentId, sessionId);
      this.focusedSessionId = internalId;
      this.scheduleRender();
      this.updateInputDisabledState(true);

      try {
        if (this.loadedHistorySessions.has(internalId)) {
          const cwd = this.getAgentSessionCwd(agentId, sessionId);
          await this.agentManager.loadSessionAndSendPrompt(agentId, sessionId, {
            cwd,
            prompt: { enrichedPrompt, displayText },
          });
          this.loadedHistorySessions.delete(internalId);
          return;
        }
        await this.agentManager.sendPrompt(agentId, sessionId, { enrichedPrompt, displayText });
      } finally {
        this.updateInputDisabledState(false);
      }
    } catch (error) {
      errorLog('[AgentOutputView] Failed to submit prompt:', error);
      new Notice(t('agent.noticeSubmitFailed'));
      this.updateInputDisabledState(false);
    }
  }

  /* ── Cancel handling (Req 6 AC 6) ────────────────────────────── */

  private handleCancel(): void {
    if (this.isTerminalProviderSelected()) {
      const terminal = this.requireTerminalThreads().getActiveTerminal();
      if (!terminal) {
        throw new Error('Active terminal thread is unavailable');
      }
      terminal.write('\x03');
      return;
    }
    if (!this.selectedAgentId) {
      throw new Error('No agent provider selected');
    }
    const state = this.getProviderState(this.selectedAgentId);
    const sessionId = state?.activeSessionId;
    if (sessionId) {
      this.agentManager.cancel(this.selectedAgentId, sessionId);
    }
    // Re-enable send button.
    this.updateInputDisabledState(false);
  }

  /* ── New session handling (Req 6 AC 4) ───────────────────────── */

  private async handleNewSession(): Promise<void> {
    if (this.isTerminalProviderSelected()) {
      await this.createTerminalThread();
      return;
    }

    const agentId = this.selectedAgentId;
    if (!agentId) {
      new Notice(t('agent.noticeSubmitFailed'));
      return;
    }
    const state = this.ensureProviderState(agentId);
    state.activeSessionId = null;
    this.focusedSessionId = null;
    if (this.inputTextareaEl) {
      this.inputTextareaEl.value = '';
    }
    this.scheduleRender();
    this.renderSessionsList();
  }

  /* ── Restart handling (Req 9 AC 3) ───────────────────────────── */

  private async handleRestart(): Promise<void> {
    if (!this.selectedAgentId) return;
    try {
      // Preserve old transcript — just re-start the agent.
      await this.agentManager.ensureStarted(this.selectedAgentId);
      this.scheduleRender();
    } catch (error) {
      errorLog('[AgentOutputView] Failed to restart agent:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  /* ── Input disabled state (Property 6.3) ─────────────────────── */

  private updateInputDisabledState(forceRunning?: boolean): void {
    if (this.isTerminalProviderSelected()) {
      const hasTerminal = !!this.terminalThreads?.getActiveTerminal();
      if (this.inputSendBtnEl) {
        this.inputSendBtnEl.disabled = !hasTerminal;
        this.inputSendBtnEl.toggleClass('is-disabled', !hasTerminal);
      }
      if (this.inputTextareaEl) {
        this.inputTextareaEl.disabled = !hasTerminal;
        this.inputTextareaEl.placeholder = t('agent.terminalInputPlaceholder');
      }
      if (this.inputCancelBtnEl) {
        this.inputCancelBtnEl.toggleClass('is-hidden', !hasTerminal);
      }
      return;
    }

    const isRunning = forceRunning ?? this.isSessionRunning();
    const pendingPermission = this.permissionQueue.pendingCount();
    const disabled = isRunning || pendingPermission > 0;

    if (this.inputSendBtnEl) {
      this.inputSendBtnEl.disabled = disabled;
      this.inputSendBtnEl.toggleClass('is-disabled', disabled);
    }
    if (this.inputTextareaEl) {
      this.inputTextareaEl.disabled = disabled;
      this.inputTextareaEl.placeholder = t('agent.inputPlaceholder');
    }
    // Cancel button is only useful when running.
    if (this.inputCancelBtnEl) {
      this.inputCancelBtnEl.toggleClass('is-hidden', !isRunning);
    }
  }

  private isSessionRunning(): boolean {
    const snapshot = this.getActiveSnapshot();
    return snapshot?.state === 'running';
  }

  private getVaultRoot(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    if (adapter && typeof adapter.getBasePath === 'function') {
      return adapter.getBasePath();
    }
    throw new Error('Vault adapter does not expose getBasePath');
  }

  /* ── Session refresh ─────────────────────────────────────────── */

  private refreshActiveAgentSessions(): void {
    const providerIds = new Set(this.getProviderTabs().map((provider) => provider.id));
    if (providerIds.has(TERMINAL_PROVIDER_ID)) {
      this.refreshTerminalThreads();
    }
    for (const providerId of providerIds) {
      if (providerId === TERMINAL_PROVIDER_ID) continue;
      this.refreshImportedProviderSessions(providerId);
    }
  }

  /* ── Session loading ─────────────────────────────────────────── */

  private loadProviderThreadSession(providerId: string, threadId: string): void {
    const internalId = this.activateHistorySession(providerId, threadId);
    this.model.reset(internalId);
    this.scheduleRender();
    this.renderSessionsList();
    this.setBusyHint(t('agent.transcriptLoading'));
    try {
      const events = this.loadLocalTranscript(providerId, threadId);
      this.model.applyEventsBatch(internalId, events);
      this.loadedHistorySessions.add(internalId);
      this.scheduleRender();
    } catch (error) {
      errorLog(`[AgentOutputView] ${providerId} loadTranscript failed:`, error);
      throw error;
    } finally {
      this.setBusyHint(null);
    }
  }

  private refreshImportedProviderSessions(providerId: string): void {
    const service = this.getImportedHistoryService?.() ?? null;
    const state = this.ensureProviderState(providerId);
    if (!service) {
      state.error = t('agent.sessionsProviderUnavailable');
      state.loading = false;
      this.renderSessionsList();
      return;
    }
    try {
      state.sessions = mergeLiveAgentSessions(state.sessions, service.listThreads(providerId));
      state.error = null;
    } catch (error) {
      state.error = this.formatLoadFailure(error);
    } finally {
      state.loading = false;
      this.renderSessionsList();
    }
  }

  private loadLocalTranscript(
    providerId: string,
    threadId: string,
  ): AgentEvent[] {
    const imported = this.getImportedHistoryService?.() ?? null;
    if (!imported) {
      throw new Error(t('agent.sessionsProviderUnavailable'));
    }
    return imported.loadThread(providerId, threadId);
  }

  private async importProviderThreads(providerId: string): Promise<void> {
    const history = this.getImportedHistoryService?.() ?? null;
    if (!history) {
      throw new Error(t('agent.sessionsProviderUnavailable'));
    }
    const state = this.ensureProviderState(providerId);
    const wasStarted = this.agentManager.isStarted(providerId);
    state.loading = true;
    state.error = null;
    this.renderSessionsList();
    try {
      const sessions = await this.agentManager.listSessions(providerId, {});
      for (const session of sessions) {
        const cwd = requireAcpSessionCwd(session);
        const events = await this.agentManager.importSessionTranscript(providerId, session.sessionId, { cwd });
        history.saveThread(providerId, importedThreadFromAcpSession({ ...session, cwd }, events));
      }
      state.sessions = mergeLiveAgentSessions(state.sessions, history.listThreads(providerId));
      state.error = null;
      new Notice(t('agent.threadsImported', { count: sessions.length }));
    } catch (error) {
      state.error = this.formatLoadFailure(error);
      throw error;
    } finally {
      state.loading = false;
      if (!wasStarted) {
        await this.agentManager.stopIfIdle(providerId);
      }
      this.renderSessionsList();
    }
  }

  /* ── Sessions list + sidebar ─────────────────────────────────── */

  private renderSessionsHeader(): void {
    if (!this.sessionsHeaderEl) return;
    this.sessionsHeaderEl.empty();
    this.sessionsHeaderEl.createDiv({
      cls: 'termy-agent-sidebar-title',
      text: t('agent.threadsHeading'),
    });
    const actions = this.sessionsHeaderEl.createDiv({ cls: 'termy-agent-sidebar-actions' });
    const refreshBtn = actions.createEl('button', { cls: 'clickable-icon termy-agent-sidebar-action', attr: { type: 'button' } });
    setIcon(refreshBtn, 'refresh-cw');
    setTooltip(refreshBtn, t('agent.threadsRefresh'));
    refreshBtn.addEventListener('click', () => this.refreshActiveAgentSessions());
    if (!this.isTerminalProviderSelected()) {
      const importBtn = actions.createEl('button', {
        cls: 'clickable-icon termy-agent-sidebar-action',
        attr: { type: 'button' },
      });
      setIcon(importBtn, 'download');
      setTooltip(importBtn, t('agent.threadsImport'));
      importBtn.addEventListener('click', () => {
        const providerId = this.selectedAgentId;
        if (!providerId || providerId === TERMINAL_PROVIDER_ID) return;
        void this.importProviderThreads(providerId)
          .catch((error) => new Notice(this.formatLoadFailure(error)));
      });
    }
    const newBtn = actions.createEl('button', { cls: 'clickable-icon termy-agent-sidebar-action', attr: { type: 'button' } });
    setIcon(newBtn, 'plus');
    setTooltip(newBtn, t('agent.threadsNew'));
    newBtn.addEventListener('click', () => { void this.handleNewSession(); });
  }

  private renderSessionsList(): void {
    if (!this.sessionsListEl) return;
    this.sessionsListEl.empty();
    const states = this.getThreadPoolStates();
    const items = this.getThreadPoolItems();
    const loading = states.some((state) => state.loading);
    const errors = states.flatMap((state) => state.error ? [state.error] : []);

    if (items.length === 0 && loading) {
      this.sessionsListEl.createDiv({ cls: 'termy-agent-sidebar-status', text: t('agent.sessionsLoading') });
      return;
    }

    if (items.length === 0 && errors.length > 0) {
      this.renderThreadPoolErrors(errors);
      return;
    }

    if (loading) {
      this.sessionsListEl.createDiv({ cls: 'termy-agent-sidebar-status', text: t('agent.sessionsLoading') });
    }
    if (errors.length > 0) {
      this.renderThreadPoolErrors(errors);
    }
    if (items.length === 0) {
      this.sessionsListEl.createDiv({ cls: 'termy-agent-sidebar-status', text: t('agent.threadsEmpty') });
      return;
    }

    for (const item of items) {
      this.renderThreadPoolItem(item);
    }
  }

  private renderThreadPoolErrors(errors: readonly string[]): void {
    for (const error of errors) {
      this.sessionsListEl?.createDiv({ cls: 'termy-agent-sidebar-status is-error', text: error });
    }
  }

  private renderThreadPoolItem(thread: ThreadPoolItem): void {
    if (!this.sessionsListEl) return;
    const item = this.sessionsListEl.createDiv({ cls: 'termy-agent-session-item' });
    if (thread.active) item.addClass('is-active');

    const itemHeader = item.createDiv({ cls: 'termy-agent-session-title-row' });
    this.renderThreadPoolIcon(itemHeader, thread);
    const textStack = itemHeader.createDiv({ cls: 'termy-agent-session-text-stack' });
    textStack.createDiv({ cls: 'termy-agent-session-title', text: thread.title });
    textStack.createDiv({ cls: 'termy-agent-session-meta', text: this.threadMetaLabel(thread) });

    const actionBtn = itemHeader.createEl('button', {
      cls: 'clickable-icon termy-agent-session-action',
      attr: { type: 'button', 'aria-label': t('agent.threadActions') },
    });
    setIcon(actionBtn, 'more-horizontal');
    setTooltip(actionBtn, t('agent.threadActions'));
    actionBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.showThreadMenu(event, thread);
    });

    item.addEventListener('click', () => this.handleThreadClick(thread));
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showThreadMenu(event, thread);
    });
  }

  private renderThreadPoolIcon(container: HTMLElement, thread: ThreadPoolItem): void {
    const iconEl = container.createDiv({ cls: 'termy-agent-session-provider-icon' });
    if (!thread.providerIcon) return;
    renderThreadPoolProviderIcon(iconEl, thread.providerIcon);
  }

  private threadMetaLabel(thread: ThreadPoolItem): string {
    const parts = [
      thread.providerLabel,
      formatRelativeTime(thread.updatedAt, Date.now()),
    ];
    if (thread.live) {
      parts.push(t('agent.threadLiveBadge'));
    }
    return parts.join(' \u00b7 ');
  }

  private handleThreadClick(thread: ThreadPoolItem): void {
    this.selectThreadProvider(thread.providerId);
    if (thread.providerId === TERMINAL_PROVIDER_ID) {
      this.requireTerminalThreads().setActiveThread(thread.threadId);
      this.refreshTerminalThreads();
      this.scheduleRender();
    } else if (this.focusLiveAgentSession(thread.providerId, thread.threadId)) {
      return;
    } else {
      try {
        this.loadProviderThreadSession(thread.providerId, thread.threadId);
      } catch (error) {
        new Notice(this.formatLoadFailure(error));
      }
    }
  }

  /* ── Render cycle ────────────────────────────────────────────── */

  private scheduleRender(): void {
    if (this.renderHandle !== null) return;
    this.renderHandle = window.requestAnimationFrame(() => {
      this.renderHandle = null;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (!this.bodyEl) return;
    if (this.isTerminalProviderSelected()) {
      this.renderTerminalThreadBody();
      return;
    }
    this.bodyEl.removeClass('is-terminal-thread');
    const snapshot = this.getActiveSnapshot();
    this.updateHeader(snapshot);
    if (this.providerTabsEl) {
      const ctx: TabRenderContext = {
        providerTabsEl: this.providerTabsEl,
        headerStatusEl: this.headerStatusEl,
        selectedAgentId: this.selectedAgentId,
        agentManager: this.agentManager,
        permissionQueue: this.permissionQueue,
        getActiveSnapshot: () => this.getActiveSnapshot(),
        onTabClick: (id) => this.switchAgent(id),
        onOpenSettings: () => {
          const a = this.app as { setting?: { open?: () => void } };
          a.setting?.open?.();
        },
      };
      renderStatusIndicator(ctx);
    }

    if (!snapshot || snapshot.blocks.length === 0) {
      this.bodyEl.empty();
      this.emptyStateEl = this.bodyEl.createDiv({ cls: 'termy-agent-empty' });
      this.emptyStateEl.createDiv({ cls: 'termy-agent-empty-title', text: t('agent.emptyTitle') });
      this.emptyStateEl.createDiv({ cls: 'termy-agent-empty-body', text: t('agent.emptyBody') });
      this.updateInputDisabledState();
      return;
    }

    this.emptyStateEl = null;
    this.bodyEl.empty();
    const transcriptEl = this.bodyEl.createDiv({ cls: 'termy-agent-transcript' });
    const renderer = this.rendererFactory(this);
    const token = ++this.renderToken;
    const renderTarget = (snap: AgentSessionSnapshot, target: HTMLElement, owner: Component): void => {
      if (token !== this.renderToken) return;
      void renderAgentSnapshot(snap, target, owner, renderer);
    };
    renderTarget(snapshot, transcriptEl, this);
    // Restart button when session is errored (Req 9 AC 3).
    if (snapshot.state === 'errored' && this.agentManager) {
      const restartBar = this.bodyEl.createDiv({ cls: 'termy-agent-restart-bar' });
      const restartBtn = restartBar.createEl('button', {
        cls: 'mod-warning termy-agent-restart-btn',
        text: t('agent.restartButton'),
        attr: { type: 'button' },
      });
      restartBtn.addEventListener('click', () => { void this.handleRestart(); });
    }
    if (this.isScrolledToBottom(this.bodyEl)) {
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    }
    // Update input disabled state on each render (Property 6.3).
    this.updateInputDisabledState();
  }

  private updateHeader(snapshot: AgentSessionSnapshot | null): void {
    if (!this.headerTitleEl || !this.headerSubtitleEl) return;
    if (this.isTerminalProviderSelected()) {
      this.headerTitleEl.setText(this.terminalThreads?.getActiveTitle() ?? t('agent.terminalProvider'));
      this.headerSubtitleEl.setText(
        this.terminalThreads?.hasThreads()
          ? t('agent.terminalThreadSubtitle')
          : t('agent.terminalThreadSubtitleEmpty'),
      );
      return;
    }
    if (!snapshot) {
      this.headerTitleEl.setText(t('agent.headerIdle'));
      this.headerSubtitleEl.setText(t('agent.headerSubtitleIdle'));
      return;
    }
    this.headerTitleEl.setText(this.headerTitleFor(snapshot));
    this.headerSubtitleEl.setText(snapshot.detail ?? this.describeState(snapshot.state));
  }

  private headerTitleFor(snapshot: AgentSessionSnapshot): string {
    const sid = snapshot.sessionId;
    const colonIndex = sid.indexOf(':');
    if (colonIndex === -1) return sid;
    const providerKey = sid.slice(0, colonIndex);
    const externalId = sid.slice(colonIndex + 1);
    const state = this.getProviderState(providerKey);
    const match = state?.sessions.find((s) => s.id === externalId);
    const meta = this.settings.getAgentThreadMeta(providerKey, externalId);
    if (meta?.title && meta.title.length > 0) return meta.title;
    if (match?.title && match.title.length > 0) return match.title;
    return this.settings.getAgent(providerKey)?.label ?? sid;
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

  /* ── Helpers ─────────────────────────────────────────────────── */

  private getActiveSnapshot(): AgentSessionSnapshot | null {
    if (!this.focusedSessionId) return null;
    return this.model.getSnapshot(this.focusedSessionId);
  }

  private isScrolledToBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }

  private refocusActiveSession(): void {
    if (this.isTerminalProviderSelected()) {
      this.focusedSessionId = null;
      return;
    }
    const state = this.getProviderState(this.selectedAgentId);
    if (state?.activeSessionId && this.selectedAgentId) {
      this.focusedSessionId = sessionIdFor(this.selectedAgentId, state.activeSessionId);
    } else {
      this.focusedSessionId = null;
    }
  }

  private setBusyHint(text: string | null): void {
    if (!this.bodyEl) return;
    let hintEl = this.bodyEl.querySelector<HTMLElement>('.termy-agent-busy-hint');
    if (text === null) { if (hintEl) hintEl.remove(); return; }
    if (!hintEl) hintEl = this.bodyEl.createDiv({ cls: 'termy-agent-busy-hint' });
    hintEl.setText(text);
  }

  private formatLoadFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return t('agent.sessionsLoadFailed', { message });
  }

  private showHeaderMenu(event: MouseEvent): void {
    const menu = new Menu();
    if (this.isTerminalProviderSelected()) {
      menu.addItem((item) => {
        item.setTitle(t('agent.terminalThreadsNewThread'));
        item.setIcon('terminal');
        item.onClick(() => { void this.createTerminalThread(); });
      });
      menu.addItem((item) => {
        item.setTitle(t('agent.terminalThreadsClose'));
        item.setIcon('x');
        item.onClick(() => {
          const activeId = this.requireTerminalThreads().getActiveThreadId();
          if (activeId) void this.requireTerminalThreads().closeThread(activeId);
        });
      });
    } else {
      menu.addItem((item) => { item.setTitle(t('agent.menuClear')); item.setIcon('eraser'); item.onClick(() => this.clear()); });
      menu.addItem((item) => { item.setTitle(t('agent.menuCopyTranscript')); item.setIcon('clipboard-copy'); item.onClick(() => { void this.copyTranscriptToClipboard(); }); });
    }
    menu.showAtMouseEvent(event);
  }

  private showThreadMenu(event: MouseEvent, thread: ThreadPoolItem): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(t('agent.threadRename'));
      item.setIcon('pencil');
      item.onClick(() => this.openRenameThreadModal(thread));
    });
    menu.addItem((item) => {
      item.setTitle(t('agent.threadArchive'));
      item.setIcon('archive');
      item.onClick(() => { void this.archiveThread(thread); });
    });
    menu.showAtMouseEvent(event);
  }

  private openRenameThreadModal(thread: ThreadPoolItem): void {
    new RenameTerminalModal(
      this.app,
      thread.title,
      (title) => { void this.renameThread(thread, title); },
      {
        title: t('agent.threadRenameTitle'),
        placeholder: t('agent.threadRenamePlaceholder'),
      },
    ).open();
  }

  private async renameThread(thread: ThreadPoolItem, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      if (thread.providerId === TERMINAL_PROVIDER_ID) {
        this.requireTerminalThreads().renameThread(thread.threadId, trimmed);
      }
      await this.writeRenamedThreadMeta(thread, trimmed);
      this.renderSessionsList();
      this.scheduleRender();
      new Notice(t('agent.threadRenamed'));
    } catch (error) {
      errorLog('[AgentOutputView] Failed to rename thread:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  private async archiveThread(thread: ThreadPoolItem): Promise<void> {
    try {
      await this.writeArchivedThreadMeta(thread);
      if (thread.providerId === TERMINAL_PROVIDER_ID) {
        await this.requireTerminalThreads().closeThread(thread.threadId);
      } else {
        this.clearArchivedAgentSelection(thread);
      }
      this.renderSessionsList();
      this.scheduleRender();
      new Notice(t('agent.threadArchived'));
    } catch (error) {
      errorLog('[AgentOutputView] Failed to archive thread:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  private clearArchivedAgentSelection(thread: ThreadPoolItem): void {
    this.loadedHistorySessions.delete(sessionIdFor(thread.providerId, thread.threadId));
    const state = this.getProviderState(thread.providerId);
    if (state?.activeSessionId !== thread.threadId) return;
    state.activeSessionId = null;
    if (this.selectedAgentId === thread.providerId) {
      this.focusedSessionId = null;
    }
  }

  private async writeRenamedThreadMeta(thread: ThreadPoolItem, title: string): Promise<void> {
    if (!this.settings) {
      throw new Error('Settings accessor is unavailable');
    }
    await this.settings.upsertAgentThreadMeta({
      providerId: thread.providerId,
      threadId: thread.threadId,
      title,
      archived: false,
      updatedAt: Date.now(),
    });
  }

  private async writeArchivedThreadMeta(thread: ThreadPoolItem): Promise<void> {
    if (!this.settings) {
      throw new Error('Settings accessor is unavailable');
    }
    const previous = this.settings.getAgentThreadMeta(thread.providerId, thread.threadId);
    await this.settings.upsertAgentThreadMeta({
      providerId: thread.providerId,
      threadId: thread.threadId,
      title: previous?.title,
      archived: true,
      updatedAt: Date.now(),
    });
  }

  private addLiveAgentSession(agentId: string, sessionId: string): void {
    const state = this.ensureProviderState(agentId);
    const internalId = sessionIdFor(agentId, sessionId);
    state.sessions = upsertLiveAgentSession(state.sessions, {
      id: sessionId,
      title: this.settings.getAgent(agentId)?.label ?? agentId,
      updatedAt: Date.now(),
      live: true,
    });
    state.activeSessionId = sessionId;
    this.focusedSessionId = internalId;
    this.loadedHistorySessions.delete(internalId);
  }

  private activateHistorySession(agentId: string, sessionId: string): AgentSessionId {
    const state = this.ensureProviderState(agentId);
    state.activeSessionId = sessionId;
    this.focusedSessionId = sessionIdFor(agentId, sessionId);
    return this.focusedSessionId;
  }

  private getAgentSessionCwd(agentId: string, sessionId: string): string {
    const state = this.ensureProviderState(agentId);
    return requireSessionCwd(state.sessions, sessionId);
  }

  private setProviderLoading(agentId: string, loading: boolean): void {
    const state = this.ensureProviderState(agentId);
    state.loading = loading;
    if (loading) state.error = null;
    this.renderSessionsList();
  }

  private focusLiveAgentSession(agentId: string, sessionId: string): boolean {
    const state = this.getProviderState(agentId);
    if (!state) return false;
    const session = state?.sessions.find((item) => item.id === sessionId);
    if (!session || !isLiveAgentSession(session)) return false;
    state.activeSessionId = sessionId;
    this.focusedSessionId = sessionIdFor(agentId, sessionId);
    this.loadedHistorySessions.delete(this.focusedSessionId);
    this.scheduleRender();
    this.renderSessionsList();
    return true;
  }

  private async copyTranscriptToClipboard(): Promise<void> {
    const snapshot = this.getActiveSnapshot();
    if (!snapshot) { new Notice(t('agent.noticeNothingToCopy')); return; }
    const text = serializeSnapshotToMarkdown(snapshot);
    try { await navigator.clipboard.writeText(text); new Notice(t('agent.noticeTranscriptCopied')); }
    catch { new Notice(t('agent.noticeCopyFailed')); }
  }

  private getProviderState(agentId: string | null): ProviderState | undefined {
    if (!agentId) return undefined;
    return this.providerState.get(agentId);
  }

  private ensureProviderState(agentId: string): ProviderState {
    let state = this.providerState.get(agentId);
    if (!state) {
      state = { sessions: [], loading: false, error: null, activeSessionId: null };
      this.providerState.set(agentId, state);
    }
    return state;
  }

  private getThreadPoolStates(): ProviderState[] {
    const states: ProviderState[] = [];
    for (const provider of this.getProviderTabs()) {
      const state = this.getProviderState(provider.id);
      if (state) states.push(state);
    }
    return states;
  }

  private getThreadPoolItems(): ThreadPoolItem[] {
    const providers: ProviderThreadSource[] = [];
    for (const provider of this.getProviderTabs()) {
      const state = this.getProviderState(provider.id);
      if (!state) continue;
      providers.push({
        providerId: provider.id,
        providerLabel: provider.label,
        providerIcon: getProviderIconConfig(provider),
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        live: provider.id === TERMINAL_PROVIDER_ID,
      });
    }
    return buildThreadPoolItems({
      providers,
      selectedProviderId: this.selectedAgentId,
      getMeta: (providerId, threadId) => this.settings.getAgentThreadMeta(providerId, threadId),
      untitledTitle: t('agent.sessionItemUntitled'),
    });
  }

  private selectThreadProvider(providerId: string): void {
    if (this.selectedAgentId === providerId) return;
    this.selectedAgentId = providerId;
    this.doRenderTabs();
    this.renderSessionsHeader();
    if (providerId === TERMINAL_PROVIDER_ID) {
      this.focusedSessionId = null;
    } else {
      this.terminalThreads?.detach();
    }
    this.updateInputDisabledState();
  }

  private getProviderTabs(): ProviderTabConfig[] {
    const agents = this.settings.getEnabledAgents();
    return buildProviderTabs({
      enabledAgents: agents,
      terminalProvider: this.terminalThreads
      ? {
        id: TERMINAL_PROVIDER_ID,
        label: t('agent.terminalProvider'),
        icon: 'terminal',
        iconKind: 'lucide',
      }
      : null,
    });
  }

  private isTerminalProviderSelected(): boolean {
    return this.selectedAgentId === TERMINAL_PROVIDER_ID;
  }

  private requireTerminalThreads(): AgentTerminalThreadController {
    if (!this.terminalThreads) {
      throw new Error('Terminal threads are unavailable');
    }
    return this.terminalThreads;
  }

  private refreshTerminalThreads(): void {
    const terminalThreads = this.requireTerminalThreads();
    const state = this.ensureProviderState(TERMINAL_PROVIDER_ID);
    state.sessions = terminalThreads.listThreads();
    state.activeSessionId = terminalThreads.getActiveThreadId();
    state.loading = false;
    state.error = null;
    this.renderSessionsList();
  }

  private async createTerminalThread(command?: string, title?: string): Promise<void> {
    const terminalThreads = this.requireTerminalThreads();
    try {
      const snapshot = await terminalThreads.createThread();
      const terminal = terminalThreads.getActiveTerminal();
      if (terminal && title) {
        terminal.setSuggestedTitle(title);
      }
      if (terminal && command) {
        terminal.write(command);
      }
      this.refreshTerminalThreads();
      this.scheduleRender();
      if (this.inputTextareaEl) {
        this.inputTextareaEl.value = '';
      }
      void snapshot;
    } catch (error) {
      errorLog('[AgentOutputView] Failed to create terminal thread:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  private submitTerminalInput(text: string): void {
    const terminal = this.requireTerminalThreads().getActiveTerminal();
    if (!terminal) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }
    terminal.pasteText(text);
    terminal.write('\r');
    terminal.focus();
    if (this.inputTextareaEl) {
      this.inputTextareaEl.value = '';
    }
  }

  private renderTerminalThreadBody(): void {
    if (!this.bodyEl) return;
    this.updateHeader(null);
    this.renderStatusIndicatorOnly();
    const terminalThreads = this.requireTerminalThreads();

    this.bodyEl.empty();
    this.emptyStateEl = null;

    if (!terminalThreads.hasThreads()) {
      this.bodyEl.removeClass('is-terminal-thread');
      const empty = this.bodyEl.createDiv({ cls: 'termy-agent-empty' });
      empty.createDiv({ cls: 'termy-agent-empty-title', text: t('agent.terminalThreadsEmptyTitle') });
      empty.createDiv({ cls: 'termy-agent-empty-body', text: t('agent.terminalThreadsEmpty') });
      terminalThreads.detach();
      this.updateInputDisabledState();
      return;
    }

    this.bodyEl.addClass('is-terminal-thread');
    const wrapper = this.bodyEl.createDiv({ cls: 'terminal-view-container termy-agent-terminal-view-container' });
    const terminalContainer = wrapper.createDiv({ cls: 'terminal-container termy-agent-terminal-container' });
    terminalThreads.attach(wrapper, terminalContainer);
    this.updateInputDisabledState();
  }

  private renderStatusIndicatorOnly(): void {
    if (!this.providerTabsEl) return;
    const ctx: TabRenderContext = {
      providerTabsEl: this.providerTabsEl,
      headerStatusEl: this.headerStatusEl,
      selectedAgentId: this.selectedAgentId,
      agentManager: this.agentManager,
      permissionQueue: this.permissionQueue,
      getActiveSnapshot: () => this.getActiveSnapshot(),
      onTabClick: (id) => this.switchAgent(id),
      onOpenSettings: () => {
        const a = this.app as { setting?: { open?: () => void } };
        a.setting?.open?.();
      },
    };
    renderStatusIndicator(ctx);
  }

  private handleTerminalThreadsChanged(): void {
    if (this.isTerminalProviderSelected()) {
      this.refreshTerminalThreads();
      this.scheduleRender();
    }
  }

  private handleClearAction(): void {
    if (this.isTerminalProviderSelected()) {
      const terminal = this.requireTerminalThreads().getActiveTerminal();
      if (!terminal) {
        throw new Error('Active terminal thread is unavailable');
      }
      terminal.clearBuffer();
      return;
    }
    this.clear();
  }

  async startTerminalThread(command: string, title?: string): Promise<void> {
    if (!this.terminalThreads) {
      throw new Error('Terminal threads are unavailable');
    }
    if (this.selectedAgentId !== TERMINAL_PROVIDER_ID) {
      this.selectedAgentId = TERMINAL_PROVIDER_ID;
      this.doRenderTabs();
      this.renderSessionsHeader();
    }
    await this.createTerminalThread(command, title);
  }
}

/* ── Module-level helpers ──────────────────────────────────────── */

function sessionIdFor(agentId: string, externalId: string): AgentSessionId {
  return `${agentId}:${externalId}`;
}

function parseAcpUpdatedAt(updatedAt: string | undefined): number {
  if (!updatedAt) {
    throw new Error('ACP session is missing updatedAt');
  }
  const value = Date.parse(updatedAt);
  if (!Number.isFinite(value)) {
    throw new Error(`ACP session has invalid updatedAt: ${updatedAt}`);
  }
  return value;
}

function requireAcpSessionCwd(session: { sessionId: string; cwd?: string }): string {
  const cwd = session.cwd?.trim();
  if (!cwd) {
    throw new Error(`ACP session "${session.sessionId}" is missing cwd`);
  }
  return cwd;
}

function importedThreadFromAcpSession(
  session: { sessionId: string; title?: string; cwd: string; updatedAt?: string },
  events: readonly AgentEvent[],
): ImportedAgentThreadListItem & {
  readonly events: readonly AgentEvent[];
} {
  return {
    id: session.sessionId,
    ...(session.title !== undefined ? { title: session.title } : {}),
    cwd: session.cwd,
    updatedAt: parseAcpUpdatedAt(session.updatedAt),
    importedAt: Date.now(),
    events,
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

function getProviderIconConfig(provider: ProviderTabConfig): ProviderIconConfig | undefined {
  if (provider.iconKind === 'lucide') {
    return { kind: 'lucide', icon: provider.icon };
  }
  if (!provider.icon) {
    return undefined;
  }
  return { kind: 'brand', icon: provider.icon };
}

function renderThreadPoolProviderIcon(el: HTMLElement, icon: ProviderIconConfig): void {
  if (icon.kind === 'lucide') {
    setIcon(el, icon.icon);
    return;
  }
  renderAgentBrandIcon(el, icon.icon);
}

function serializeSnapshotToMarkdown(snapshot: AgentSessionSnapshot): string {
  const parts: string[] = [];
  parts.push(`# ${snapshot.sessionId}`);
  if (snapshot.detail) parts.push(`_${snapshot.detail}_`);
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
      if (block.subtitle) parts.push(`_${block.subtitle}_`);
      if (block.body) parts.push(block.body);
      if (block.output) { parts.push('```'); parts.push(block.output); parts.push('```'); }
      if (block.diff) { parts.push('```diff'); parts.push(block.diff.unified); parts.push('```'); }
    } else if (block.kind === 'error') {
      parts.push(`> [!warning] ${block.message}`);
      if (block.details) parts.push(block.details);
    }
  }
  return parts.join('\n\n');
}
