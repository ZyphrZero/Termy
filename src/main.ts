import type { View, WorkspaceLeaf } from 'obsidian';
import { addIcon, FileSystemAdapter, Modal, Notice, Plugin, normalizePath, setIcon, setTooltip } from 'obsidian';
import {
  DEFAULT_PRESET_SCRIPTS,
  DEFAULT_TERMINAL_SETTINGS,
  type PresetScript,
  type PresetWorkflowAction,
  type TerminalSettings,
} from './settings/settings';
import { PresetScriptModal } from './ui/terminal/presetScriptModal';
import { renderPresetScriptIcon } from './ui/terminal/presetScriptIcons';
import { TerminalSettingTab } from './settings/settingsTab';
import type { TerminalService } from './services/terminal/terminalService';
import type { ServerManager } from './services/server/serverManager';
import type { IdeBridge } from './services/ideBridge/ideBridge';
import type { AgentContextBridge } from './services/context/agentContextBridge';
import { TERMINAL_VIEW_TYPE, TerminalView } from './ui/terminal/terminalView';
import { ChangelogModal } from './ui/changelog/changelogModal';
import { i18n, t } from './i18n';
import { debugLog, errorLog } from './utils/logger';
import { createTermyLogoSvg, createTermyLogoSvgMarkup, TERMY_RIBBON_ICON_ID } from './ui/icons';
import { FeatureVisibilityManager } from './services/visibility';
import { shell } from 'electron';
import type { TerminalInstance } from './services/terminal/terminalInstance';
import {
  getAlwaysOnTopTerminalLabelKey,
  getAlwaysOnTopTerminalMenuState,
} from './services/terminal/alwaysOnTopTerminalDisplay';
import { getLeafForTerminalRoute } from './services/terminal/terminalLeafRouting';
import {
  AI_LAUNCHER_CATALOG,
  getAiLauncherEntry,
  getInstallCommandForPlatform,
  getUpgradeCommandForPlatform,
  partitionLaunchers,
  type AiLauncherCategory,
  type AiLauncherCatalogEntry,
  type AiLauncherStatus,
} from './services/terminal/aiLauncherCatalog';
import {
  clearCommandAvailabilityCache,
  detectCommandAvailability,
  type CommandAvailability,
} from './services/terminal/commandAvailability';
import { clearCommandVersionCache, probeCommandVersion } from './services/terminal/commandVersionProbe';
import { clearLatestVersionCache, fetchLatestVersion } from './services/terminal/latestVersionRegistry';
import {
  buildNodeRuntimeEnvironment,
  buildNpmPackageInstallCommand,
  clearNodeRuntimeCache,
  detectNodeRuntime,
  getNodeDownloadUrl,
  getNodeRuntimeRecommendation,
  type NodeRuntimeSnapshot,
} from './services/terminal/nodeRuntime';
import {
  buildAiLauncherStatusSnapshot,
  readinessToBadge,
  type AiLauncherStatusSnapshot,
} from './services/terminal/aiLauncherStatus';
import {
  clearEnrichedShellEnvCache,
  getEnrichedShellEnv,
} from './services/terminal/enrichedShellEnv';
import { LauncherInstallModal } from './ui/terminal/launcherInstallModal';
import { resolveChangelogSection } from './utils/changelog';
import embeddedChangelogContent from '../CHANGELOG.md';

// Import terminal styles

const REPOSITORY_URL = 'https://github.com/ZyphrZero/Termy';
const CHANGELOG_URL = `${REPOSITORY_URL}/blob/master/CHANGELOG.md`;
const EMBEDDED_CHANGELOG_SOURCE_PATH = 'CHANGELOG.md';
const ALWAYS_ON_TOP_TAB_BADGE_CLASS = 'termy-always-on-top-tab-badge';

type ChangelogDetails = {
  requestedVersion: string;
  version: string;
  markdown: string;
  releaseUrl: string | null;
  fullChangelogUrl: string;
  sourcePath: string;
  exactMatch: boolean;
};

type ElectronBrowserWindowLike = {
  setAlwaysOnTop: (flag: boolean, level?: string) => void;
  isAlwaysOnTop?: () => boolean;
  focus?: () => void;
};

type ElectronRuntime = {
  remote?: {
    getCurrentWindow?: () => ElectronBrowserWindowLike;
  };
};

type ElectronRemoteRuntime = {
  getCurrentWindow?: () => ElectronBrowserWindowLike;
};

/**
 * Main class for the Obsidian Terminal plugin
 */
export default class TerminalPlugin extends Plugin {
  settings!: TerminalSettings;
  featureVisibilityManager!: FeatureVisibilityManager;
  
  // Lazily initialized services
  private _serverManager: ServerManager | null = null;
  private _terminalService: TerminalService | null = null;
  private _ideBridge: IdeBridge | null = null;
  private _agentContextBridge: AgentContextBridge | null = null;
  private _changelogContentCache: string | null = null;
  private _changelogSectionCache: Map<string, ChangelogDetails> = new Map();
  
  // Status bar elements
  private _statusBarItem: HTMLElement | null = null;
  private _presetScriptsMenuEl: HTMLElement | null = null;
  private _presetScriptsMenuCleanup: (() => void) | null = null;

  /**
   * Snapshot of the most recent availability probe result, keyed by the
   * detect command (e.g. `claude`, `codex`). The status bar menu reads it
   * synchronously so the "hide unavailable launchers" setting can act on a
   * known state. The map is refreshed by {@link refreshAiLauncherAvailability}.
   */
  private _aiLauncherAvailability: Map<string, CommandAvailability> = new Map();

  /**
   * Combined snapshot per launcher (presetId → snapshot). The snapshot
   * carries the local version, the upstream "latest" version (when the
   * user opted in via `checkAiLauncherUpdates`), and the derived readiness
   * including the new `update-available` state. This is the single source
   * of truth that both the menu and the install modal consume.
   */
  private _aiLauncherSnapshots: Map<string, AiLauncherStatusSnapshot> = new Map();
  private _nodeRuntimeSnapshot: NodeRuntimeSnapshot | null = null;
  /**
   * Listeners notified when a launcher snapshot is updated. The settings
   * page subscribes so its rows stay in sync when offline mode toggles
   * or the user opts in to update checks while the page is open.
   */
  private _aiLauncherSnapshotListeners: Set<(presetId: string, snapshot: AiLauncherStatusSnapshot) => void> = new Set();
  private _alwaysOnTopTerminalLeaf: WorkspaceLeaf | null = null;
  private pendingRestoredTerminals: WeakMap<WorkspaceLeaf, TerminalInstance> = new WeakMap();

  // Registered preset script commands
  private registeredPresetScriptCommandIds: Set<string> = new Set();

  /**
   * Get the server manager (lazy initialization)
   */
  async getServerManager(): Promise<ServerManager> {
    if (!this._serverManager) {
      debugLog('[TerminalPlugin] Initializing ServerManager...');
      
      const { ServerManager } = await import('./services/server/serverManager');
      
      const pluginDir = this.getPluginDir();
      const version = this.manifest.version;
      const binaryDownloadConfig = {
        source: this.settings.serverConnection?.binaryDownloadSource ?? 'cloudflare-r2',
      };
      const offlineMode = this.settings.serverConnection?.offlineMode ?? false;
      
      this._serverManager = new ServerManager(
        pluginDir,
        version,
        binaryDownloadConfig,
        this.settings.enableDebugLog,
        offlineMode
      );
      
      debugLog('[TerminalPlugin] ServerManager initialized');
    }
    return this._serverManager;
  }

  /**
   * Get the terminal service (lazy initialization)
   */
  async getTerminalService(): Promise<TerminalService> {
    await this.initializeIdeBridge();
    await this.initializeAgentContextBridge();

    if (!this._terminalService) {
      debugLog('[TerminalPlugin] Initializing TerminalService...');
      
      const { TerminalService } = await import('./services/terminal/terminalService');
      
      const serverManager = await this.getServerManager();
        this._terminalService = new TerminalService(
          this.app,
          this.settings,
          serverManager,
          () => ({
            ...this.getNodeRuntimeTerminalEnv(),
            ...(this._ideBridge?.getTerminalEnv() ?? {}),
            ...(this._agentContextBridge?.getTerminalEnv() ?? {}),
          }),
          () => this.saveSettings(),
        );
      
      debugLog('[TerminalPlugin] TerminalService initialized');
    }
    return this._terminalService;
  }

  /**
   * Called when the plugin loads
   */
  async onload() {
    // Initialize the i18n service
    i18n.initialize();
    
    debugLog(t('plugin.loadingMessage'));

    // Load settings
    await this.loadSettings();

    // Set debug mode
    const { setDebugMode } = await import('./utils/logger');
    setDebugMode(this.settings.enableDebugLog);

    // Initialize the feature visibility manager
    this.featureVisibilityManager = new FeatureVisibilityManager(this);
    this.registerCustomIcons();

    // Register feature visibility configuration
    this.registerFeatureVisibility();

    // Register the terminal view
    this.registerView(
      TERMINAL_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        // Create a placeholder view; the actual initialization happens when the user opens it
        return new TerminalViewPlaceholder(leaf, this);
      }
    );

    // Register all commands
    this.registerCommands();

    void this.initializeIdeBridge().catch((error) => {
      errorLog('[TerminalPlugin] Failed to initialize IDE bridge:', error);
    });
    void this.initializeAgentContextBridge().catch((error) => {
      errorLog('[TerminalPlugin] Failed to initialize agent context bridge:', error);
    });

    // Delay UI initialization until the layout is ready whenever possible
    this.app.workspace.onLayoutReady(() => {
      this.initStatusBar();
      if (this.settings.visibility.showInNewTab) {
        this.registerNewTabTerminalAction();
      }
      void this.maybeShowChangelogOnFirstOpen().catch((error) => {
        errorLog('[TerminalPlugin] Failed to show changelog on first open:', error);
      });
      // Warm up the AI launcher availability snapshot so the first menu
      // open already shows accurate Ready / Not installed badges.
      // The enriched login-shell PATH must finish first so the launcher
      // probe sees fnm / nvm / asdf / mise / volta entries; see
      // {@link getEnrichedShellEnv} for the rationale.
      void this.warmRuntimeAndLaunchers().catch((error) => {
        errorLog('[TerminalPlugin] Failed to warm runtime caches:', error);
      });
    });

    // Add the settings tab
    this.addSettingTab(new TerminalSettingTab(this.app, this));

    debugLog(t('plugin.loadedMessage'));
  }

  /**
   * Called when the plugin unloads
   */
  onunload(): void {
    void this.handleUnload();
  }

  private async handleUnload(): Promise<void> {
    debugLog(t('plugin.unloadingMessage'));

    // Stop any in-flight launcher upgrade watchdogs so their poll
    // timers do not outlive the plugin lifecycle.
    for (const presetId of this._upgradeWatchdogTimers.keys()) {
      this.stopUpgradeWatchdog(presetId);
    }

    // Clean up the feature visibility manager
    if (this.featureVisibilityManager) {
      this.featureVisibilityManager.cleanup();
    }

    this.closePresetScriptsMenu();

    // Clean up the terminal service (this automatically cleans up all terminal instances)
    if (this._terminalService) {
      try {
        debugLog('[TerminalPlugin] Shutting down TerminalService...');
        await this._terminalService.shutdown();
        debugLog('[TerminalPlugin] TerminalService stopped');
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to shutdown TerminalService:', error);
      }
    }

    // Stop the server
    if (this._serverManager) {
      try {
        debugLog('[TerminalPlugin] Shutting down ServerManager...');
        await this._serverManager.shutdown();
        debugLog('[TerminalPlugin] ServerManager stopped');
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to stop ServerManager:', error);
      }
    }

    if (this._ideBridge) {
      try {
        debugLog('[TerminalPlugin] Shutting down IDE bridge...');
        await this._ideBridge.stop();
        debugLog('[TerminalPlugin] IDE bridge stopped');
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to stop IDE bridge:', error);
      }
    }

    if (this._agentContextBridge) {
      try {
        debugLog('[TerminalPlugin] Shutting down agent context bridge...');
        this._agentContextBridge.stop();
        debugLog('[TerminalPlugin] Agent context bridge stopped');
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to stop agent context bridge:', error);
      }
    }

    debugLog(t('plugin.unloadedMessage'));
  }

  private async initializeIdeBridge(): Promise<void> {
    if (!this._ideBridge) {
      const { IdeBridge } = await import('./services/ideBridge/ideBridge');
      this._ideBridge = new IdeBridge(this.app, this.manifest.version);
    }

    await this._ideBridge.start();
  }

  private async initializeAgentContextBridge(): Promise<void> {
    if (!this._agentContextBridge) {
      const { AgentContextBridge } = await import('./services/context/agentContextBridge');
      this._agentContextBridge = new AgentContextBridge(this.app, this.getPluginDir());
    }

    this._agentContextBridge.start();
  }

  showChangelog(version = this.manifest.version): void {
    new ChangelogModal(this.app, this, version).open();
  }

  getChangelogDetails(version = this.manifest.version): ChangelogDetails {
    const normalizedVersion = version.trim();
    if (!normalizedVersion) {
      throw new Error('Plugin version is unavailable');
    }

    const cached = this._changelogSectionCache.get(normalizedVersion);
    if (cached) {
      return cached;
    }

    const changelogContent = this.readChangelogContent();
    const resolvedSection = resolveChangelogSection(changelogContent, normalizedVersion);
    const details = {
      requestedVersion: normalizedVersion,
      version: resolvedSection.resolvedVersion,
      markdown: resolvedSection.markdown,
      releaseUrl: resolvedSection.resolvedVersion !== 'Unreleased'
        ? `${REPOSITORY_URL}/releases/tag/${resolvedSection.resolvedVersion}`
        : null,
      fullChangelogUrl: CHANGELOG_URL,
      sourcePath: EMBEDDED_CHANGELOG_SOURCE_PATH,
      exactMatch: resolvedSection.exactMatch,
    };

    if (!resolvedSection.exactMatch) {
      debugLog(
        `[TerminalPlugin] Falling back from changelog version ${normalizedVersion} to ${resolvedSection.resolvedVersion}`
      );
    }

    this._changelogSectionCache.set(normalizedVersion, details);
    return details;
  }

  private async maybeShowChangelogOnFirstOpen(): Promise<void> {
    const currentVersion = this.manifest.version.trim();
    if (!currentVersion || this.settings.lastSeenChangelogVersion === currentVersion) {
      return;
    }

    this.getChangelogDetails(currentVersion);
    this.showChangelog(currentVersion);
    this.settings.lastSeenChangelogVersion = currentVersion;
    await this.saveData(this.settings);
  }

  private readChangelogContent(): string {
    if (this._changelogContentCache) {
      return this._changelogContentCache;
    }

    // Always read the bundled changelog so every install path behaves the same.
    this._changelogContentCache = embeddedChangelogContent;
    return this._changelogContentCache;
  }

  /**
   * Load settings
   */
  async loadSettings() {
    const loaded = (await this.loadData()) as Partial<TerminalSettings> | null;
    const normalizedPresetScripts = this.normalizePresetScripts(loaded?.presetScripts);
    this.settings = {
      ...DEFAULT_TERMINAL_SETTINGS,
      ...loaded,
      // Ensure the visibility config exists
      visibility: {
        ...DEFAULT_TERMINAL_SETTINGS.visibility,
        ...loaded?.visibility,
      },
      // Ensure the serverConnection config exists
      serverConnection: this.normalizeServerConnectionSettings(loaded?.serverConnection),
      // Ensure the presetScripts config exists
      presetScripts: normalizedPresetScripts,
    };
  }

  /**
   * Save settings
   */
  async saveSettings() {
    this.settings.presetScripts = this.normalizePresetScripts(this.settings.presetScripts);
    this.settings.serverConnection = this.normalizeServerConnectionSettings(this.settings.serverConnection);
    await this.saveData(this.settings);
    
    // Update debug mode
    const { setDebugMode } = await import('./utils/logger');
    setDebugMode(this.settings.enableDebugLog);
    
    // Update the ServerManager configuration
    if (this._serverManager) {
      this._serverManager.updateDebugMode(this.settings.enableDebugLog);
      this._serverManager.updateOfflineMode(this.settings.serverConnection.offlineMode);
      this._serverManager.updateBinaryDownloadConfig({
        source: this.settings.serverConnection.binaryDownloadSource,
      });
    }

    // Update terminal service settings
    if (this._terminalService) {
      this._terminalService.updateSettings(this.settings);
    }

    // Register newly added preset script commands
    this.registerPresetScriptCommands();
  }

  private normalizePresetScripts(value: unknown): PresetScript[] {
    const scripts = Array.isArray(value)
      ? value.map((script: PresetScript) => this.normalizePresetScript(script))
      : [];
    const existingIds = new Set(scripts.map((script) => script.id));

    // Seed missing built-in workflows. This happens on first install or if a
    // user has deleted a built-in workflow — it's a one-time recovery, not a
    // continuous "reset to defaults". Once seeded, the user's saved version
    // is the source of truth.
    for (const builtInScript of DEFAULT_PRESET_SCRIPTS) {
      if (existingIds.has(builtInScript.id)) {
        continue;
      }

      scripts.push(this.clonePresetScript(builtInScript));
      existingIds.add(builtInScript.id);
    }

    return scripts;
  }

  private clonePresetScript(script: PresetScript): PresetScript {
    return {
      ...script,
      actions: script.actions.map((action) => ({ ...action })),
    };
  }

  private normalizeServerConnectionSettings(
    serverConnection: Partial<TerminalSettings['serverConnection']> | null | undefined
  ): TerminalSettings['serverConnection'] {
    return {
      ...DEFAULT_TERMINAL_SETTINGS.serverConnection,
      ...serverConnection,
      binaryDownloadSource: serverConnection?.binaryDownloadSource === 'github-release'
        ? 'github-release'
        : 'cloudflare-r2',
      offlineMode: Boolean(serverConnection?.offlineMode),
    };
  }

  /**
   * Register feature visibility configuration
   */
  private registerFeatureVisibility(): void {
    this.featureVisibilityManager.registerFeature({
      id: 'terminal',
      getVisibility: () => this.settings.visibility,
      ribbon: {
        icon: TERMY_RIBBON_ICON_ID,
        tooltip: t('ribbon.terminalTooltip'),
        callback: () => {
          void this.activateTerminalView();
        },
      },
      onVisibilityChange: () => {
        // Update the terminal button in new tabs when terminal visibility settings change
        this.injectTerminalButtonToEmptyViews();
        // Update the status bar display
        this.updateStatusBar();
      },
    });
  }

  private registerCustomIcons(): void {
    addIcon(TERMY_RIBBON_ICON_ID, createTermyLogoSvgMarkup());
  }

  /**
   * Update feature visibility
   * Called after settings change
   */
  updateFeatureVisibility(): void {
    this.featureVisibilityManager.updateAllVisibility();
  }

  /**
   * Initialize the status bar
   */
  private initStatusBar(): void {
    this._statusBarItem = this.addStatusBarItem();
    this._statusBarItem.addClass('terminal-status-bar');
    this._statusBarItem.addClass('is-clickable');
    this._statusBarItem.setAttr('aria-label', t('ribbon.terminalTooltip'));

    // Create the SVG icon and label
    const iconEl = createTermyLogoSvg(18);
    iconEl.addClass('terminal-status-bar-icon');
    const labelEl = activeDocument.createElement('span');
    labelEl.addClass('terminal-status-bar-label');
    labelEl.textContent = 'Termy';
    this._statusBarItem.append(iconEl, labelEl);
    
    // Add click handler
    this._statusBarItem.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.togglePresetScriptsMenu(event);
    });
    
    // Context menu: preset scripts
    this._statusBarItem.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      this.togglePresetScriptsMenu(event);
    });
    
    // Show or hide based on settings
    this.updateStatusBar();
  }

  /**
   * Update the status bar visibility
   */
  private updateStatusBar(): void {
    if (!this._statusBarItem) return;
    
    const shouldShow = this.settings.visibility.enabled && 
                       this.settings.visibility.showInStatusBar;
    
    this._statusBarItem.toggleClass('is-hidden', !shouldShow);
  }

  /**
   * Activate the terminal view
   */
  async activateTerminalView(targetLeaf?: WorkspaceLeaf): Promise<void> {
    const { workspace } = this.app;
    
    const leaf = targetLeaf ?? this.getLeafForNewTerminal();

    // If locking new instances is enabled, pin the tab
    if (this.settings.lockNewInstance) {
      leaf.setPinned(true);
    }

    await leaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: this.settings.focusNewInstance,
    });

    // If focusing new instances is enabled, switch to the new tab
    if (this.settings.focusNewInstance) {
      workspace.setActiveLeaf(leaf, { focus: true });
    }
  }

  async toggleAlwaysOnTopTerminal(terminalView?: TerminalView | null): Promise<void> {
    const existingView = this.getTrackedAlwaysOnTopTerminalView();
    if (existingView) {
      if (!terminalView || terminalView.leaf === existingView.leaf) {
        await this.restoreAlwaysOnTopTerminalToMainWindow(existingView);
        return;
      }

      await this.focusAlwaysOnTopTerminal(existingView);
      return;
    }

    const sourceView = terminalView ?? this.getActiveTerminalView();
    if (!sourceView) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }

    const sourceTerminal = await sourceView.waitForTerminalInstance().catch(() => null);
    if (!sourceTerminal) {
      new Notice(t('terminal.notInitialized'));
      return;
    }

    let targetWindow = sourceView.leaf.getContainer?.().win;
    if (this.isLeafInMainWindow(sourceView.leaf)) {
      try {
        targetWindow = this.app.workspace.moveLeafToPopout(sourceView.leaf, {
          size: {
            width: 960,
            height: 640,
          },
        }).win;
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to move terminal to popout window:', error);
        const message = error instanceof Error ? error.message : String(error);
        new Notice(t('notices.terminal.alwaysOnTopOpenFailed', { message }), 5000);
        return;
      }
    }

    this._alwaysOnTopTerminalLeaf = sourceView.leaf;
    this.updateAlwaysOnTopTabBadges();
    await this.waitForTerminalWindowMigration(sourceView, targetWindow);
    this.app.workspace.setActiveLeaf(sourceView.leaf, { focus: true });
    targetWindow?.focus();
    await this.applyAlwaysOnTopToLeaf(sourceView.leaf, targetWindow);
    this.updateAlwaysOnTopTabBadges();
    sourceTerminal.focus();
  }

  getAlwaysOnTopTerminalLabel(terminalView?: TerminalView | null): string {
    const trackedView = this.getTrackedAlwaysOnTopTerminalView();
    const state = getAlwaysOnTopTerminalMenuState(
      !!trackedView,
      !!terminalView && trackedView?.leaf === terminalView.leaf,
    );
    return t(getAlwaysOnTopTerminalLabelKey(state));
  }

  isAlwaysOnTopTerminal(terminalView?: TerminalView | null): boolean {
    const trackedView = this.getTrackedAlwaysOnTopTerminalView();
    return !!terminalView && trackedView?.leaf === terminalView.leaf;
  }

  handleTerminalViewClosed(terminalView: TerminalView): void {
    if (this._alwaysOnTopTerminalLeaf === terminalView.leaf) {
      this._alwaysOnTopTerminalLeaf = null;
      this.updateAlwaysOnTopTabBadges();
    }
  }

  private getTrackedAlwaysOnTopTerminalView(): TerminalView | null {
    const leaf = this._alwaysOnTopTerminalLeaf;
    if (leaf && this.isTerminalView(leaf.view)) {
      return leaf.view;
    }

    this._alwaysOnTopTerminalLeaf = null;
    this.updateAlwaysOnTopTabBadges();
    return null;
  }

  private async focusAlwaysOnTopTerminal(terminalView: TerminalView): Promise<void> {
    const targetWindow = terminalView.leaf.getContainer?.().win;
    await this.waitForTerminalWindowMigration(terminalView, targetWindow);
    this.app.workspace.setActiveLeaf(terminalView.leaf, { focus: true });
    targetWindow?.focus();
    await this.applyAlwaysOnTopToLeaf(terminalView.leaf, targetWindow);
    this.updateAlwaysOnTopTabBadges();
    terminalView.getTerminalInstance()?.focus();
  }

  private async restoreAlwaysOnTopTerminalToMainWindow(terminalView: TerminalView): Promise<void> {
    const terminal = terminalView.releaseTerminalInstance();
    if (!terminal) {
      new Notice(t('terminal.notInitialized'));
      return;
    }

    const sourceLeaf = terminalView.leaf;
    const sourceWindow = sourceLeaf.getContainer?.().win;
    const browserWindow = await this.waitForBrowserWindowForLeaf(sourceLeaf, sourceWindow, 500);
    if (browserWindow?.isAlwaysOnTop?.()) {
      this.setBrowserWindowAlwaysOnTop(browserWindow, false);
    } else if (browserWindow) {
      this.setBrowserWindowAlwaysOnTop(browserWindow, false);
    }

    this._alwaysOnTopTerminalLeaf = null;
    this.updateAlwaysOnTopTabBadges();

    const { workspace } = this.app;
    const mainLeaf = this.getLeafForRestoredTerminal();
    this.pendingRestoredTerminals.set(mainLeaf, terminal);
    await mainLeaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: true,
    });

    const restoredView = await this.waitForTerminalViewInLeaf(mainLeaf);
    if (!restoredView) {
      errorLog('[TerminalPlugin] Failed to restore always-on-top terminal: target view did not load');
      this.pendingRestoredTerminals.delete(mainLeaf);
      await this.recoverReleasedTerminalInSourceView(terminalView, terminal, sourceWindow);
      new Notice(t('notices.terminal.alwaysOnTopRestoreFailed'), 5000);
      return;
    }

    this.pendingRestoredTerminals.delete(mainLeaf);
    if (restoredView.getTerminalInstance() !== terminal) {
      restoredView.adoptTerminalInstance(terminal);
    }
    workspace.setActiveLeaf(mainLeaf, { focus: true });
    terminal.focus();
    sourceLeaf.detach();
  }

  consumePendingRestoredTerminal(leaf: WorkspaceLeaf): TerminalInstance | null {
    const terminal = this.pendingRestoredTerminals.get(leaf);
    if (!terminal) {
      return null;
    }

    this.pendingRestoredTerminals.delete(leaf);
    return terminal;
  }

  private getLeafForRestoredTerminal(): WorkspaceLeaf {
    const { workspace } = this.app;
    const previousActiveLeaf = workspace.getMostRecentLeaf();
    const rootLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (rootLeaf) {
      workspace.setActiveLeaf(rootLeaf, { focus: false });
    }
    const leaf = workspace.getLeaf('tab');
    if (previousActiveLeaf && previousActiveLeaf !== rootLeaf) {
      workspace.setActiveLeaf(previousActiveLeaf, { focus: false });
    }
    return leaf;
  }

  private async waitForTerminalViewInLeaf(
    leaf: WorkspaceLeaf,
    timeoutMs = 2000,
  ): Promise<TerminalView | null> {
    const deadline = Date.now() + timeoutMs;
    do {
      if (this.isTerminalView(leaf.view)) {
        await leaf.loadIfDeferred?.();
        return leaf.view;
      }
      await this.delay(50);
    } while (Date.now() < deadline);

    return this.isTerminalView(leaf.view) ? leaf.view : null;
  }

  private async recoverReleasedTerminalInSourceView(
    terminalView: TerminalView,
    terminal: TerminalInstance,
    sourceWindow?: Window,
  ): Promise<void> {
    terminalView.adoptTerminalInstance(terminal);
    this._alwaysOnTopTerminalLeaf = terminalView.leaf;
    this.updateAlwaysOnTopTabBadges();
    await this.applyAlwaysOnTopToLeaf(terminalView.leaf, sourceWindow);
    terminal.focus();
  }

  private updateAlwaysOnTopTabBadges(): void {
    this.removeAlwaysOnTopTabBadges(activeDocument);
    for (const leaf of this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE)) {
      const leafDocument = leaf.view?.containerEl?.ownerDocument;
      if (leafDocument && leafDocument !== activeDocument) {
        this.removeAlwaysOnTopTabBadges(leafDocument);
      }
    }

    const leaf = this._alwaysOnTopTerminalLeaf;
    if (!leaf || !this.isTerminalView(leaf.view)) {
      return;
    }

    const tabHeader = this.getLeafTabHeader(leaf);
    if (!tabHeader) {
      return;
    }

    const badge = tabHeader.ownerDocument.createElement('span');
    badge.addClass(ALWAYS_ON_TOP_TAB_BADGE_CLASS);
    badge.setAttribute('aria-label', t('terminal.contextMenu.alreadyPinnedToTop'));
    badge.setAttribute('title', t('terminal.contextMenu.alreadyPinnedToTop'));
    setIcon(badge, 'lock');

    const titleEl = tabHeader.querySelector('.workspace-tab-header-inner-title');
    if (titleEl) {
      titleEl.insertAdjacentElement('afterend', badge);
      return;
    }

    tabHeader.querySelector('.workspace-tab-header-inner')?.appendChild(badge);
  }

  private removeAlwaysOnTopTabBadges(targetDocument: Document): void {
    targetDocument
      .querySelectorAll(`.${ALWAYS_ON_TOP_TAB_BADGE_CLASS}`)
      .forEach((badge) => badge.remove());
  }

  private getLeafTabHeader(leaf: WorkspaceLeaf): HTMLElement | null {
    const leafWithTabHeader = leaf as WorkspaceLeaf & {
      tabHeaderEl?: HTMLElement;
      tabHeaderInnerTitleEl?: HTMLElement;
    };
    const tabHeader = leafWithTabHeader.tabHeaderEl
      ?? leafWithTabHeader.tabHeaderInnerTitleEl?.closest<HTMLElement>('.workspace-tab-header')
      ?? leaf.view?.containerEl?.closest<HTMLElement>('.workspace-leaf')?.querySelector<HTMLElement>('.workspace-tab-header');

    return tabHeader ?? null;
  }

  private isLeafInMainWindow(leaf: WorkspaceLeaf): boolean {
    const leafWindow = leaf.getContainer?.().win;
    const mainWindow = this.app.workspace.rootSplit?.win;
    return !leafWindow || !mainWindow || leafWindow === mainWindow;
  }

  private async waitForTerminalWindowMigration(terminalView: TerminalView, targetWindow?: Window): Promise<void> {
    const deadline = Date.now() + 1500;
    do {
      terminalView.handleHostWindowChanged({ focus: false });
      const leafWindow = terminalView.leaf.getContainer?.().win;
      if (!targetWindow || leafWindow === targetWindow) {
        break;
      }
      await this.delay(50);
    } while (Date.now() < deadline);

    await this.delay(100);
    terminalView.handleHostWindowChanged({ focus: false });
  }

  private async applyAlwaysOnTopToLeaf(leaf: WorkspaceLeaf, targetWindow?: Window): Promise<void> {
    const browserWindow = await this.waitForBrowserWindowForLeaf(leaf, targetWindow);
    if (!browserWindow) {
      new Notice(t('notices.terminal.alwaysOnTopUnavailable'), 5000);
      return;
    }

    this.setBrowserWindowAlwaysOnTop(browserWindow, true);
  }

  private async waitForBrowserWindowForLeaf(
    leaf: WorkspaceLeaf,
    targetWindow?: Window,
    timeoutMs = 2000,
  ): Promise<ElectronBrowserWindowLike | null> {
    const deadline = Date.now() + timeoutMs;
    do {
      const browserWindow = this.getBrowserWindowForLeaf(leaf, targetWindow);
      if (browserWindow) {
        return browserWindow;
      }
      await this.delay(50);
    } while (Date.now() < deadline);

    return null;
  }

  private getBrowserWindowForLeaf(leaf: WorkspaceLeaf, targetWindow?: Window): ElectronBrowserWindowLike | null {
    const containerWindow = targetWindow ?? leaf.getContainer?.().win;
    return this.getBrowserWindowForDomWindow(containerWindow ?? window);
  }

  private getBrowserWindowForDomWindow(targetWindow: Window | undefined): ElectronBrowserWindowLike | null {
    if (!targetWindow) return null;

    const targetRequire = this.getWindowRequire(targetWindow);
    if (targetRequire) {
      const browserWindow = this.getBrowserWindowFromRequire(targetRequire);
      if (browserWindow) return browserWindow;
    }

    const currentRequire = this.getCurrentRequire();
    if (targetWindow === window && currentRequire) {
      return this.getBrowserWindowFromRequire(currentRequire);
    }

    return null;
  }

  private getWindowRequire(targetWindow: Window): NodeJS.Require | null {
    const candidate = targetWindow as Window & { require?: NodeJS.Require };
    return typeof candidate.require === 'function' ? candidate.require : null;
  }

  private getCurrentRequire(): NodeJS.Require | null {
    try {
      return require;
    } catch {
      return null;
    }
  }

  private getBrowserWindowFromRequire(runtimeRequire: NodeJS.Require): ElectronBrowserWindowLike | null {
    const electron = this.getElectronRuntime(runtimeRequire);
    const browserWindow = electron.remote?.getCurrentWindow?.() ?? null;
    if (browserWindow) return browserWindow;

    const electronRemote = this.getElectronRemoteRuntime(runtimeRequire);
    return electronRemote.getCurrentWindow?.() ?? null;
  }

  private getElectronRuntime(runtimeRequire: NodeJS.Require): ElectronRuntime {
    try {
      return runtimeRequire('electron') as ElectronRuntime;
    } catch {
      return {};
    }
  }

  private getElectronRemoteRuntime(runtimeRequire: NodeJS.Require): ElectronRemoteRuntime {
    try {
      return runtimeRequire('@electron/remote') as ElectronRemoteRuntime;
    } catch {
      return {};
    }
  }

  private setBrowserWindowAlwaysOnTop(browserWindow: ElectronBrowserWindowLike, enabled: boolean): void {
    try {
      browserWindow.setAlwaysOnTop(enabled, 'floating');
    } catch (error) {
      errorLog('[TerminalPlugin] Failed to set terminal window always-on-top:', error);
      new Notice(t('notices.terminal.alwaysOnTopUnavailable'), 5000);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /**
   * Register all commands
   */
  private registerCommands(): void {
    // Open terminal
    this.addCommand({
      id: 'open-terminal',
      name: t('commands.openTerminal'),
      checkCallback: (checking: boolean) => {
        // Check visibility settings
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        if (!checking) {
          void this.activateTerminalView();
        }
        return true;
      }
    });

    this.addCommand({
      id: 'show-changelog',
      name: t('commands.showChangelog'),
      callback: () => {
        this.showChangelog();
      },
    });

    this.addCommand({
      id: 'terminal-toggle-always-on-top',
      name: t('commands.terminalToggleAlwaysOnTop'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }

        const terminalView = this.getActiveTerminalView();
        if (!terminalView && !this._alwaysOnTopTerminalLeaf) {
          return false;
        }

        if (!checking) {
          void this.toggleAlwaysOnTopTerminal(terminalView);
        }
        return true;
      },
    });

    // Clear screen
    this.addCommand({
      id: 'terminal-clear',
      name: t('commands.terminalClear'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.getXterm().clear();
          }
          return true;
        }
        return false;
      }
    });

    // Copy
    this.addCommand({
      id: 'terminal-copy',
      name: t('commands.terminalCopy'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal && terminal.getXterm().hasSelection()) {
          if (!checking) {
            const selection = terminal.getXterm().getSelection();
            void navigator.clipboard.writeText(selection).catch((error) => {
              errorLog('[TerminalPlugin] Copy failed:', error);
            });
          }
          return true;
        }
        return false;
      }
    });

    // Paste
    this.addCommand({
      id: 'terminal-paste',
      name: t('commands.terminalPaste'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            void terminal.pasteFromClipboard().catch((error) => {
              errorLog('[TerminalPlugin] Paste failed:', error);
            });
          }
          return true;
        }
        return false;
      }
    });

    // Increase font size
    this.addCommand({
      id: 'terminal-font-increase',
      name: t('commands.terminalFontIncrease'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.increaseFontSize();
          }
          return true;
        }
        return false;
      }
    });

    // Decrease font size
    this.addCommand({
      id: 'terminal-font-decrease',
      name: t('commands.terminalFontDecrease'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.decreaseFontSize();
          }
          return true;
        }
        return false;
      }
    });

    // Reset font size
    this.addCommand({
      id: 'terminal-font-reset',
      name: t('commands.terminalFontReset'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.resetFontSize();
          }
          return true;
        }
        return false;
      }
    });

    // Split horizontally
    this.addCommand({
      id: 'terminal-split-horizontal',
      name: t('commands.terminalSplitHorizontal'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        if (terminalView) {
          if (!checking) {
            void terminalView.splitTerminal('horizontal');
          }
          return true;
        }
        return false;
      }
    });

    // Split vertically
    this.addCommand({
      id: 'terminal-split-vertical',
      name: t('commands.terminalSplitVertical'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        if (terminalView) {
          if (!checking) {
            void terminalView.splitTerminal('vertical');
          }
          return true;
        }
        return false;
      }
    });

    // Clear buffer
    this.addCommand({
      id: 'terminal-clear-buffer',
      name: t('commands.terminalClearBuffer'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.clearBuffer();
          }
          return true;
        }
        return false;
      }
    });

    this.addCommand({
      id: 'terminal-send-selection',
      name: t('commands.terminalSendSelection'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }

        if (!checking) {
          this.sendEditorSelectionToTerminal();
        }

        return true;
      }
    });

    this.addCommand({
      id: 'terminal-send-current-note',
      name: t('commands.terminalSendCurrentNote'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }

        if (!checking) {
          this.sendCurrentNoteToTerminal();
        }

        return true;
      }
    });

    this.addCommand({
      id: 'terminal-send-current-path',
      name: t('commands.terminalSendCurrentPath'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }

        if (!checking) {
          this.sendCurrentPathToTerminal();
        }

        return true;
      }
    });

    this.addCommand({
      id: 'terminal-prompt-previous',
      name: t('commands.terminalPromptPrevious'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }

        if (!checking) {
          this.navigateTerminalPrompt('previous');
        }

        return true;
      }
    });

    this.addCommand({
      id: 'terminal-prompt-next',
      name: t('commands.terminalPromptNext'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }

        if (!checking) {
          this.navigateTerminalPrompt('next');
        }

        return true;
      }
    });

    this.addCommand({
      id: 'terminal-prompt-last-failed',
      name: t('commands.terminalPromptLastFailed'),
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }

        if (!checking) {
          this.navigateToLastFailedTerminalCommand();
        }

        return true;
      }
    });

    // Register preset script commands
    this.registerPresetScriptCommands();
  }

  private registerPresetScriptCommands(): void {
    const scripts = this.settings.presetScripts ?? [];
    scripts.forEach((script) => {
      const commandId = this.getPresetScriptCommandId(script.id);
      if (this.registeredPresetScriptCommandIds.has(commandId)) return;

      this.registeredPresetScriptCommandIds.add(commandId);

      this.addCommand({
        id: commandId,
        name: `${t('commands.presetScriptPrefix')}${script.name || t('settingsDetails.terminal.presetScriptsUnnamed')}`,
        checkCallback: (checking: boolean) => {
          if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
            return false;
          }
          const currentScript = this.getPresetScriptById(script.id);
          if (!currentScript) return false;
          if (!currentScript.showInCommandPalette) {
            return false;
          }
          if (!checking) {
            this.runAiAwarePresetScript(currentScript);
          }
          return true;
        }
      });
    });
  }

  /**
   * Run a preset script, but route through the install modal when the entry
   * is a catalog-backed AI launcher whose CLI is not installed. The status
   * bar menu and the command palette share this path so behaviour stays
   * consistent across surfaces.
   */
  private runAiAwarePresetScript(script: PresetScript): void {
    const entry = getAiLauncherEntry(script.id);
    if (entry && entry.detectCommand) {
      const cached = this._aiLauncherSnapshots.get(entry.presetId);
      if (cached?.readiness === 'not-installed') {
        this.openLauncherInstallModal(script, entry, cached);
        return;
      }
      if (cached?.readiness === 'update-available') {
        const local = cached.local ?? '?';
        const latest = cached.latest ?? '?';
        new Notice(t('notices.presetScript.launcherUpdateAvailable', {
          name: script.name || entry.presetId,
          local,
          latest,
        }), 5000);
      }
    }
    this.runPresetScript(script).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('notices.presetScript.runFailed', { message }));
    });
  }

  /**
   * Get the currently active terminal view
   */
  private getActiveTerminalView(): TerminalView | null {
    const activeView = this.app.workspace.getActiveViewOfType(TerminalView);
    
    // Prefer the currently active terminal view
    if (activeView) {
      return activeView;
    }
    
    // Otherwise return the first terminal view
    const leaves = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
    const view = leaves.map((item) => item.view).find((item) => this.isTerminalView(item));
    return view ?? null;
  }

  private getActiveTerminalInstance(): TerminalInstance | null {
    return this.getActiveTerminalView()?.getTerminalInstance() ?? null;
  }

  private focusTerminalView(terminalView: TerminalView, terminal: TerminalInstance): void {
    this.app.workspace.setActiveLeaf(terminalView.leaf, { focus: true });
    terminal.focus();
  }

  private getActiveEditorContext(): { editor: { getSelection: () => string; getValue: () => string } | null; filePath: string | null } {
    const activeEditor = (this.app.workspace as typeof this.app.workspace & {
      activeEditor?: {
        editor?: { getSelection: () => string; getValue: () => string };
        file?: { path: string };
      };
    }).activeEditor;

    return {
      editor: activeEditor?.editor ?? null,
      filePath: activeEditor?.file?.path ?? this.app.workspace.getActiveFile()?.path ?? null,
    };
  }

  private sendEditorSelectionToTerminal(): void {
    const terminalView = this.getActiveTerminalView();
    const terminal = terminalView?.getTerminalInstance();
    if (!terminalView || !terminal) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }

    const { editor } = this.getActiveEditorContext();
    const selection = editor?.getSelection()?.trim() ?? '';
    if (!selection) {
      new Notice(t('notices.terminal.selectionRequired'));
      return;
    }

    terminal.pasteText(selection);
    this.focusTerminalView(terminalView, terminal);
  }

  private sendCurrentNoteToTerminal(): void {
    const terminalView = this.getActiveTerminalView();
    const terminal = terminalView?.getTerminalInstance();
    if (!terminalView || !terminal) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }

    const { editor } = this.getActiveEditorContext();
    const noteText = editor?.getValue() ?? '';
    if (!noteText.trim()) {
      new Notice(t('notices.terminal.noteRequired'));
      return;
    }

    terminal.pasteText(noteText);
    this.focusTerminalView(terminalView, terminal);
  }

  private sendCurrentPathToTerminal(): void {
    const terminalView = this.getActiveTerminalView();
    const terminal = terminalView?.getTerminalInstance();
    if (!terminalView || !terminal) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }

    const { filePath } = this.getActiveEditorContext();
    if (!filePath) {
      new Notice(t('notices.terminal.filePathRequired'));
      return;
    }

    terminal.sendText(normalizePath(filePath));
    this.focusTerminalView(terminalView, terminal);
  }

  private navigateTerminalPrompt(direction: 'previous' | 'next'): void {
    const terminal = this.getActiveTerminalInstance();
    if (!terminal) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }

    if (!terminal.navigatePrompt(direction)) {
      new Notice(t('notices.terminal.promptNavigationUnavailable'));
    }
  }

  private navigateToLastFailedTerminalCommand(): void {
    const terminal = this.getActiveTerminalInstance();
    if (!terminal) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }

    if (!terminal.navigateToLastFailedCommand()) {
      new Notice(t('notices.terminal.failedCommandUnavailable'));
    }
  }

  private isTerminalView(view: View | null | undefined): view is TerminalView {
    return !!view && view.getViewType() === TERMINAL_VIEW_TYPE;
  }

  /**
   * Register the "Open terminal" action in new tabs
   * Inject a custom button into empty tabs by listening to the layout-change event
   */
  private registerNewTabTerminalAction(): void {
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.injectTerminalButtonToEmptyViews();
      })
    );

    // Initial injection
    this.injectTerminalButtonToEmptyViews();
  }

  /**
   * Inject the "Open terminal" button into all empty tabs
   * Inject or remove the button based on the showInNewTab setting
   */
  private injectTerminalButtonToEmptyViews(): void {
    const shouldShow = this.settings.visibility.enabled && 
                       this.settings.visibility.showInNewTab;
    
    // Find all empty views
    const emptyViews = activeDocument.querySelectorAll('.workspace-leaf-content[data-type="empty"] .view-content');
    
    emptyViews.forEach((emptyView) => {
      const existingButton = emptyView.querySelector('.terminal-plugin-terminal-action');
      
      if (!shouldShow) {
        // If it should not be shown, remove the existing button
        if (existingButton) {
          existingButton.remove();
        }
        return;
      }
      
      // Check whether it has already been injected
      if (existingButton) {
        return;
      }

      // Find the actions container
      const actionsContainer = emptyView.querySelector('.empty-state-action-list');
      if (!actionsContainer) {
        return;
      }

      // Create the "Open terminal" button
      const terminalAction = activeDocument.createElement('div');
      terminalAction.className = 'empty-state-action terminal-plugin-terminal-action';
      terminalAction.textContent = t('commands.openTerminal');
      terminalAction.addEventListener('click', () => {
        const leaf = this.findLeafByEmptyView(emptyView);
        void this.activateTerminalView(leaf ?? undefined);
      });

      // Add it to the actions list
      actionsContainer.appendChild(terminalAction);
    });
  }

  /**
   * Get the leaf to use for a new terminal
   */
  private getLeafForNewTerminal(): WorkspaceLeaf {
    return getLeafForTerminalRoute(this.app.workspace, this.settings, {
      terminalViewType: TERMINAL_VIEW_TYPE,
      excludedLeaf: this._alwaysOnTopTerminalLeaf,
    });
  }

  private getPresetScriptById(scriptId: string): PresetScript | null {
    const scripts = this.settings.presetScripts ?? [];
    return scripts.find(script => script.id === scriptId) ?? null;
  }

  private findLeafByEmptyView(emptyView: Element): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType('empty');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (this.hasContentEl(view) && view.contentEl === emptyView) {
        return leaf;
      }
    }
    return null;
  }

  private hasContentEl(view: unknown): view is { contentEl: Element } {
    return typeof view === 'object' && view !== null && 'contentEl' in view;
  }

  private getPresetScriptCommandId(scriptId: string): string {
    return `preset-script-${scriptId}`;
  }

  private createPresetScriptId(): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `preset-${Date.now()}-${random}`;
  }

  private createWorkflowActionId(): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `action-${Date.now()}-${random}`;
  }

  private normalizePresetScript(script: PresetScript): PresetScript {
    const sourceActions = Array.isArray(script.actions) ? script.actions : [];
    const actions = sourceActions
      .map((action) => this.normalizeWorkflowAction(action))
      .filter((action) => action.value.length > 0);

    const normalized: PresetScript = {
      id: (script.id || '').trim(),
      sourceTemplateId: typeof script.sourceTemplateId === 'string' && script.sourceTemplateId.trim().length > 0
        ? script.sourceTemplateId.trim()
        : undefined,
      name: (script.name || '').trim(),
      icon: (script.icon || '').trim(),
      actions,
      terminalTitle: (script.terminalTitle || '').trim(),
      showInStatusBar: script.showInStatusBar !== false,
      showInCommandPalette: script.showInCommandPalette !== false,
      autoOpenTerminal: script.autoOpenTerminal !== false,
      runInNewTerminal: script.runInNewTerminal === true,
    };

    return normalized;
  }

  private normalizeWorkflowAction(action: PresetWorkflowAction): PresetWorkflowAction {
    const rawType = (action?.type || '').trim();
    const type = rawType === 'obsidian-command' || rawType === 'open-external'
      ? rawType
      : 'terminal-command';
    const value = (action?.value || '').trim();
    const id = (action?.id || '').trim() || this.createWorkflowActionId();
    const enabled = action?.enabled !== false;
    const note = typeof action?.note === 'string' ? action.note.trim() : '';
    return { id, type, value, enabled, note };
  }

  private openPresetScriptCreateModal(): void {
    const scripts = this.settings.presetScripts ?? [];
    let newId = this.createPresetScriptId();
    while (scripts.some(script => script.id === newId)) {
      newId = this.createPresetScriptId();
    }
    const newScript: PresetScript = {
      id: newId,
      name: '',
      icon: '',
      actions: [
        {
          id: this.createWorkflowActionId(),
          type: 'terminal-command',
          value: '',
          enabled: true,
          note: '',
        },
      ],
      terminalTitle: '',
      showInStatusBar: true,
      showInCommandPalette: true,
      autoOpenTerminal: true,
      runInNewTerminal: false,
    };
    const modal = new PresetScriptModal(this.app, newScript, (updatedScript: PresetScript) => {
      scripts.push(updatedScript);
      this.settings.presetScripts = scripts;
      void this.saveSettings();
    }, true);
    modal.open();
  }

  private openPresetScriptEditModal(script: PresetScript): void {
    const clone = this.clonePresetScript(script);
    const modal = new PresetScriptModal(this.app, clone, (updatedScript: PresetScript) => {
      const scripts = this.settings.presetScripts ?? [];
      const index = scripts.findIndex(item => item.id === updatedScript.id);
      if (index >= 0) {
        scripts[index] = updatedScript;
      }
      this.settings.presetScripts = scripts;
      void this.saveSettings();
    }, false);
    modal.open();
  }

  private buildPresetScriptTooltip(script: PresetScript): string {
    const name = script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed');
    const actions = Array.isArray(script.actions) ? script.actions : [];
    const enabledActions = actions.filter((action) => action.enabled !== false);

    if (enabledActions.length === 0) {
      return name;
    }

    const lines = enabledActions.map((action) => {
      const prefix = action.type === 'obsidian-command'
        ? 'Obsidian'
        : action.type === 'open-external'
          ? 'URL'
          : 'Terminal';
      const value = (action.value ?? '').trim();
      return value ? `${prefix}: ${value}` : prefix;
    });

    return `${name}\n${lines.join('\n')}`;
  }

  private confirmAndDeletePresetScript(scriptId: string, scriptName: string): void {
    const modal = new Modal(this.app);
    modal.titleEl.setText(t('common.confirm'));
    modal.contentEl.createEl('p', {
      text: t('settingsDetails.terminal.presetScriptsDeleteConfirm', { name: scriptName }),
    });
    const buttonContainer = modal.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancelBtn = buttonContainer.createEl('button', { cls: 'mod-cancel', text: t('common.cancel') });
    cancelBtn.addEventListener('click', () => modal.close());
    const confirmBtn = buttonContainer.createEl('button', { cls: 'mod-cta', text: t('common.confirm') });
    confirmBtn.addEventListener('click', () => {
      modal.close();
      this.settings.presetScripts = (this.settings.presetScripts ?? []).filter(s => s.id !== scriptId);
      void this.saveSettings();
    });
    modal.open();
  }

  private togglePresetScriptsMenu(event: MouseEvent): void {
    if (this._presetScriptsMenuEl) {
      this.closePresetScriptsMenu();
      return;
    }
    // Kick off a background availability refresh — the menu still renders
    // immediately using the most recent snapshot; the badges update in place
    // once new probe results arrive.
    void this.refreshAiLauncherAvailability();
    const anchorRect = this._statusBarItem?.getBoundingClientRect();
    if (anchorRect) {
      this.showPresetScriptsMenuAtRect(anchorRect);
    } else {
      this.showPresetScriptsMenuAtPoint(event.clientX, event.clientY);
    }
  }

  private showPresetScriptsMenuAtPoint(x: number, y: number): void {
    const menu = this.buildPresetScriptsMenu();
    if (!menu) return;
    menu.setCssStyles({ left: `${x}px`, top: `${y}px` });
    this.mountPresetScriptsMenu(menu);
    this.adjustPresetScriptsMenuPosition(menu);
  }

  private showPresetScriptsMenuAtRect(rect: DOMRect): void {
    const menu = this.buildPresetScriptsMenu();
    if (!menu) return;
    menu.setCssStyles({ left: `${rect.left}px`, top: `${rect.top}px` });
    this.mountPresetScriptsMenu(menu);
    const menuRect = menu.getBoundingClientRect();
    let top = rect.top - menuRect.height - 8;
    if (top < 8) {
      top = rect.bottom + 8;
    }
    let left = rect.left;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = window.innerWidth - menuRect.width - 8;
    }
    if (left < 8) left = 8;
    menu.setCssStyles({ top: `${top}px`, left: `${left}px` });
  }

  private mountPresetScriptsMenu(menu: HTMLElement): void {
    this.closePresetScriptsMenu();
    activeDocument.body.appendChild(menu);
    this._presetScriptsMenuEl = menu;

    const onOutsideClick = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node)) {
        this.closePresetScriptsMenu();
      }
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.closePresetScriptsMenu();
      }
    };
    activeDocument.addEventListener('mousedown', onOutsideClick, true);
    activeDocument.addEventListener('keydown', onKeydown, true);
    this._presetScriptsMenuCleanup = () => {
      activeDocument.removeEventListener('mousedown', onOutsideClick, true);
      activeDocument.removeEventListener('keydown', onKeydown, true);
    };
  }

  private adjustPresetScriptsMenuPosition(menu: HTMLElement): void {
    const rect = menu.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    if (rect.right > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (rect.bottom > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    menu.setCssStyles({ left: `${left}px`, top: `${top}px` });
  }

  private buildPresetScriptsMenu(): HTMLElement | null {
    const scripts = (this.settings.presetScripts ?? []);
    const visibleScripts = scripts.filter(script => script.showInStatusBar);
    const hideUnavailable = this.settings.hideUnavailableAiLaunchers === true;
    const menu = activeDocument.createElement('div');
    menu.className = 'preset-scripts-menu';
    menu.setAttribute('role', 'menu');

    const listEl = activeDocument.createElement('div');
    listEl.className = 'preset-scripts-menu-list';
    listEl.setAttribute('role', 'none');

    // Partition the visible scripts into the AI launcher catalog buckets
    // and the leftover "regular" workflows. The catalog buckets render
    // grouped sections with readiness badges, while regular workflows
    // keep their original drag-and-drop reorderable behavior.
    const partition = partitionLaunchers(visibleScripts);

    // Apply the user's "hide unavailable launchers" preference. We never
    // hide a launcher whose status is still 'unknown' — the menu shows it
    // as "Checking…" so the user still sees something during the very
    // first probe.
    const filterAvailable = (script: PresetScript): boolean => {
      if (!hideUnavailable) return true;
      const snapshot = this._aiLauncherSnapshots.get(script.id);
      // We never hide a launcher whose status is still 'unknown' — the
      // menu shows it as "Checking…" so the user still sees something.
      return snapshot?.readiness !== 'not-installed';
    };

    const codingAgentScripts = partition.codingAgent.filter(filterAvailable);
    const regularScripts = partition.regular;

    const hasAnyContent =
      codingAgentScripts.length > 0
      || regularScripts.length > 0;

    if (!hasAnyContent) {
      const empty = activeDocument.createElement('div');
      empty.className = 'preset-scripts-menu-item is-disabled';
      empty.textContent = t('settingsDetails.terminal.presetScriptsEmpty');
      listEl.appendChild(empty);
    }

    // Coding agent section
    if (codingAgentScripts.length > 0) {
      this.appendPresetMenuCategoryHeader(listEl, 'coding-agent');
      for (const script of codingAgentScripts) {
        const entry = getAiLauncherEntry(script.id);
        if (!entry) continue;
        listEl.appendChild(this.createAiLauncherMenuItem(script, entry));
      }
    }

    // Regular (non-AI) workflows keep the original drag-and-drop reorder UX.
    if (regularScripts.length > 0) {
      this.appendRegularPresetMenuItems(listEl, regularScripts);
    }

    menu.appendChild(listEl);

    const footerEl = activeDocument.createElement('div');
    footerEl.className = 'preset-scripts-menu-footer';

    const addItem = activeDocument.createElement('div');
    addItem.className = 'preset-scripts-menu-item preset-scripts-menu-add';
    addItem.setAttribute('role', 'menuitem');
    addItem.textContent = `+ ${t('settingsDetails.terminal.presetScriptsAddMenu')}`;
    addItem.addEventListener('click', () => {
      this.closePresetScriptsMenu();
      this.openPresetScriptCreateModal();
    });
    footerEl.appendChild(addItem);
    menu.appendChild(footerEl);

    return menu;
  }

  /**
   * Public hook used by the settings renderer when the user flips the
   * "Check for AI launcher updates" toggle. Re-runs the snapshot pipeline
   * so badges in the status bar menu reflect the new policy on the very
   * next open without waiting for the user to click again.
   *
   * Pass `force: true` to drop the in-memory caches first. The toggle
   * itself does not need this, but turning offline mode OFF does — any
   * registry lookup we did while offline returned an error and got
   * cached for 12 hours, so without a force-clear the badges would
   * still show "no latest version known" until the TTL elapses.
   */
  async refreshAiLauncherStatusFromSettings(options: { force?: boolean } = {}): Promise<void> {
    try {
      if (options.force) {
        clearLatestVersionCache();
        clearNodeRuntimeCache();
        clearEnrichedShellEnvCache();
        for (const entry of AI_LAUNCHER_CATALOG) {
          if (entry.detectCommand) {
            clearCommandVersionCache(entry.detectCommand);
          }
        }
      }
      // Re-warm the enriched login-shell PATH first; the launcher
      // probe in `refreshAiLauncherAvailability` reads it through the
      // shared cache.
      await getEnrichedShellEnv().catch(() => null);
      await this.refreshAiLauncherAvailability();
    } catch (error) {
      errorLog('[TerminalPlugin] Failed to refresh AI launcher status:', error);
    }
  }

  /**
   * Read the most recent cached snapshot for an AI launcher preset. Returns
   * undefined when the preset is unknown or no probe has resolved yet.
   * Exposed so the settings page can render the same readiness + version
   * info that the status bar menu uses, without re-running its own probes.
   */
  getAiLauncherSnapshot(presetId: string): AiLauncherStatusSnapshot | undefined {
    return this._aiLauncherSnapshots.get(presetId);
  }

  /**
   * Subscribe to launcher snapshot updates. The listener fires every
   * time {@link setAiLauncherSnapshot} writes a new snapshot — i.e.
   * whenever any probe (PATH, version, registry) settles. Used by the
   * settings page to keep its rows fresh when the user toggles offline
   * mode or opts in to update checks while the page is open.
   *
   * Returns an unsubscribe function. Callers MUST call it when their
   * DOM is torn down so we do not leak listeners across re-renders.
   */
  onAiLauncherSnapshotsChanged(
    listener: (presetId: string, snapshot: AiLauncherStatusSnapshot) => void,
  ): () => void {
    this._aiLauncherSnapshotListeners.add(listener);
    return () => {
      this._aiLauncherSnapshotListeners.delete(listener);
    };
  }

  /**
   * Single write site for {@link _aiLauncherSnapshots}. Updates the map
   * and fans the new value out to every registered listener so any open
   * surface (settings page rows, in-flight menu render) can re-paint
   * without polling.
   */
  private setAiLauncherSnapshot(presetId: string, snapshot: AiLauncherStatusSnapshot): void {
    this._aiLauncherSnapshots.set(presetId, snapshot);
    for (const listener of this._aiLauncherSnapshotListeners) {
      try {
        listener(presetId, snapshot);
      } catch (error) {
        errorLog('[TerminalPlugin] AI launcher snapshot listener threw:', error);
      }
    }
  }

  /**
   * Re-run the probe pipeline for a single launcher and return the fresh
   * snapshot. Public wrapper around {@link refreshSingleLauncherSnapshot}
   * so the settings page can refresh one row in place after the cached
   * snapshot is shown.
   */
  async refreshAiLauncherSnapshot(
    entry: AiLauncherCatalogEntry,
  ): Promise<AiLauncherStatusSnapshot | null> {
    return this.refreshSingleLauncherSnapshot(entry);
  }

  /**
   * Open the launcher install/upgrade modal for the given preset. Public
   * entry point for the settings page so rows there can offer the same
   * "Update now" affordance the status bar menu does.
   *
   * Returns false when the preset is not a catalogued AI launcher (or
   * has no detect command) — callers should fall through to whatever
   * default action makes sense for a regular workflow row.
   */
  openAiLauncherUpgradeModalForPreset(script: PresetScript): boolean {
    const entry = getAiLauncherEntry(script.id);
    if (!entry || !entry.detectCommand) return false;
    const snapshot = this._aiLauncherSnapshots.get(entry.presetId) ?? null;
    this.openLauncherInstallModal(script, entry, snapshot);
    return true;
  }

  /**
   * Refresh the AI launcher status snapshot in the background. The menu reads
   * {@link _aiLauncherSnapshots} synchronously when rendering; this method
   * keeps it warm so the very first menu open already has a meaningful
   * answer for most launchers.
   *
   * Pipeline per launcher:
   *   1. PATH probe (`where` / `which`) — always runs, zero network.
   *   2. Local `--version` probe — always runs, zero network. Falls back to
   *      well-known directories when PATH is sparse.
   *   3. Remote latest-version lookup — only runs when the user enabled
   *      `checkAiLauncherUpdates`. Off by default so the README's "no
   *      extra outbound traffic" promise holds out of the box.
   */
  private async refreshAiLauncherAvailability(): Promise<void> {
    const checkUpdates =
      this.settings.checkAiLauncherUpdates === true
      && this.settings.serverConnection?.offlineMode !== true;

    const tasks = AI_LAUNCHER_CATALOG.map(async (entry) => {
      if (!entry.detectCommand) {
        return;
      }
      const command = entry.detectCommand;
      const probe = await this.probeLauncher(command);
      const nodeRuntime = await this.detectNodeRuntimeForLauncher(entry, probe.pathAvailable, probe.localVersion.version);

      this._aiLauncherAvailability.set(command, probe.pathAvailable);

      let latest: { version: string | null; error?: string } | null = null;
      if (checkUpdates && entry.versionRegistry) {
        try {
          latest = await fetchLatestVersion(entry.versionRegistry);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          latest = { version: null, error: message };
        }
      }

      const snapshot = buildAiLauncherStatusSnapshot({
        pathAvailable: probe.pathAvailable,
        local: { version: probe.localVersion.version, resolvedFrom: probe.localVersion.resolvedFrom },
        latest,
        nodeRuntime,
      });
      this.setAiLauncherSnapshot(entry.presetId, snapshot);
    });

    await Promise.all(tasks);
  }

  /**
   * Render a section header inside the preset scripts menu. Used to label
   * the "Coding agent" bucket.
   */
  private appendPresetMenuCategoryHeader(
    listEl: HTMLElement,
    category: AiLauncherCategory,
  ): void {
    const title = t('settingsDetails.terminal.aiLauncherCategoryCodingAgent');
    const desc = t('settingsDetails.terminal.aiLauncherCategoryCodingAgentDesc');

    const header = activeDocument.createElement('div');
    header.className = 'preset-scripts-menu-section-header';
    header.dataset.category = category;
    header.setAttribute('role', 'presentation');

    const titleEl = activeDocument.createElement('div');
    titleEl.className = 'preset-scripts-menu-section-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);

    const descEl = activeDocument.createElement('div');
    descEl.className = 'preset-scripts-menu-section-desc';
    descEl.textContent = desc;
    header.appendChild(descEl);

    listEl.appendChild(header);
  }

  /**
   * Build a menu row for a real catalog-backed AI launcher. The row shows a
   * readiness badge ("Ready" / "Not installed") and routes the click to either
   * the regular preset runner or the install-guidance modal.
   */
  private createAiLauncherMenuItem(
    script: PresetScript,
    entry: AiLauncherCatalogEntry,
  ): HTMLElement {
    const item = activeDocument.createElement('div');
    item.className = 'preset-scripts-menu-item preset-scripts-menu-launcher';
    item.setAttribute('role', 'menuitem');
    item.dataset.scriptId = script.id;
    item.dataset.launcherCategory = entry.category;

    const iconEl = activeDocument.createElement('div');
    iconEl.className = 'preset-scripts-menu-icon';
    renderPresetScriptIcon(iconEl, script.icon || 'terminal');
    item.appendChild(iconEl);

    const labelEl = activeDocument.createElement('div');
    labelEl.className = 'preset-scripts-menu-label';
    labelEl.textContent = script.name || t('settingsDetails.terminal.presetScriptsUnnamed');
    item.appendChild(labelEl);

    // Pull the cached snapshot when available so re-opens don't flash
    // through "Checking…" on every click.
    const cachedSnapshot = this._aiLauncherSnapshots.get(entry.presetId);
    const initialBadgeStatus: AiLauncherStatus = cachedSnapshot
      ? readinessToBadge(cachedSnapshot.readiness)
      : (entry.detectCommand ? 'checking' : 'ready');
    const badge = this.createLauncherStatusBadge(initialBadgeStatus);
    item.appendChild(badge);
    if (cachedSnapshot) {
      item.dataset.availability = cachedSnapshot.readiness;
    }

    // Version info stays in the tooltip only for this surface — the menu
    // row is already crowded with icon + label + status badge, so the
    // inline label lives on the settings page where there is more room.

    setTooltip(item, this.buildLauncherTooltip(script, cachedSnapshot), {
      placement: 'top',
      classes: ['preset-script-tooltip'],
    });

    // Mutable holder so the click handler always sees the freshest
    // snapshot, even after the async refresh below settles.
    let snapshot = cachedSnapshot ?? null;

    // Inline "Update" affordance shown only when an upgrade is available
    // for this launcher AND the catalog defines an upgrade command for
    // the current platform. Clicking it routes through the install
    // modal so the user can review the exact command before running it.
    const updateBtn = activeDocument.createElement('button');
    updateBtn.className = 'preset-scripts-menu-action-btn preset-scripts-menu-action-update';
    updateBtn.setAttribute('aria-label', t('settingsDetails.terminal.aiLauncherUpdateAriaLabel'));
    setIcon(updateBtn, 'download');
    updateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePresetScriptsMenu();
      const current = snapshot;
      this.openLauncherInstallModal(script, entry, current);
    });

    const refreshUpdateBtnVisibility = (next: AiLauncherStatusSnapshot | null): void => {
      const showUpdate =
        next?.readiness === 'update-available'
        && getUpgradeCommandForPlatform(entry) !== null;
      updateBtn.classList.toggle('is-hidden', !showUpdate);
    };
    refreshUpdateBtnVisibility(cachedSnapshot ?? null);
    item.appendChild(updateBtn);

    // Refresh in the background so the badge & click route stay accurate
    // when the user re-opens the menu after an install or upgrade. We do
    // not block menu render on this — the cached snapshot is good enough.
    if (entry.detectCommand) {
      void this.refreshSingleLauncherSnapshot(entry).then((next) => {
        if (!next) return;
        snapshot = next;
        this.applyLauncherBadgeStatus(badge, readinessToBadge(next.readiness));
        item.dataset.availability = next.readiness;
        refreshUpdateBtnVisibility(next);
        setTooltip(item, this.buildLauncherTooltip(script, next), {
          placement: 'top',
          classes: ['preset-script-tooltip'],
        });
      });
    }

    item.addEventListener('click', () => {
      this.closePresetScriptsMenu();

      const current = snapshot;
      if (current?.readiness === 'not-installed') {
        this.openLauncherInstallModal(script, entry, current);
        return;
      }
      if (current?.readiness === 'update-available') {
        // The CLI is functional, so we still let the launcher run, but
        // surface the upgrade path through a non-blocking notice. Users
        // can disable this via the `checkAiLauncherUpdates` setting if
        // they find it noisy.
        const local = current.local ?? '?';
        const latest = current.latest ?? '?';
        new Notice(t('notices.presetScript.launcherUpdateAvailable', {
          name: script.name || entry.presetId,
          local,
          latest,
        }), 5000);
      }

      this.runPresetScript(script).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(t('notices.presetScript.runFailed', { message }));
      });
    });

    return item;
  }

  /**
   * Run all probes for one launcher (PATH + version + optional registry)
   * and update the cached snapshot in place. Returns the new snapshot so
   * callers can re-render without re-querying the Map.
   */
  private async refreshSingleLauncherSnapshot(
    entry: AiLauncherCatalogEntry,
  ): Promise<AiLauncherStatusSnapshot | null> {
    if (!entry.detectCommand) return null;
    const command = entry.detectCommand;
    const checkUpdates =
      this.settings.checkAiLauncherUpdates === true
      && this.settings.serverConnection?.offlineMode !== true;

    const probe = await this.probeLauncher(command);
    const nodeRuntime = await this.detectNodeRuntimeForLauncher(entry, probe.pathAvailable, probe.localVersion.version);
    this._aiLauncherAvailability.set(command, probe.pathAvailable);

    let latest: { version: string | null; error?: string } | null = null;
    if (checkUpdates && entry.versionRegistry) {
      try {
        latest = await fetchLatestVersion(entry.versionRegistry);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        latest = { version: null, error: message };
      }
    }

    const snapshot = buildAiLauncherStatusSnapshot({
      pathAvailable: probe.pathAvailable,
      local: { version: probe.localVersion.version, resolvedFrom: probe.localVersion.resolvedFrom },
      latest,
      nodeRuntime,
    });
    this.setAiLauncherSnapshot(entry.presetId, snapshot);
    return snapshot;
  }

  /**
   * Resolve a launcher's PATH availability and local version. Both
   * probes inherit the enriched login-shell PATH (see
   * {@link getEnrichedShellEnv}) so npm-installed CLIs registered
   * inside the user's shell profile — fnm, nvm, asdf, mise, volta,
   * scoop, brew, manual installs — are picked up uniformly without
   * Termy needing per-tool knowledge.
   */
  private async probeLauncher(command: string): Promise<{
    pathAvailable: CommandAvailability;
    localVersion: { version: string | null; resolvedFrom: string | null };
  }> {
    const [pathAvailable, localVersion] = await Promise.all([
      detectCommandAvailability(command).catch((): CommandAvailability => 'unknown'),
      probeCommandVersion(command).catch(() => ({
        version: null,
        resolvedFrom: null as string | null,
        rawOutput: null,
      })),
    ]);

    return {
      pathAvailable,
      localVersion: { version: localVersion.version, resolvedFrom: localVersion.resolvedFrom },
    };
  }

  private async detectNodeRuntimeForLauncher(
    entry: AiLauncherCatalogEntry,
    pathAvailable: CommandAvailability,
    localVersion: string | null,
  ): Promise<NodeRuntimeSnapshot | null> {
    if (!entry.npmPackage) return null;
    if (pathAvailable === 'ready' || localVersion) return null;
    try {
      const snapshot = await detectNodeRuntime({
        customNodePath: this.settings.customNodePath,
      });
      this._nodeRuntimeSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      errorLog('[TerminalPlugin] Failed to detect Node.js runtime:', error);
      return null;
    }
  }

  private getNodeRuntimeTerminalEnv(): Record<string, string> {
    // The env builder injects the fnm default-alias dir whenever no
    // custom Node path is configured AND fnm fallback was discovered,
    // so users in fnm-only environments get `node` / `npm` / global
    // npm CLIs in every Termy terminal without first running
    // `fnm env`. With a custom Node.js path set, the explicit choice
    // wins instead.
    const env = buildNodeRuntimeEnvironment(this._nodeRuntimeSnapshot);
    return Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }

  async refreshNodeRuntimeSnapshot(options: { force?: boolean } = {}): Promise<NodeRuntimeSnapshot | null> {
    try {
      if (options.force) {
        clearNodeRuntimeCache();
      }
      const snapshot = await detectNodeRuntime({
        customNodePath: this.settings.customNodePath,
      });
      this._nodeRuntimeSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      errorLog('[TerminalPlugin] Failed to refresh Node.js runtime status:', error);
      return null;
    }
  }

  getNodeRuntimeSnapshot(): NodeRuntimeSnapshot | null {
    return this._nodeRuntimeSnapshot;
  }

  /**
   * Pre-warm caches that the AI launcher menu and terminal env
   * injection rely on. The enriched login-shell PATH probe must
   * complete first so all subsequent probes — and the terminal env
   * builder — see the same view of `PATH` the user has in their own
   * shell. Runs on plugin load and from settings refresh.
   */
  async warmRuntimeAndLaunchers(options: { force?: boolean } = {}): Promise<void> {
    if (options.force) {
      clearEnrichedShellEnvCache();
      clearCommandAvailabilityCache();
      clearCommandVersionCache();
    }
    // Wait for the enriched PATH harvest before touching the launcher
    // probes; the timeout inside the harvest caps this at 3 s.
    await getEnrichedShellEnv().catch((error) => {
      errorLog('[TerminalPlugin] Enriched shell PATH probe failed:', error);
      return null;
    });
    await Promise.all([
      this.refreshNodeRuntimeSnapshot({ force: options.force }).catch((error) => {
        errorLog('[TerminalPlugin] Failed to refresh Node.js runtime status:', error);
      }),
      this.refreshAiLauncherAvailability().catch((error) => {
        errorLog('[TerminalPlugin] Failed to refresh AI launcher availability:', error);
      }),
    ]);
  }

  /**
   * Build the launcher row tooltip. Falls back to the existing workflow
   * tooltip when no snapshot is available, so users never see less info
   * than before this feature landed.
   */
  private buildLauncherTooltip(
    script: PresetScript,
    snapshot: AiLauncherStatusSnapshot | null | undefined,
  ): string {
    const base = this.buildPresetScriptTooltip(script);
    if (!snapshot || (!snapshot.local && !snapshot.latest)) {
      return base;
    }
    const lines: string[] = [];
    if (snapshot.local) lines.push(t('settingsDetails.terminal.aiLauncherTooltipInstalled', { version: snapshot.local }));
    if (snapshot.latest) lines.push(t('settingsDetails.terminal.aiLauncherTooltipLatest', { version: snapshot.latest }));
    if (snapshot.resolvedFrom) lines.push(t('settingsDetails.terminal.aiLauncherTooltipResolvedFrom', { path: snapshot.resolvedFrom }));
    return `${base}\n${lines.join('\n')}`;
  }

  /**
   * Render the readiness badge for the Termy AI menu row. The badge starts
   * from the cached resolver state and refreshes asynchronously.
   */
  private createLauncherStatusBadge(status: AiLauncherStatus): HTMLElement {
    const badge = activeDocument.createElement('span');
    badge.className = 'preset-scripts-menu-status-badge';
    this.applyLauncherBadgeStatus(badge, status);
    return badge;
  }

  private applyLauncherBadgeStatus(badge: HTMLElement, status: AiLauncherStatus): void {
    badge.dataset.status = status;
    badge.classList.remove(
      'is-ready',
      'is-not-installed',
      'is-update-available',
      'is-checking',
    );
    switch (status) {
      case 'ready':
        badge.classList.add('is-ready');
        badge.textContent = t('settingsDetails.terminal.aiLauncherStatusReady');
        break;
      case 'not-installed':
        badge.classList.add('is-not-installed');
        badge.textContent = t('settingsDetails.terminal.aiLauncherStatusNotInstalled');
        break;
      case 'update-available':
        badge.classList.add('is-update-available');
        badge.textContent = t('settingsDetails.terminal.aiLauncherStatusUpdateAvailable');
        break;
      case 'checking':
      default:
        badge.classList.add('is-checking');
        badge.textContent = t('settingsDetails.terminal.aiLauncherStatusChecking');
        break;
    }
  }

  private openLauncherInstallModal(
    script: PresetScript,
    entry: AiLauncherCatalogEntry,
    snapshot: AiLauncherStatusSnapshot | CommandAvailability | null,
  ): void {
    const isSnapshot = (
      value: AiLauncherStatusSnapshot | CommandAvailability | null,
    ): value is AiLauncherStatusSnapshot => {
      return !!value && typeof value === 'object' && 'readiness' in value;
    };

    const localVersion = isSnapshot(snapshot) ? snapshot.local : null;
    const latestVersion = isSnapshot(snapshot) ? snapshot.latest : null;
    const updateAvailable = isSnapshot(snapshot) && snapshot.readiness === 'update-available';
    const upgradeCommand = updateAvailable ? getUpgradeCommandForPlatform(entry) : null;
    const installPlan = this.resolveLauncherInstallPlan(entry, isSnapshot(snapshot) ? snapshot : null);
    const installCommand = installPlan.command;

    const modal = new LauncherInstallModal(this.app, {
      name: script.name || t('settingsDetails.terminal.presetScriptsUnnamed'),
      command: entry.detectCommand ?? '',
      docsUrl: installPlan.docsUrl,
      installCommand,
      installCommandKind: installPlan.kind,
      upgradeCommand,
      localVersion,
      latestVersion,
      updateAvailable,
      nodeRuntime: isSnapshot(snapshot) ? snapshot.nodeRuntime : null,
      onRunAnyway: () => {
        this.runPresetScript(script).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(t('notices.presetScript.runFailed', { message }));
        });
      },
      // Wire up "Install now" only when we have an install command for
      // the current platform AND the launcher is actually missing. We
      // skip this hook in the update-available case so the modal's
      // primary CTA stays focused on the upgrade.
      onRunInstall:
        !updateAvailable && installCommand
          ? () => {
              void this.runLauncherCommand(script, entry, installCommand, 'install');
            }
          : undefined,
      onRunUpgrade: upgradeCommand
        ? () => {
            void this.runLauncherCommand(script, entry, upgradeCommand, 'upgrade');
          }
        : undefined,
    });
    modal.open();
  }

  private resolveLauncherInstallPlan(
    entry: AiLauncherCatalogEntry,
    snapshot: AiLauncherStatusSnapshot | null,
  ): {
    command: string | null;
    kind: 'launcher' | 'node-missing';
    docsUrl?: string;
  } {
    const fallback = getInstallCommandForPlatform(entry);
    if (!entry.npmPackage || snapshot?.readiness === 'update-available') {
      return {
        command: fallback,
        kind: 'launcher',
        docsUrl: entry.installDocsUrl,
      };
    }

    const recommendation = getNodeRuntimeRecommendation(snapshot?.nodeRuntime);
    if (recommendation === 'npm-ready') {
      return {
        command: buildNpmPackageInstallCommand(entry.npmPackage, snapshot?.nodeRuntime),
        kind: 'launcher',
        docsUrl: entry.installDocsUrl,
      };
    }
    if (recommendation === 'node-missing') {
      // Termy does not push any specific Node.js installer or version
      // manager on users — that decision belongs to them. The modal
      // points at the upstream Node.js download page; once Node.js is
      // installed and the user reopens Obsidian (or hits Refresh), the
      // enriched login-shell PATH harvest picks the install up
      // automatically, regardless of whether the user chose fnm, nvm,
      // asdf, mise, volta, or a direct download.
      return {
        command: null,
        kind: 'node-missing',
        docsUrl: getNodeDownloadUrl(),
      };
    }

    return {
      command: fallback,
      kind: 'launcher',
      docsUrl: entry.installDocsUrl ?? getNodeDownloadUrl(),
    };
  }

  /**
   * Run a catalog-supplied install or upgrade command in a fresh Termy
   * terminal. The user clicked "Install now" or "Update now" from the
   * install modal, so we already have explicit consent to execute —
   * Termy types the command into a new terminal session and presses
   * Enter, exactly as if the user had typed it themselves.
   *
   * Because the command runs in a user-visible PTY we cannot wait on
   * its exit code, so we kick off a short watchdog poll: re-probe the
   * local version every few seconds and broadcast the new snapshot the
   * moment the readiness changes. That way the settings page row, the
   * status-bar menu badge, and the "Update now" / "Install now" button
   * all flip back to "Ready" without the user having to reopen
   * anything.
   */
  private async runLauncherCommand(
    script: PresetScript,
    entry: AiLauncherCatalogEntry,
    command: string,
    intent: 'install' | 'upgrade',
  ): Promise<void> {
    try {
      await this.activateTerminalView(this.getLeafForNewTerminal());
      const terminalView = this.getActiveTerminalView();
      if (!terminalView) {
        new Notice(t('notices.presetScript.terminalUnavailable'));
        return;
      }

      const terminal = await terminalView.waitForTerminalInstance();
      const title = intent === 'install'
        ? t('settingsDetails.terminal.aiLauncherTitleInstall', { name: script.name || entry.presetId })
        : t('settingsDetails.terminal.aiLauncherTitleUpdate', { name: script.name || entry.presetId });
      terminal.setTitle(title);
      this.updateLeafHeader(terminalView.leaf);

      // Capture the version we'd consider "stale" — anything different
      // from this signals the upgrade landed. Always null for install.
      const before =
        intent === 'upgrade'
          ? this._aiLauncherSnapshots.get(entry.presetId)?.local ?? null
          : null;

      const normalized = this.normalizePresetScriptCommand(command);
      terminal.write(normalized);
      this.focusTerminalView(terminalView, terminal);

      // Watchdog: poll the local probe (cheap — just spawns
      // `<cmd> --version`) until the readiness flips or we hit the cap.
      this.startUpgradeWatchdog(entry, before, intent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('notices.presetScript.runFailed', { message }));
    }
  }

  /**
   * Poll the local version probe after an upgrade command has been
   * dispatched into a Termy terminal. Stops on:
   *
   *   - the snapshot leaves `update-available` (success — local caught
   *     up with latest, or the user was already on latest before
   *     clicking Update);
   *   - {@link UPGRADE_WATCHDOG_TIMEOUT_MS} elapses (give-up — upgrade
   *     never finished, network dropped, user cancelled the install);
   *   - the user dispatches another upgrade for the same launcher (the
   *     new watchdog supersedes this one).
   *
   * Cadence: a single 5-second tick. Frequent enough that a successful
   * upgrade flips the UI within a few seconds of finishing, but cheap
   * enough that a stuck/cancelled upgrade only spawns ~24 probes
   * before the timeout cuts it off.
   */
  private _upgradeWatchdogTimers: Map<string, number> = new Map();

  private startUpgradeWatchdog(
    entry: AiLauncherCatalogEntry,
    versionBeforeUpgrade: string | null,
    intent: 'install' | 'upgrade' = 'upgrade',
  ): void {
    if (!entry.detectCommand) return;
    const command = entry.detectCommand;

    // If a previous watchdog is already running for this launcher,
    // cancel it. The most recent click wins.
    this.stopUpgradeWatchdog(entry.presetId);

    const POLL_INTERVAL_MS = 5_000;
    const TIMEOUT_MS = 2 * 60 * 1000;
    const startedAt = Date.now();

    const scheduleNextTick = (): void => {
      // Stopped? Some other code path tore us down — bail.
      if (!this._upgradeWatchdogTimers.has(entry.presetId)) return;

      if (Date.now() - startedAt >= TIMEOUT_MS) {
        this.stopUpgradeWatchdog(entry.presetId);
        return;
      }
      const timer = window.setTimeout(tick, POLL_INTERVAL_MS);
      this._upgradeWatchdogTimers.set(entry.presetId, timer);
    };

    const tick = (): void => {
      // Always drop the local probe + registry caches so the resolver
      // re-queries instead of returning the pre-upgrade values.
      clearCommandVersionCache(command);
      clearLatestVersionCache();

      void this.refreshSingleLauncherSnapshot(entry).then((snapshot) => {
        if (!snapshot) {
          // Probe failed — treat as a transient and retry on schedule.
          scheduleNextTick();
          return;
        }
        // Success criteria: the launcher is no longer flagged as
        // update-available. This covers both "upgrade landed" and "the
        // user was already on the latest version when they clicked
        // Update" (e.g. they wanted to test the flow). For the latter
        // we still log a friendly notice so the click feels acknowledged.
        if (snapshot.readiness !== 'update-available') {
          this.stopUpgradeWatchdog(entry.presetId);
          if (intent === 'install') {
            if (snapshot.local) {
              new Notice(t('notices.presetScript.launcherInstalled', {
                name: entry.presetId,
                version: snapshot.local,
              }));
            }
          } else if (snapshot.local && snapshot.local !== versionBeforeUpgrade) {
            new Notice(t('notices.presetScript.launcherUpdated', {
              name: entry.presetId,
              version: snapshot.local,
            }));
          } else if (snapshot.local) {
            new Notice(t('notices.presetScript.launcherOnLatest', {
              name: entry.presetId,
              version: snapshot.local,
            }));
          }
          return;
        }
        scheduleNextTick();
      }).catch(() => {
        scheduleNextTick();
      });
    };

    // Seed the map so concurrent calls see we're running, then run an
    // immediate tick — the badge flips to "Checking…" right away.
    this._upgradeWatchdogTimers.set(entry.presetId, 0);
    tick();
  }

  private stopUpgradeWatchdog(presetId: string): void {
    const timer = this._upgradeWatchdogTimers.get(presetId);
    if (timer === undefined) return;
    if (timer !== 0) {
      window.clearTimeout(timer);
    }
    this._upgradeWatchdogTimers.delete(presetId);
  }

  /**
   * Render the legacy reorderable workflow rows. These are workflows that
   * are NOT part of the AI launcher catalog (e.g. user-defined entries).
   * The behavior is unchanged from before the catalog refactor.
   */
  private appendRegularPresetMenuItems(
    listEl: HTMLElement,
    scripts: PresetScript[],
  ): void {
    let draggedItem: HTMLElement | null = null;
    let draggedScriptId: string | null = null;

    scripts.forEach((script) => {
      const item = activeDocument.createElement('div');
      item.className = 'preset-scripts-menu-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('draggable', 'true');
      item.dataset.scriptId = script.id;

      const dragHandle = activeDocument.createElement('div');
      dragHandle.className = 'preset-scripts-menu-drag-handle';
      setIcon(dragHandle, 'grip-vertical');
      item.appendChild(dragHandle);

      const iconEl = activeDocument.createElement('div');
      iconEl.className = 'preset-scripts-menu-icon';
      renderPresetScriptIcon(iconEl, script.icon || 'terminal');
      item.appendChild(iconEl);

      const labelEl = activeDocument.createElement('div');
      labelEl.className = 'preset-scripts-menu-label';
      labelEl.textContent = script.name || t('settingsDetails.terminal.presetScriptsUnnamed');
      item.appendChild(labelEl);

      setTooltip(item, this.buildPresetScriptTooltip(script), {
        placement: 'top',
        classes: ['preset-script-tooltip'],
      });

      const actionsEl = activeDocument.createElement('div');
      actionsEl.className = 'preset-scripts-menu-actions';

      const editBtn = activeDocument.createElement('button');
      editBtn.className = 'preset-scripts-menu-action-btn';
      editBtn.setAttribute('aria-label', t('modals.presetScript.titleEdit'));
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closePresetScriptsMenu();
        this.openPresetScriptEditModal(script);
      });
      actionsEl.appendChild(editBtn);

      const isBuiltIn = DEFAULT_PRESET_SCRIPTS.some(d => d.id === script.id);
      if (!isBuiltIn) {
        const deleteBtn = activeDocument.createElement('button');
        deleteBtn.className = 'preset-scripts-menu-action-btn preset-scripts-menu-action-delete';
        deleteBtn.setAttribute('aria-label', t('common.delete'));
        setIcon(deleteBtn, 'trash');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closePresetScriptsMenu();
          const scriptName = script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed');
          this.confirmAndDeletePresetScript(script.id, scriptName);
        });
        actionsEl.appendChild(deleteBtn);
      }
      item.appendChild(actionsEl);

      item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        draggedScriptId = script.id;
        item.addClass('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', script.id);
        }
      });

      item.addEventListener('dragend', () => {
        if (draggedItem) {
          draggedItem.removeClass('is-dragging');
        }
        draggedItem = null;
        draggedScriptId = null;
        listEl.querySelectorAll('.preset-scripts-menu-item').forEach(el => {
          (el as HTMLElement).removeClass('drag-over-above');
          (el as HTMLElement).removeClass('drag-over-below');
        });
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedItem || draggedScriptId === script.id) return;
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        listEl.querySelectorAll('.preset-scripts-menu-item').forEach(el => {
          (el as HTMLElement).removeClass('drag-over-above');
          (el as HTMLElement).removeClass('drag-over-below');
        });
        if (e.clientY < midY) {
          item.addClass('drag-over-above');
        } else {
          item.addClass('drag-over-below');
        }
      });

      item.addEventListener('dragleave', () => {
        item.removeClass('drag-over-above');
        item.removeClass('drag-over-below');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.removeClass('drag-over-above');
        item.removeClass('drag-over-below');
        if (!draggedScriptId || draggedScriptId === script.id) return;

        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        this.reorderPresetScript(draggedScriptId, script.id, insertBefore);
      });

      item.addEventListener('click', () => {
        this.closePresetScriptsMenu();
        this.runPresetScript(script).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(t('notices.presetScript.runFailed', { message }));
        });
      });

      listEl.appendChild(item);
    });
  }

  private reorderPresetScript(draggedId: string, targetId: string, insertBefore: boolean): void {
    const scripts = [...(this.settings.presetScripts ?? [])];
    const draggedIndex = scripts.findIndex(s => s.id === draggedId);
    if (draggedIndex < 0) return;

    const [dragged] = scripts.splice(draggedIndex, 1);
    let targetIndex = scripts.findIndex(s => s.id === targetId);
    if (targetIndex < 0) {
      scripts.push(dragged);
    } else {
      if (!insertBefore) {
        targetIndex += 1;
      }
      scripts.splice(targetIndex, 0, dragged);
    }

    this.settings.presetScripts = scripts;
    void this.saveSettings();
    // Rebuild the menu to reflect new order
    this.closePresetScriptsMenu();
    const anchorRect = this._statusBarItem?.getBoundingClientRect();
    if (anchorRect) {
      this.showPresetScriptsMenuAtRect(anchorRect);
    }
  }

  private closePresetScriptsMenu(): void {
    if (this._presetScriptsMenuCleanup) {
      this._presetScriptsMenuCleanup();
      this._presetScriptsMenuCleanup = null;
    }
    if (this._presetScriptsMenuEl) {
      this._presetScriptsMenuEl.remove();
      this._presetScriptsMenuEl = null;
    }
  }

  private async runPresetScript(script: PresetScript): Promise<void> {
    if (!script) {
      new Notice(t('notices.presetScript.notFound'));
      return;
    }

    const normalizedScript = this.normalizePresetScript(script);
    const actions = normalizedScript.actions.filter((action) => action.enabled !== false);
    if (actions.length === 0) {
      new Notice(t('notices.presetScript.emptyCommand'));
      return;
    }

    this.runWorkflowNonTerminalActions(actions);

    const terminalCommand = this.buildWorkflowTerminalCommand(actions);
    if (!terminalCommand) {
      return;
    }

    let terminalView = this.getActiveTerminalView();
    if (normalizedScript.runInNewTerminal) {
      await this.activateTerminalView(this.getLeafForNewTerminal());
      terminalView = this.getActiveTerminalView();
    } else if (normalizedScript.autoOpenTerminal && !terminalView) {
      await this.activateTerminalView();
      terminalView = this.getActiveTerminalView();
    }

    if (!terminalView) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }

    const terminal = await terminalView.waitForTerminalInstance();
    const title = (normalizedScript.terminalTitle || '').trim();
    if (title) {
      terminal.setTitle(title);
      this.updateLeafHeader(terminalView.leaf);
    }
    const normalizedCommand = this.normalizePresetScriptCommand(terminalCommand);
    terminal.write(normalizedCommand);
    this.focusTerminalView(terminalView, terminal);
  }

  private buildWorkflowTerminalCommand(actions: PresetWorkflowAction[]): string {
    return actions
      .filter((action) => action.type === 'terminal-command')
      .map((action) => action.value.trim())
      .filter((value) => value.length > 0)
      .join('\n');
  }

  private runWorkflowNonTerminalActions(actions: PresetWorkflowAction[]): void {
    const nonTerminalActions = actions.filter((action) => action.type !== 'terminal-command');
    for (const action of nonTerminalActions) {
      if (action.type === 'obsidian-command') {
        this.runObsidianCommandAction(action.value);
        continue;
      }
      if (action.type === 'open-external') {
        void this.runOpenExternalAction(action.value);
      }
    }
  }

  private runObsidianCommandAction(commandId: string): void {
    const normalizedCommandId = commandId.trim();
    if (!normalizedCommandId) {
      throw new Error('Workflow action "obsidian-command" requires command ID');
    }
    const openTerminalCommandId = `${this.manifest.id}:open-terminal`;
    if (normalizedCommandId === openTerminalCommandId || normalizedCommandId === 'open-terminal') {
      void this.activateTerminalView();
      return;
    }

    if (this.isTermyTerminalContextCommand(normalizedCommandId) && !this.getActiveTerminalView()) {
      void this.activateTerminalView();
    }

    const appWithCommands = this.app as typeof this.app & {
      commands?: {
        executeCommandById: (id: string) => boolean;
      };
    };
    if (!appWithCommands.commands) {
      throw new Error('Obsidian command manager is unavailable');
    }
    const executed = appWithCommands.commands.executeCommandById(normalizedCommandId);
    if (!executed) {
      throw new Error(`Obsidian command cannot execute in current context: ${normalizedCommandId}`);
    }
  }

  private isTermyTerminalContextCommand(commandId: string): boolean {
    const prefix = `${this.manifest.id}:terminal-`;
    return commandId.startsWith(prefix);
  }

  private async runOpenExternalAction(url: string): Promise<void> {
    const targetUrl = url.trim();
    if (!targetUrl) {
      throw new Error('Workflow action "open-external" requires a URL');
    }
    await shell.openExternal(targetUrl);
  }

  private normalizePresetScriptCommand(command: string): string {
    const normalized = command.replace(/\r?\n/g, '\r').trimEnd();
    return normalized.endsWith('\r') ? normalized : `${normalized}\r`;
  }

  private updateLeafHeader(leaf: WorkspaceLeaf): void {
    const leafWithHeader = leaf as WorkspaceLeaf & { updateHeader?: () => void };
    leafWithHeader.updateHeader?.();
  }

  /**
   * Get the absolute path to the plugin directory
   * 
   * @returns The absolute path to the plugin directory
   */
  getPluginDir(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error('FileSystemAdapter is not available');
    }
    const vaultPath = normalizePath(adapter.getBasePath());
    const configDir = normalizePath(this.app.vault.configDir);
    const manifestDir = this.manifest.dir
      ? normalizePath(this.manifest.dir)
      : normalizePath(`${configDir}/plugins/${this.manifest.id}`);

    if (this.isAbsolutePath(manifestDir)) {
      return manifestDir;
    }

    return normalizePath(`${vaultPath}/${manifestDir}`);
  }

  private isAbsolutePath(path: string): boolean {
    return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
  }
}

/**
 * Terminal view placeholder
 * Used to lazy-load the terminal view and avoid loading xterm.js at startup
 */
class TerminalViewPlaceholder extends TerminalView {
  private plugin: TerminalPlugin;
  private initialized = false;
  private initializing = false;

  constructor(leaf: WorkspaceLeaf, plugin: TerminalPlugin) {
    // Inject TerminalService lazily to avoid loading xterm.js at startup
    super(leaf, null);
    this.plugin = plugin;
  }

  async onOpen() {
    if (this.initialized || this.initializing) return;
    this.initializing = true;
    const pendingTerminal = this.plugin.consumePendingRestoredTerminal(this.leaf);

    // Show the loading message
    this.contentEl.empty();
    this.contentEl.createEl('div', {
      text: t('terminal.loading'),
      cls: 'terminal-loading'
    });

    try {
      // Get the real TerminalService
      const terminalService = await this.plugin.getTerminalService();

      this.setTerminalService(terminalService);

      // Clear the placeholder content and initialize the terminal view
      this.contentEl.empty();
      await super.onOpen();
      if (pendingTerminal) {
        this.adoptTerminalInstance(pendingTerminal);
      }
      this.initialized = true;
    } catch (error) {
      errorLog('[TerminalViewPlaceholder] Failed to initialize:', error);
      this.contentEl.empty();
      this.contentEl.createEl('div', { 
        text: t('terminal.initFailed', { message: error instanceof Error ? error.message : String(error) }),
        cls: 'terminal-error'
      });
    } finally {
      this.initializing = false;
    }
  }

  async onClose() {
    await super.onClose();
  }
}
