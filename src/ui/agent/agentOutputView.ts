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
 *   - Read-only history from per-agent history services.
 *
 * The view stays dumb: rendering is driven entirely by snapshots
 * from {@link AgentSessionModel}, and any change that affects the
 * layout flows through {@link scheduleRender}.
 */

import type { Component, WorkspaceLeaf } from 'obsidian';
import { ItemView, Menu, Notice, setIcon, setTooltip } from 'obsidian';

import type { AgentEventBus } from '../../services/agentStream/agentEventBus';
import { AgentSessionModel, type AgentSessionSnapshot } from '../../services/agentStream/agentSessionModel';
import type { AgentSessionId } from '../../services/agentStream/agentEventTypes';
import type { SettingsAccessor } from '../../settings/settingsAccessor';
import type { AgentManager } from '../../services/agentStream/agentManager';
import type { PermissionQueue } from '../../services/agentStream/permissionQueue';
import type {
  OpenCodeReadOnlyHistoryService,
  OpenCodeHistorySession,
} from '../../services/agent/opencode/opencodeReadOnlyHistoryService';
import { adaptTranscriptToEvents } from '../../services/agent/opencode/opencodeMessageAdapter';
import type {
  ClaudeCodeReadOnlyHistoryService,
  ClaudeCodeSession,
} from '../../services/agent/claudeCode/claudeCodeReadOnlyHistoryService';
import type { CodexReadOnlyHistoryService, CodexHistorySession } from '../../services/agent/codex/codexReadOnlyHistoryService';
import { renderAgentSnapshot, type AgentSnapshotRenderer } from './agentMarkdownRenderer';
import { createAgentSnapshotRenderer } from './agentMarkdownRendererFactory';
import { enrichPromptWithContext } from '../../services/agent/panelContextEncoder';
import type { AgentContextBridge } from '../../services/context/agentContextBridge';
import { renderProviderTabs, renderStatusIndicator, type ProviderTabConfig, type TabRenderContext } from './agentOutputView.tabs';
import { renderInputBar } from './agentOutputView.input';
import { t } from '../../i18n';
import { errorLog } from '../../utils/logger';
import type { TerminalService } from '../../services/terminal/terminalService';
import type { TerminalSettings } from '../../settings/settings';
import {
  AgentTerminalThreadController,
  type TerminalThreadSnapshot,
} from './agentTerminalThreadController';

export const AGENT_OUTPUT_VIEW_TYPE = 'termy-agent-output-view';
const AGENT_OUTPUT_ICON = 'sparkles';
const SESSION_LIST_REFRESH_INTERVAL_MS = 30_000;
const TERMINAL_PROVIDER_ID = 'terminal';

export interface AgentOutputViewOptions {
  /** Bus the view subscribes to. */
  bus: AgentEventBus;
  /** Settings accessor for dynamic agent configuration. */
  settings?: SettingsAccessor;
  /** Agent lifecycle manager. */
  agentManager?: AgentManager;
  /** Permission queue for pending-count indicator. */
  permissionQueue?: PermissionQueue;
  /** Optional callback for prompt submission. */
  submitPrompt?: (text: string) => Promise<void> | void;
  /** Optional callback to interrupt a turn. */
  cancelTurn?: () => void;
  /** Returns the OpenCode history bridge. */
  getOpenCodeHistoryService?: () => OpenCodeReadOnlyHistoryService | null;
  /** Returns the Claude Code history bridge. */
  getClaudeCodeHistoryService?: () => ClaudeCodeReadOnlyHistoryService | null;
  /** Returns the Codex history bridge. */
  getCodexHistoryService?: () => CodexReadOnlyHistoryService | null;
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
  | OpenCodeHistorySession
  | ClaudeCodeSession
  | (CodexHistorySession & { id: string })
  | TerminalThreadSnapshot;

export class AgentOutputView extends ItemView {
  private readonly bus: AgentEventBus;
  private readonly settings: SettingsAccessor | null;
  private readonly agentManager: AgentManager | null;
  private readonly permissionQueue: PermissionQueue | null;
  private readonly model = new AgentSessionModel();
  private readonly rendererFactory: (view: AgentOutputView) => AgentSnapshotRenderer;
  private readonly submitPrompt?: (text: string) => Promise<void> | void;
  private readonly cancelTurn?: () => void;
  private readonly getOpenCodeHistoryService?: () => OpenCodeReadOnlyHistoryService | null;
  private readonly getClaudeCodeHistoryService?: () => ClaudeCodeReadOnlyHistoryService | null;
  private readonly getCodexHistoryService?: () => CodexReadOnlyHistoryService | null;
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
  private isReadOnlyHistory = false;

  // Data-driven state (Req 6 AC 1 / Property 6.1).
  private selectedAgentId: string | null = null;
  private readonly providerState: Map<string, ProviderState> = new Map();

  constructor(leaf: WorkspaceLeaf, options: AgentOutputViewOptions) {
    super(leaf);
    this.bus = options.bus;
    this.settings = options.settings ?? null;
    this.agentManager = options.agentManager ?? null;
    this.permissionQueue = options.permissionQueue ?? null;
    this.rendererFactory = options.rendererFactory ?? ((view) => createAgentSnapshotRenderer(view.app));
    this.submitPrompt = options.submitPrompt;
    this.cancelTurn = options.cancelTurn;
    this.getOpenCodeHistoryService = options.getOpenCodeHistoryService;
    this.getClaudeCodeHistoryService = options.getClaudeCodeHistoryService;
    this.getCodexHistoryService = options.getCodexHistoryService;
    this.getAgentContextBridge = options.getAgentContextBridge;
    if (options.getTerminalService) {
      this.terminalThreads = new AgentTerminalThreadController({
        getTerminalService: options.getTerminalService,
        getSettings: options.getSettings ?? missingTerminalSettings,
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
    this.isReadOnlyHistory = false;
    this.providerState.clear();

    this.unsubscribeModel = this.model.subscribe(() => this.scheduleRender());
    this.unsubscribeBus = this.bus.subscribe((envelope) => {
      try { this.model.apply(envelope); }
      catch (error) { errorLog('[AgentOutputView] Failed to apply envelope:', error); }
    });
    if (this.settings) {
      this.unsubscribeAgentsChange = this.settings.onAgentsChange(() => this.handleAgentsChange());
    }
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
    this.isReadOnlyHistory = false;
    this.providerState.clear();
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
    this.isReadOnlyHistory = false;
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
    if (!this.selectedAgentId) {
      new Notice(t('agent.noticeSubmitFailed'));
      return;
    }
    if (this.isTerminalProviderSelected()) {
      this.submitTerminalInput(text);
      return;
    }
    try {
      const snapshot = this.getAgentContextBridge?.()?.getCurrentSnapshot() ?? null;
      const state = this.getProviderState(this.selectedAgentId);
      const isFirstMessage = !state?.activeSessionId;
      const { enrichedPrompt, displayText } = enrichPromptWithContext(text, snapshot, {
        includeCurrentNote: isFirstMessage,
        includeSelection: !!snapshot?.selection && !snapshot.selection.isEmpty,
      });

      // If AgentManager is available, use the ACP path (Req 6 AC 5).
      if (this.agentManager && this.selectedAgentId) {
        const agentId = this.selectedAgentId;

        // Ensure agent is started and we have a session.
        let sessionId = state?.activeSessionId;
        if (!sessionId) {
          const vaultRoot = this.getVaultRoot();
          sessionId = await this.agentManager.newSession(agentId, { cwd: vaultRoot });
          const pState = this.ensureProviderState(agentId);
          pState.activeSessionId = sessionId;
          this.focusedSessionId = sessionIdFor(agentId, sessionId);
          this.isReadOnlyHistory = false;
        }

        // Focus the session for rendering.
        const internalId = sessionIdFor(agentId, sessionId);
        this.focusedSessionId = internalId;
        this.isReadOnlyHistory = false;
        this.scheduleRender();

        // Disable send button until response (Property 6.3).
        this.updateInputDisabledState(true);

        try {
          // AcpAgentSource.submitPrompt echoes displayText into the
          // bus automatically, so transcript shows the user message.
          await this.agentManager.sendPrompt(agentId, sessionId, { enrichedPrompt, displayText });
        } finally {
          this.updateInputDisabledState(false);
        }
        return;
      }

      // Fallback: legacy submitPrompt callback.
      if (this.submitPrompt) {
        const maybe = this.submitPrompt(enrichedPrompt);
        if (maybe instanceof Promise) await maybe;
        return;
      }
      new Notice(t('agent.noticeSubmitFailed'));
    } catch (error) {
      errorLog('[AgentOutputView] Failed to submit prompt:', error);
      new Notice(t('agent.noticeSubmitFailed'));
      this.updateInputDisabledState(false);
    }
  }

  /* ── Cancel handling (Req 6 AC 6) ────────────────────────────── */

  private handleCancel(): void {
    if (this.isTerminalProviderSelected()) {
      this.terminalThreads?.getActiveTerminal()?.write('\x03');
      return;
    }
    if (!this.agentManager || !this.selectedAgentId) {
      this.cancelTurn?.();
      return;
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

    if (!this.agentManager || !this.selectedAgentId) {
      new Notice(t('agent.sessionsProviderUnavailable'));
      return;
    }
    try {
      const agentId = this.selectedAgentId;
      const vaultRoot = this.getVaultRoot();
      const sessionId = await this.agentManager.newSession(agentId, { cwd: vaultRoot });
      const pState = this.ensureProviderState(agentId);
      pState.activeSessionId = sessionId;
      this.focusedSessionId = sessionIdFor(agentId, sessionId);
      this.isReadOnlyHistory = false;
      // Clear input.
      if (this.inputTextareaEl) this.inputTextareaEl.value = '';
      this.model.reset(this.focusedSessionId);
      this.scheduleRender();
      this.renderSessionsList();
    } catch (error) {
      errorLog('[AgentOutputView] Failed to create new session:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  /* ── Resume from read-only history (Req 4 AC 5) ──────────────── */

  private async handleResumeFromHistory(): Promise<void> {
    if (!this.agentManager || !this.selectedAgentId) {
      new Notice(t('agent.sessionsProviderUnavailable'));
      return;
    }
    try {
      const agentId = this.selectedAgentId;
      const vaultRoot = this.getVaultRoot();
      // Create a fresh ACP session — NOT session/load (Req 4 AC 5).
      const sessionId = await this.agentManager.newSession(agentId, { cwd: vaultRoot });
      const pState = this.ensureProviderState(agentId);
      pState.activeSessionId = sessionId;
      this.focusedSessionId = sessionIdFor(agentId, sessionId);
      this.isReadOnlyHistory = false;
      // Clear input and reset model for the new session.
      if (this.inputTextareaEl) this.inputTextareaEl.value = '';
      this.model.reset(this.focusedSessionId);
      this.scheduleRender();
      this.renderSessionsList();
    } catch (error) {
      errorLog('[AgentOutputView] Failed to resume from history:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  /* ── Restart handling (Req 9 AC 3) ───────────────────────────── */

  private async handleRestart(): Promise<void> {
    if (!this.agentManager || !this.selectedAgentId) return;
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
    const pendingPermission = this.permissionQueue?.pendingCount() ?? 0;
    // Disable input when viewing read-only history (Req 4 AC 4d).
    const disabled = isRunning || pendingPermission > 0 || this.isReadOnlyHistory;

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
    return '';
  }

  /* ── Session refresh ─────────────────────────────────────────── */

  private refreshActiveAgentSessions(force = false): void {
    if (!this.selectedAgentId) return;
    if (this.isTerminalProviderSelected()) {
      this.refreshTerminalThreads();
    } else if (this.selectedAgentId === 'claude-code') {
      this.refreshClaudeCodeSessions();
    } else if (this.selectedAgentId === 'codex') {
      void this.refreshCodexSessions(force).catch((e) => errorLog('[AgentOutputView] Codex refresh:', e));
    } else if (this.selectedAgentId === 'opencode') {
      void this.refreshOpenCodeSessions(force).catch((e) => errorLog('[AgentOutputView] OpenCode refresh:', e));
    }
  }

  private async refreshOpenCodeSessions(force = false): Promise<void> {
    const service = this.getOpenCodeHistoryService?.() ?? null;
    const state = this.ensureProviderState('opencode');
    if (!service) { state.error = t('agent.sessionsProviderUnavailable'); state.loading = false; this.renderSessionsList(); return; }
    if (state.loading && !force) return;
    state.loading = true; state.error = null; this.renderSessionsList();
    try { state.sessions = await service.listSessions(); state.error = null; }
    catch (error) { state.error = this.formatLoadFailure(error); }
    finally { state.loading = false; this.renderSessionsList(); }
  }

  private refreshClaudeCodeSessions(): void {
    const service = this.getClaudeCodeHistoryService?.() ?? null;
    const state = this.ensureProviderState('claude-code');
    if (!service) { state.error = t('agent.sessionsProviderUnavailable'); state.loading = false; this.renderSessionsList(); return; }
    state.loading = true; state.error = null; this.renderSessionsList();
    try { state.sessions = service.listSessions(); state.error = null; }
    catch (error) { state.error = this.formatLoadFailure(error); }
    finally { state.loading = false; this.renderSessionsList(); }
  }

  private async refreshCodexSessions(force = false): Promise<void> {
    const service = this.getCodexHistoryService?.() ?? null;
    const state = this.ensureProviderState('codex');
    if (!service) { state.error = t('agent.sessionsProviderUnavailable'); state.loading = false; this.renderSessionsList(); return; }
    if (state.loading && !force) return;
    state.loading = true; state.error = null; this.renderSessionsList();
    try {
      const sessions = await service.listSessions();
      state.sessions = sessions.map((s) => ({ ...s, id: s.threadId, title: s.title }));
      state.error = null;
    } catch (error) { state.error = this.formatLoadFailure(error); }
    finally { state.loading = false; this.renderSessionsList(); }
  }

  /* ── Session loading ─────────────────────────────────────────── */

  private async loadOpenCodeSession(sessionId: string): Promise<void> {
    const service = this.getOpenCodeHistoryService?.() ?? null;
    if (!service) { new Notice(t('agent.sessionsProviderUnavailable')); return; }
    const state = this.ensureProviderState('opencode');
    state.activeSessionId = sessionId;
    const internalId = sessionIdFor('opencode', sessionId);
    this.focusedSessionId = internalId;
    this.isReadOnlyHistory = true;
    this.model.reset(internalId);
    this.scheduleRender(); this.renderSessionsList();
    this.setBusyHint(t('agent.transcriptLoading'));
    try {
      const messages = await service.loadTranscript(sessionId);
      this.model.applyEventsBatch(internalId, adaptTranscriptToEvents(internalId, messages));
      this.scheduleRender(); this.setBusyHint(null);
    } catch (error) {
      this.setBusyHint(null);
      errorLog('[AgentOutputView] OpenCode loadTranscript failed:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  private loadClaudeCodeSession(sessionId: string): void {
    const service = this.getClaudeCodeHistoryService?.() ?? null;
    if (!service) { new Notice(t('agent.sessionsProviderUnavailable')); return; }
    const state = this.ensureProviderState('claude-code');
    state.activeSessionId = sessionId;
    const internalId = sessionIdFor('claude-code', sessionId);
    this.focusedSessionId = internalId;
    this.isReadOnlyHistory = true;
    this.model.reset(internalId); this.renderSessionsList();
    this.setBusyHint(t('agent.transcriptLoading'));
    try {
      const events = service.loadTranscript(internalId, sessionId);
      this.model.applyEventsBatch(internalId, events);
      this.scheduleRender(); this.setBusyHint(null);
    } catch (error) {
      this.setBusyHint(null);
      errorLog('[AgentOutputView] Claude Code loadTranscript failed:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  private async loadCodexSession(threadId: string): Promise<void> {
    const service = this.getCodexHistoryService?.() ?? null;
    if (!service) { new Notice(t('agent.sessionsProviderUnavailable')); return; }
    const state = this.ensureProviderState('codex');
    state.activeSessionId = threadId;
    const internalId = sessionIdFor('codex', threadId);
    this.focusedSessionId = internalId;
    this.isReadOnlyHistory = true;
    this.model.reset(internalId);
    this.scheduleRender(); this.renderSessionsList();
    this.setBusyHint(t('agent.transcriptLoading'));
    try {
      const events = await service.loadTranscript(internalId, threadId);
      this.model.applyEventsBatch(internalId, events);
      this.scheduleRender(); this.setBusyHint(null);
    } catch (error) {
      this.setBusyHint(null);
      errorLog('[AgentOutputView] Codex loadTranscript failed:', error);
      new Notice(this.formatLoadFailure(error));
    }
  }

  /* ── Sessions list + sidebar ─────────────────────────────────── */

  private renderSessionsHeader(): void {
    if (!this.sessionsHeaderEl) return;
    this.sessionsHeaderEl.empty();
    this.sessionsHeaderEl.createDiv({
      cls: 'termy-agent-sidebar-title',
      text: this.isTerminalProviderSelected()
        ? t('agent.terminalThreadsHeading')
        : t('agent.sessionsHeading'),
    });
    const actions = this.sessionsHeaderEl.createDiv({ cls: 'termy-agent-sidebar-actions' });
    const refreshBtn = actions.createEl('button', { cls: 'clickable-icon termy-agent-sidebar-action', attr: { type: 'button' } });
    setIcon(refreshBtn, 'refresh-cw');
    setTooltip(refreshBtn, this.isTerminalProviderSelected()
      ? t('agent.terminalThreadsRefresh')
      : t('agent.sessionsRefresh'));
    refreshBtn.addEventListener('click', () => this.refreshActiveAgentSessions(true));
    const newBtn = actions.createEl('button', { cls: 'clickable-icon termy-agent-sidebar-action', attr: { type: 'button' } });
    setIcon(newBtn, 'plus');
    setTooltip(newBtn, this.isTerminalProviderSelected()
      ? t('agent.terminalThreadsNewThread')
      : t('agent.sessionsNewSession'));
    newBtn.addEventListener('click', () => { void this.handleNewSession(); });
  }

  private renderSessionsList(): void {
    if (!this.sessionsListEl) return;
    this.sessionsListEl.empty();
    const state = this.getProviderState(this.selectedAgentId);
    if (!state || (state.loading && state.sessions.length === 0)) {
      this.sessionsListEl.createDiv({ cls: 'termy-agent-sidebar-status', text: t('agent.sessionsLoading') });
      return;
    }
    if (state.error) {
      this.sessionsListEl.createDiv({ cls: 'termy-agent-sidebar-status is-error', text: state.error });
      return;
    }
    if (state.sessions.length === 0) {
      this.sessionsListEl.createDiv({
        cls: 'termy-agent-sidebar-status',
        text: this.isTerminalProviderSelected()
          ? t('agent.terminalThreadsEmpty')
          : t('agent.sessionsEmpty'),
      });
      return;
    }
    for (const session of state.sessions) {
      const item = this.sessionsListEl.createDiv({ cls: 'termy-agent-session-item' });
      if (session.id === state.activeSessionId) item.addClass('is-active');
      const titleText = session.title && session.title.length > 0 ? session.title : t('agent.sessionItemUntitled');
      const itemHeader = item.createDiv({ cls: 'termy-agent-session-title-row' });
      itemHeader.createDiv({ cls: 'termy-agent-session-title', text: titleText });
      if (this.isTerminalProviderSelected()) {
        const closeBtn = itemHeader.createEl('button', {
          cls: 'clickable-icon termy-agent-session-close',
          attr: { type: 'button', 'aria-label': t('agent.terminalThreadsClose') },
        });
        setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          void this.terminalThreads?.closeThread(session.id);
        });
      }
      const updated = 'updatedAt' in session
        ? (session as { updatedAt: number }).updatedAt
        : ('time' in session ? ((session as { time?: { updated?: number } }).time?.updated ?? Date.now()) : Date.now());
      item.createDiv({ cls: 'termy-agent-session-meta', text: formatRelativeTime(updated, Date.now()) });
      const sid = session.id;
      item.addEventListener('click', () => this.handleSessionClick(sid));
    }
  }

  private handleSessionClick(sessionId: string): void {
    if (this.isTerminalProviderSelected()) {
      this.terminalThreads?.setActiveThread(sessionId);
      this.refreshTerminalThreads();
      this.scheduleRender();
    } else if (this.selectedAgentId === 'claude-code') {
      try { this.loadClaudeCodeSession(sessionId); }
      catch (error) { new Notice(this.formatLoadFailure(error)); }
    } else if (this.selectedAgentId === 'codex') {
      void this.loadCodexSession(sessionId).catch((e) => new Notice(this.formatLoadFailure(e)));
    } else {
      void this.loadOpenCodeSession(sessionId).catch((e) => new Notice(this.formatLoadFailure(e)));
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
      return;
    }

    this.emptyStateEl = null;
    this.bodyEl.empty();
    // Read-only history badge + resume button (Req 4 AC 4 / Property 4.4).
    if (this.isReadOnlyHistory) {
      const readOnlyBar = this.bodyEl.createDiv({ cls: 'termy-agent-readonly-bar' });
      readOnlyBar.createDiv({ cls: 'termy-agent-readonly-badge', text: t('agent.readOnlyBadge') });
      if (this.agentManager && this.selectedAgentId) {
        const resumeBtn = readOnlyBar.createEl('button', {
          cls: 'mod-cta termy-agent-resume-btn',
          text: t('agent.resumeSessionButton'),
          attr: { type: 'button' },
        });
        resumeBtn.addEventListener('click', () => { void this.handleResumeFromHistory(); });
      }
    }
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
    if (match?.title && match.title.length > 0) return match.title;
    return this.settings?.getAgent(providerKey)?.label ?? sid;
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
          const activeId = this.terminalThreads?.getActiveThreadId();
          if (activeId) void this.terminalThreads?.closeThread(activeId);
        });
      });
    } else {
      menu.addItem((item) => { item.setTitle(t('agent.menuClear')); item.setIcon('eraser'); item.onClick(() => this.clear()); });
      menu.addItem((item) => { item.setTitle(t('agent.menuCopyTranscript')); item.setIcon('clipboard-copy'); item.onClick(() => { void this.copyTranscriptToClipboard(); }); });
    }
    menu.showAtMouseEvent(event);
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

  private getProviderTabs(): ProviderTabConfig[] {
    const agents = this.settings?.getEnabledAgents() ?? [];
    const tabs: ProviderTabConfig[] = this.terminalThreads
      ? [{
        id: TERMINAL_PROVIDER_ID,
        label: t('agent.terminalProvider'),
        icon: 'terminal',
        fallbackIcon: 'terminal',
      }]
      : [];
    return tabs.concat(agents.map((agent) => ({
      id: agent.id,
      label: agent.label,
      icon: agent.icon,
    })));
  }

  private isTerminalProviderSelected(): boolean {
    return this.selectedAgentId === TERMINAL_PROVIDER_ID;
  }

  private refreshTerminalThreads(): void {
    if (!this.terminalThreads) return;
    const state = this.ensureProviderState(TERMINAL_PROVIDER_ID);
    state.sessions = this.terminalThreads.listThreads();
    state.activeSessionId = this.terminalThreads.getActiveThreadId();
    state.loading = false;
    state.error = null;
    this.renderSessionsList();
  }

  private async createTerminalThread(command?: string, title?: string): Promise<void> {
    if (!this.terminalThreads) return;
    try {
      const snapshot = await this.terminalThreads.createThread();
      const terminal = this.terminalThreads.getActiveTerminal();
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
    const terminal = this.terminalThreads?.getActiveTerminal();
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

    this.bodyEl.empty();
    this.emptyStateEl = null;

    if (!this.terminalThreads?.hasThreads()) {
      this.bodyEl.removeClass('is-terminal-thread');
      const empty = this.bodyEl.createDiv({ cls: 'termy-agent-empty' });
      empty.createDiv({ cls: 'termy-agent-empty-title', text: t('agent.terminalThreadsEmptyTitle') });
      empty.createDiv({ cls: 'termy-agent-empty-body', text: t('agent.terminalThreadsEmpty') });
      this.terminalThreads?.detach();
      this.updateInputDisabledState();
      return;
    }

    this.bodyEl.addClass('is-terminal-thread');
    const wrapper = this.bodyEl.createDiv({ cls: 'terminal-view-container termy-agent-terminal-view-container' });
    const terminalContainer = wrapper.createDiv({ cls: 'terminal-container termy-agent-terminal-container' });
    this.terminalThreads.attach(wrapper, terminalContainer);
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
      this.terminalThreads?.getActiveTerminal()?.clearBuffer();
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

function missingTerminalSettings(): TerminalSettings {
  throw new Error('Terminal settings are unavailable');
}
