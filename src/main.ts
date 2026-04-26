import type { View, WorkspaceLeaf } from 'obsidian';
import { addIcon, FileSystemAdapter, Notice, Plugin, normalizePath } from 'obsidian';
import {
  DEFAULT_TERMINAL_SETTINGS,
  type PresetScript,
  type PresetWorkflowAction,
  type TerminalSettings,
} from './settings/settings';
import { PresetScriptModal } from './ui/terminal/presetScriptModal';
import { PRESET_SCRIPT_ICON_OPTIONS, renderPresetScriptIcon } from './ui/terminal/presetScriptIcons';
import { TerminalSettingTab } from './settings/settingsTab';
import type { TerminalService } from './services/terminal/terminalService';
import type { ServerManager } from './services/server/serverManager';
import type { ClaudeCodeIdeBridge } from './services/claudeCode/ideBridge';
import type { AgentContextBridge } from './services/context/agentContextBridge';
import { DevPluginReloader } from './services/devPluginReloader';
import { TERMINAL_VIEW_TYPE, TerminalView } from './ui/terminal/terminalView';
import { ChangelogModal } from './ui/changelog/changelogModal';
import { i18n, t } from './i18n';
import { debugLog, errorLog } from './utils/logger';
import { createTermyLogoSvg, createTermyLogoSvgMarkup, TERMY_RIBBON_ICON_ID } from './ui/icons';
import { FeatureVisibilityManager } from './services/visibility';
import { shell } from 'electron';
import type { TerminalInstance } from './services/terminal/terminalInstance';
import { resolveChangelogSection } from './utils/changelog';
import embeddedChangelogContent from '../CHANGELOG.md';

// Import terminal styles

const REPOSITORY_URL = 'https://github.com/ZyphrZero/Termy';
const CHANGELOG_URL = `${REPOSITORY_URL}/blob/master/CHANGELOG.md`;
const EMBEDDED_CHANGELOG_SOURCE_PATH = 'CHANGELOG.md';

type ChangelogDetails = {
  requestedVersion: string;
  version: string;
  markdown: string;
  releaseUrl: string | null;
  fullChangelogUrl: string;
  sourcePath: string;
  exactMatch: boolean;
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
  private _claudeCodeIdeBridge: ClaudeCodeIdeBridge | null = null;
  private _agentContextBridge: AgentContextBridge | null = null;
  private _devPluginReloader: DevPluginReloader | null = null;
  private _changelogContentCache: string | null = null;
  private _changelogSectionCache: Map<string, ChangelogDetails> = new Map();
  
  // Status bar elements
  private _statusBarItem: HTMLElement | null = null;
  private _presetScriptsMenuEl: HTMLElement | null = null;
  private _presetScriptsMenuCleanup: (() => void) | null = null;

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
    await this.initializeClaudeCodeIdeBridge();
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
            ...(this._claudeCodeIdeBridge?.getTerminalEnv() ?? {}),
            ...(this._agentContextBridge?.getTerminalEnv() ?? {}),
          })
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
    this.initializeDevPluginReloader();

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

    void this.initializeClaudeCodeIdeBridge().catch((error) => {
      errorLog('[TerminalPlugin] Failed to initialize Claude Code IDE bridge:', error);
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

    if (this._devPluginReloader) {
      this._devPluginReloader.stop();
      this._devPluginReloader = null;
    }

    // Clean up the feature visibility manager
    if (this.featureVisibilityManager) {
      this.featureVisibilityManager.cleanup();
    }

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

    if (this._claudeCodeIdeBridge) {
      try {
        debugLog('[TerminalPlugin] Shutting down Claude Code IDE bridge...');
        await this._claudeCodeIdeBridge.stop();
        debugLog('[TerminalPlugin] Claude Code IDE bridge stopped');
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to stop Claude Code IDE bridge:', error);
      }
    }

    if (this._agentContextBridge) {
      try {
        debugLog('[TerminalPlugin] Shutting down agent context bridge...');
        await this._agentContextBridge.stop();
        debugLog('[TerminalPlugin] Agent context bridge stopped');
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to stop agent context bridge:', error);
      }
    }

    debugLog(t('plugin.unloadedMessage'));
  }

  private async initializeClaudeCodeIdeBridge(): Promise<void> {
    if (!this._claudeCodeIdeBridge) {
      const { ClaudeCodeIdeBridge } = await import('./services/claudeCode/ideBridge');
      this._claudeCodeIdeBridge = new ClaudeCodeIdeBridge(this.app, this.manifest.version);
    }

    await this._claudeCodeIdeBridge.start();
  }

  private async initializeAgentContextBridge(): Promise<void> {
    if (!this._agentContextBridge) {
      const { AgentContextBridge } = await import('./services/context/agentContextBridge');
      this._agentContextBridge = new AgentContextBridge(this.app, this.getPluginDir());
    }

    await this._agentContextBridge.start();
  }

  private initializeDevPluginReloader(): void {
    try {
      this._devPluginReloader = new DevPluginReloader(
        this.app,
        this.manifest.id,
        this.getPluginDir()
      );
      this._devPluginReloader.start();
    } catch (error) {
      errorLog('[TerminalPlugin] Failed to initialize dev plugin reloader:', error);
    }
  }

  showChangelog(version = this.manifest.version): void {
    new ChangelogModal(this.app, this, version).open();
  }

  async getChangelogDetails(version = this.manifest.version): Promise<ChangelogDetails> {
    const normalizedVersion = version.trim();
    if (!normalizedVersion) {
      throw new Error('Plugin version is unavailable');
    }

    const cached = this._changelogSectionCache.get(normalizedVersion);
    if (cached) {
      return cached;
    }

    const changelogContent = await this.readChangelogContent();
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

    await this.getChangelogDetails(currentVersion);
    this.showChangelog(currentVersion);
    this.settings.lastSeenChangelogVersion = currentVersion;
    await this.saveData(this.settings);
  }

  private async readChangelogContent(): Promise<string> {
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
    const loaded = await this.loadData();
    const normalizedPresetScripts = Array.isArray(loaded?.presetScripts)
      ? loaded.presetScripts.map((script: PresetScript) => this.normalizePresetScript(script))
      : DEFAULT_TERMINAL_SETTINGS.presetScripts;
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
    this.settings.presetScripts = (this.settings.presetScripts ?? [])
      .map((script) => this.normalizePresetScript(script));
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
    const labelEl = document.createElement('span');
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
          void this.sendEditorSelectionToTerminal();
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
          void this.sendCurrentNoteToTerminal();
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
          if (!(currentScript.showInStatusBar ?? true)) {
            return false;
          }
          if (!checking) {
            this.runPresetScript(currentScript).catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(t('notices.presetScript.runFailed', { message }));
            });
          }
          return true;
        }
      });
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

  private async sendEditorSelectionToTerminal(): Promise<void> {
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

  private async sendCurrentNoteToTerminal(): Promise<void> {
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
    const emptyViews = document.querySelectorAll('.workspace-leaf-content[data-type="empty"] .view-content');
    
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
      const terminalAction = document.createElement('div');
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
    const { workspace } = this.app;
    const { leftSplit, rightSplit } = workspace;

    // If "create near existing terminals" is enabled
    if (this.settings.createInstanceNearExistingOnes) {
      const existingLeaves = workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
      const existingLeaf = existingLeaves[existingLeaves.length - 1];

      if (existingLeaf) {
        const root = existingLeaf.getRoot();

        // If it is in the left sidebar, keep creating in the left sidebar
        if (root === leftSplit) {
          const leftLeaf = workspace.getLeftLeaf(false);
          if (leftLeaf) return leftLeaf;
        }

        // If it is in the right sidebar, keep creating in the right sidebar
        if (root === rightSplit) {
          const rightLeaf = workspace.getRightLeaf(false);
          if (rightLeaf) return rightLeaf;
        }

        // If it is in the main area, make it the active leaf and create a new tab
        workspace.setActiveLeaf(existingLeaf);
        return workspace.getLeaf('tab');
      }
    }

    // Create a new leaf based on newInstanceBehavior
    const behavior = this.settings.newInstanceBehavior;

    switch (behavior) {
      case 'replaceTab':
        // Replace the current tab
        return workspace.getLeaf();

      case 'newTab':
        // New tab: create a new tab in the current tab group
        return workspace.getLeaf('tab');

      case 'newLeftTab': {
        // New tab on the left
        const leftLeaf = workspace.getLeftLeaf(false);
        return leftLeaf ?? workspace.getLeaf('split');
      }

      case 'newLeftSplit': {
        // New split on the left
        const leftLeaf = workspace.getLeftLeaf(true);
        return leftLeaf ?? workspace.getLeaf('split');
      }

      case 'newRightTab': {
        // New tab on the right
        const rightLeaf = workspace.getRightLeaf(false);
        return rightLeaf ?? workspace.getLeaf('split');
      }

      case 'newRightSplit': {
        // New split on the right
        const rightLeaf = workspace.getRightLeaf(true);
        return rightLeaf ?? workspace.getLeaf('split');
      }

      case 'newHorizontalSplit':
        // Horizontal split: create a split on the right
        return workspace.getLeaf('split', 'horizontal');

      case 'newVerticalSplit':
        // Vertical split: create a split below
        return workspace.getLeaf('split', 'vertical');

      case 'newWindow':
        // New window: open in a new window
        return workspace.getLeaf('window');

      default:
        // Default: horizontal split
        return workspace.getLeaf('split', 'vertical');
    }
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

    return {
      id: (script.id || '').trim(),
      sourceTemplateId: typeof script.sourceTemplateId === 'string' && script.sourceTemplateId.trim().length > 0
        ? script.sourceTemplateId.trim()
        : undefined,
      name: (script.name || '').trim(),
      icon: (script.icon || '').trim(),
      actions,
      terminalTitle: (script.terminalTitle || '').trim(),
      showInStatusBar: script.showInStatusBar !== false,
      autoOpenTerminal: script.autoOpenTerminal !== false,
      runInNewTerminal: script.runInNewTerminal === true,
    };
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

  private togglePresetScriptsMenu(event: MouseEvent): void {
    if (this._presetScriptsMenuEl) {
      this.closePresetScriptsMenu();
      return;
    }
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
    document.body.appendChild(menu);
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
    document.addEventListener('mousedown', onOutsideClick, true);
    document.addEventListener('keydown', onKeydown, true);
    this._presetScriptsMenuCleanup = () => {
      document.removeEventListener('mousedown', onOutsideClick, true);
      document.removeEventListener('keydown', onKeydown, true);
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
    const visibleScripts = scripts.filter(script => script.showInStatusBar ?? true);
    const menu = document.createElement('div');
    menu.className = 'preset-scripts-menu';
    menu.setAttribute('role', 'menu');

    if (visibleScripts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'preset-scripts-menu-item is-disabled';
      empty.textContent = t('settingsDetails.terminal.presetScriptsEmpty');
      menu.appendChild(empty);
    }

    visibleScripts.forEach((script) => {
      const item = document.createElement('div');
      item.className = 'preset-scripts-menu-item';
      item.setAttribute('role', 'menuitem');

      const iconEl = document.createElement('div');
      iconEl.className = 'preset-scripts-menu-icon';
      renderPresetScriptIcon(iconEl, script.icon || 'terminal');

      const labelEl = document.createElement('div');
      labelEl.className = 'preset-scripts-menu-label';
      labelEl.textContent = script.name || t('settingsDetails.terminal.presetScriptsUnnamed');

      item.appendChild(iconEl);
      item.appendChild(labelEl);
      item.addEventListener('click', () => {
        this.closePresetScriptsMenu();
        this.runPresetScript(script).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(t('notices.presetScript.runFailed', { message }));
        });
      });

      menu.appendChild(item);
    });

    const addItem = document.createElement('div');
    addItem.className = 'preset-scripts-menu-item preset-scripts-menu-add';
    addItem.setAttribute('role', 'menuitem');
    addItem.textContent = `+ ${t('settingsDetails.terminal.presetScriptsAddMenu')}`;
    addItem.addEventListener('click', () => {
      this.closePresetScriptsMenu();
      this.openPresetScriptCreateModal();
    });
    menu.appendChild(addItem);

    return menu;
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
    terminal.focus();
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
  private getPluginDir(): string {
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
