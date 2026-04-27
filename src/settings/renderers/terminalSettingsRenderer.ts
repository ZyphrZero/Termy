/**
 * Terminal settings renderer
 * Responsible for rendering all terminal-related settings
 */

import type { App, ColorComponent, DropdownComponent, TextComponent } from 'obsidian';
import { Modal, Setting, Notice, Platform, ToggleComponent, setIcon } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { RendererContext } from '../types';
import type { BinaryDownloadSource, PresetScript, ShellType, TerminalShellType } from '../settings';
import { 
  DEFAULT_PRESET_SCRIPTS,
  DEFAULT_SERVER_CONNECTION_SETTINGS,
  getCurrentPlatformShell, 
  isContextAwarePresetScript,
  setCurrentPlatformShell, 
  getCurrentPlatformCustomShellPath, 
  setCurrentPlatformCustomShellPath 
} from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';
import { PresetScriptModal } from '../../ui/terminal/presetScriptModal';
import { renderPresetScriptIcon } from '../../ui/terminal/presetScriptIcons';
import { clamp, normalizeBackgroundPosition, normalizeBackgroundSize, toCssUrl } from '../../utils/styleUtils';

const NEW_INSTANCE_BEHAVIORS = [
  'replaceTab',
  'newTab',
  'newLeftTab',
  'newLeftSplit',
  'newRightTab',
  'newRightSplit',
  'newHorizontalSplit',
  'newVerticalSplit',
  'newWindow',
] as const;

const CURSOR_STYLES = ['block', 'underline', 'bar'] as const;
const BACKGROUND_IMAGE_SIZES = ['cover', 'contain', 'auto'] as const;
const PREFERRED_RENDERERS = ['canvas', 'webgl'] as const;
const OPTIONAL_TERMINAL_SHELLS: TerminalShellType[] = ['tmux'];

type NewInstanceBehavior = (typeof NEW_INSTANCE_BEHAVIORS)[number];
type CursorStyle = (typeof CURSOR_STYLES)[number];
type BackgroundImageSize = (typeof BACKGROUND_IMAGE_SIZES)[number];
type PreferredRenderer = (typeof PREFERRED_RENDERERS)[number];

const isNewInstanceBehavior = (value: string): value is NewInstanceBehavior =>
  NEW_INSTANCE_BEHAVIORS.includes(value as NewInstanceBehavior);

const isCursorStyle = (value: string): value is CursorStyle =>
  CURSOR_STYLES.includes(value as CursorStyle);

const isBackgroundImageSize = (value: string): value is BackgroundImageSize =>
  BACKGROUND_IMAGE_SIZES.includes(value as BackgroundImageSize);

const isPreferredRenderer = (value: string): value is PreferredRenderer =>
  PREFERRED_RENDERERS.includes(value as PreferredRenderer);

type TerminalInstanceLike = {
  updateOptions: (options: { scrollback?: number }) => void;
  isAlive?: () => boolean;
  getCurrentRenderer?: () => 'canvas' | 'webgl';
};

type TerminalViewLike = {
  refreshAppearance?: () => void;
  getTerminalInstance?: () => TerminalInstanceLike | null;
};

const asTerminalViewLike = (value: unknown): TerminalViewLike | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as TerminalViewLike;
  if (typeof candidate.refreshAppearance === 'function') return candidate;
  if (typeof candidate.getTerminalInstance === 'function') return candidate;
  return null;
};

class ConfirmModal extends Modal {
  private message: string;
  private onConfirm: () => void;
  private onCancel: () => void;

  constructor(app: App, message: string, onConfirm: () => void, onCancel: () => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const titleEl = contentEl.createDiv({ cls: 'modal-title' });
    titleEl.createDiv({ cls: 'modal-title-text', text: t('common.confirm') });

    contentEl.createEl('p', { text: this.message });

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancelBtn = buttonContainer.createEl('button', {
      cls: 'mod-cancel',
      text: t('common.cancel')
    });
    cancelBtn.addEventListener('click', () => {
      this.onCancel();
      this.close();
    });

    const confirmBtn = buttonContainer.createEl('button', {
      cls: 'mod-cta',
      text: t('common.confirm')
    });
    confirmBtn.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const confirmAction = (app: App, message: string): Promise<boolean> =>
  new Promise((resolve) => {
    const modal = new ConfirmModal(
      app,
      message,
      () => resolve(true),
      () => resolve(false)
    );
    modal.open();
  });

/**
 * Validate whether the Shell path is valid (desktop only)
 * @param path Path to the Shell executable
 * @returns Whether the path exists and is valid
 */
function validateShellPath(path: string): boolean {
  if (!path || path.trim() === '') return false;
  // Mobile does not support filesystem checks
  if (Platform.isMobile) return true;
  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

const isTerminalShellType = (value: string): value is TerminalShellType =>
  OPTIONAL_TERMINAL_SHELLS.includes(value as TerminalShellType);

const TERMINAL_SHELL_COMMON_PATHS: Record<TerminalShellType, string[]> = {
  tmux: [
    '/opt/homebrew/bin/tmux',
    '/usr/local/bin/tmux',
    '/usr/bin/tmux',
    '/bin/tmux',
    'C:\\msys64\\usr\\bin\\tmux.exe',
    'C:\\Program Files\\Git\\usr\\bin\\tmux.exe',
  ],
};

function detectAvailableTerminalShells(): TerminalShellType[] {
  if (Platform.isMobile) return [];

  return OPTIONAL_TERMINAL_SHELLS.filter((shellType) =>
    isTerminalShellAvailable(shellType)
  );
}

function isTerminalShellAvailable(shellType: TerminalShellType): boolean {
  return commandExists(shellType)
    || TERMINAL_SHELL_COMMON_PATHS[shellType].some((candidate) => fs.existsSync(candidate));
}

function commandExists(command: string): boolean {
  const pathValue = process.env.PATH ?? '';
  if (!pathValue) return false;

  const pathEntries = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter(Boolean)
    : [''];

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, process.platform === 'win32' ? `${command}${extension}` : command);
      if (fs.existsSync(candidate)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Terminal settings renderer
 * Handles rendering for Shell program, instance behavior, theme, and appearance settings
 */
export class TerminalSettingsRenderer extends BaseSettingsRenderer {
  private themePreviewEl: HTMLElement | null = null;
  private themePreviewContentEl: HTMLElement | null = null;
  private rendererStatusEl: HTMLElement | null = null;
  private readonly builtInPresetIds = new Set(['claude-code', 'codex', 'opencode', 'gemini-cli']);

  /**
   * Render terminal settings
   * @param context Renderer context
   */
  render(context: RendererContext): void {
    this.context = context;
    const containerEl = context.containerEl;

    // Shell program settings card
    this.renderShellSettings(containerEl);

    // Instance behavior settings card
    this.renderInstanceBehaviorSettings(containerEl);

    // Preset scripts settings card
    this.renderPresetScriptsSettings(containerEl);

    // Theme settings card
    this.renderThemeSettings(containerEl);

    // Appearance settings card
    this.renderAppearanceSettings(containerEl);

    // Behavior settings card
    this.renderBehaviorSettings(containerEl);

    // Server connection settings card
    this.renderServerConnectionSettings(containerEl);

    // Feature visibility settings card
    this.renderVisibilitySettings(containerEl);
  }

  /**
   * Render Shell program settings
   */
  private renderShellSettings(containerEl: HTMLElement): void {
    const shellCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.shellSettings'))
      .setHeading();

    // Default Shell program selection
    const currentShell = getCurrentPlatformShell(this.context.plugin.settings);
    
    const shellDropdownSetting = new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultShell'))
      .setDesc(t('settingsDetails.terminal.defaultShellDesc'))
      .addDropdown(dropdown => {
        // Show different options based on the platform
        if (process.platform === 'win32') {
          dropdown.addOption('cmd', t('shellOptions.cmd'));
          dropdown.addOption('powershell', t('shellOptions.powershell'));
          dropdown.addOption('pwsh', t('shellOptions.pwsh'));
          dropdown.addOption('gitbash', t('shellOptions.gitbash'));
          dropdown.addOption('wsl', t('shellOptions.wsl'));
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
          dropdown.addOption('bash', t('shellOptions.bash'));
          dropdown.addOption('zsh', t('shellOptions.zsh'));
        }
        this.addDetectedTerminalShellOptions(dropdown, currentShell);
        dropdown.addOption('custom', t('shellOptions.custom'));

        dropdown.setValue(currentShell);
        dropdown.onChange((value) => {
          setCurrentPlatformShell(this.context.plugin.settings, value as ShellType);
          void this.saveSettings();
          
          // Use a partial update instead of a full refresh
          this.toggleConditionalSection(
            shellCard,
            'custom-shell-path',
            value === 'custom',
            (el) => this.renderCustomShellPathSetting(el),
            shellDropdownSetting.settingEl
          );
        });
      });

    // Custom program path (shown only when custom is selected) - initial render
    this.toggleConditionalSection(
      shellCard,
      'custom-shell-path',
      currentShell === 'custom',
      (el) => this.renderCustomShellPathSetting(el),
      shellDropdownSetting.settingEl
    );

    // Default launch arguments
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultArgs'))
      .setDesc(t('settingsDetails.terminal.defaultArgsDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.defaultArgsPlaceholder'))
        .setValue(this.context.plugin.settings.shellArgs.join(' '))
        .onChange((value) => {
          // Split the string into an array and filter out empty entries
          this.context.plugin.settings.shellArgs = value
            .split(' ')
            .filter(arg => arg.trim().length > 0);
          void this.saveSettings();
        }));

    // Automatically enter the vault directory
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.autoEnterVault'))
      .setDesc(t('settingsDetails.terminal.autoEnterVaultDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.autoEnterVaultDirectory)
        .onChange((value) => {
          this.context.plugin.settings.autoEnterVaultDirectory = value;
          void this.saveSettings();
        }));
  }

  /**
   * Render the custom Shell path setting
   * Extracted into a separate method for toggleConditionalSection
   */
  private renderCustomShellPathSetting(container: HTMLElement): void {
    const currentCustomPath = getCurrentPlatformCustomShellPath(this.context.plugin.settings);
    
    new Setting(container)
      .setName(t('settingsDetails.terminal.customShellPath'))
      .setDesc(t('settingsDetails.terminal.customShellPathDesc'))
      .addText(text => {
        text
          .setPlaceholder(t('settingsDetails.terminal.customShellPathPlaceholder'))
          .setValue(currentCustomPath)
          .onChange((value) => {
            setCurrentPlatformCustomShellPath(this.context.plugin.settings, value);
            void this.saveSettings();
            
            // Validate the path
            this.validateCustomShellPath(container, value);
          });
        
        // Initial validation
        setTimeout(() => {
          this.validateCustomShellPath(container, currentCustomPath);
        }, 0);
        
        return text;
      });
  }

  private addDetectedTerminalShellOptions(
    dropdown: DropdownComponent,
    currentShell: ShellType,
  ): void {
    const added = new Set<TerminalShellType>();
    const addOption = (shellType: TerminalShellType): void => {
      if (added.has(shellType)) return;
      dropdown.addOption(shellType, t(`shellOptions.${shellType}`));
      added.add(shellType);
    };

    if (isTerminalShellType(currentShell)) {
      addOption(currentShell);
    }

    for (const shellType of detectAvailableTerminalShells()) {
      addOption(shellType);
    }
    dropdown.setValue(currentShell);
  }

  /**
   * Render instance behavior settings
   */
  private renderInstanceBehaviorSettings(containerEl: HTMLElement): void {
    const instanceCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.instanceBehavior'))
      .setHeading();

    // New instance behavior
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.newInstanceLayout'))
      .setDesc(t('settingsDetails.terminal.newInstanceLayoutDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('replaceTab', t('layoutOptions.replaceTab'));
        dropdown.addOption('newTab', t('layoutOptions.newTab'));
        dropdown.addOption('newLeftTab', t('layoutOptions.newLeftTab'));
        dropdown.addOption('newLeftSplit', t('layoutOptions.newLeftSplit'));
        dropdown.addOption('newRightTab', t('layoutOptions.newRightTab'));
        dropdown.addOption('newRightSplit', t('layoutOptions.newRightSplit'));
        dropdown.addOption('newHorizontalSplit', t('layoutOptions.newHorizontalSplit'));
        dropdown.addOption('newVerticalSplit', t('layoutOptions.newVerticalSplit'));
        dropdown.addOption('newWindow', t('layoutOptions.newWindow'));

        dropdown.setValue(this.context.plugin.settings.newInstanceBehavior);
        dropdown.onChange((value) => {
          if (!isNewInstanceBehavior(value)) return;
          this.context.plugin.settings.newInstanceBehavior = value;
          void this.saveSettings();
        });
      });

    // Create near an existing terminal
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.createNearExisting'))
      .setDesc(t('settingsDetails.terminal.createNearExistingDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.createInstanceNearExistingOnes)
        .onChange((value) => {
          this.context.plugin.settings.createInstanceNearExistingOnes = value;
          void this.saveSettings();
        }));

    // Focus the new instance
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.focusNewInstance'))
      .setDesc(t('settingsDetails.terminal.focusNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.focusNewInstance)
        .onChange((value) => {
          this.context.plugin.settings.focusNewInstance = value;
          void this.saveSettings();
        }));

    // Lock the new instance
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.lockNewInstance'))
      .setDesc(t('settingsDetails.terminal.lockNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.lockNewInstance)
        .onChange((value) => {
          this.context.plugin.settings.lockNewInstance = value;
          void this.saveSettings();
        }));
  }

  /**
   * Render theme settings
   */
  private renderThemeSettings(containerEl: HTMLElement): void {
    const themeCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(themeCard)
      .setName(t('settingsDetails.terminal.themeSettings'))
      .setHeading();

    this.renderThemePreview(themeCard);
    this.renderRendererStatus(themeCard);

    // Use the Obsidian theme
    const useObsidianThemeSetting = new Setting(themeCard)
      .setName(t('settingsDetails.terminal.useObsidianTheme'))
      .setDesc(t('settingsDetails.terminal.useObsidianThemeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.useObsidianTheme)
        .onChange((value) => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.useObsidianTheme = value;
          }).then(() => {
            this.updateCustomColorSettingsVisibility(themeCard, useObsidianThemeSetting.settingEl);
          });
        }));

    this.updateCustomColorSettingsVisibility(themeCard, useObsidianThemeSetting.settingEl);
  }

  /**
   * Render preset scripts settings
   */
  private renderPresetScriptsSettings(containerEl: HTMLElement): void {
    const scriptCard = containerEl.createDiv({ cls: 'settings-card' });

    const headerEl = scriptCard.createDiv({ cls: 'preset-scripts-header' });
    const headerText = headerEl.createDiv({ cls: 'preset-scripts-header-text' });
    headerText.createDiv({
      cls: 'preset-scripts-title',
      text: t('settingsDetails.terminal.presetScripts')
    });
    headerText.createDiv({
      cls: 'preset-scripts-desc',
      text: t('settingsDetails.terminal.presetScriptsDesc')
    });

    const headerActions = headerEl.createDiv({ cls: 'preset-scripts-header-actions' });
    const addBtn = headerActions.createEl('button', { cls: 'preset-scripts-add-btn' });
    addBtn.textContent = t('settingsDetails.terminal.presetScriptsAdd');
    addBtn.addEventListener('click', () => {
          const newScript: PresetScript = {
            id: this.createPresetScriptId(),
            name: '',
            icon: '',
            actions: [
              {
                id: this.createPresetActionId(),
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
      this.openPresetScriptModal(newScript, true, listEl);
    });

    const listEl = scriptCard.createDiv({ cls: 'preset-scripts-list' });
    this.renderPresetScriptsList(listEl);
  }

  private renderPresetScriptsList(listEl: HTMLElement): void {
    listEl.empty();

    const scripts = this.context.plugin.settings.presetScripts ?? [];

    if (scripts.length === 0) {
      listEl.createDiv({
        cls: 'preset-scripts-empty',
        text: t('settingsDetails.terminal.presetScriptsEmpty')
      });
      return;
    }

    scripts.forEach((script, index) => {
      const row = listEl.createDiv({ cls: 'preset-script-row' });
      const isBuiltIn = this.isBuiltInPresetScript(script);
      const isContextAware = isContextAwarePresetScript(script);

      const toggleWrap = row.createDiv({ cls: 'preset-script-toggle' });
      const showInStatusBar = script.showInStatusBar ?? true;
      row.toggleClass('is-disabled', !showInStatusBar);
      const toggle = new ToggleComponent(toggleWrap);
      toggle.setValue(showInStatusBar);
      toggle.toggleEl.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptShowInStatusBar'));
      toggle.onChange((value) => {
        script.showInStatusBar = value;
        row.toggleClass('is-disabled', !value);
        void this.saveSettings();
      });

      const iconEl = row.createDiv({ cls: 'preset-script-icon' });
      renderPresetScriptIcon(iconEl, script.icon || 'terminal');

      const contentEl = row.createDiv({ cls: 'preset-script-content' });
      const nameRowEl = contentEl.createDiv({ cls: 'preset-script-name-row' });
      nameRowEl.createDiv({
        cls: 'preset-script-name',
        text: script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed')
      });
      if (isBuiltIn) {
        nameRowEl.createDiv({
          cls: 'preset-script-built-in-badge preset-script-row-built-in-badge',
          text: t('common.builtIn'),
        });
      }
      if (isContextAware) {
        nameRowEl.createDiv({
          cls: 'preset-script-context-badge',
          text: t('settingsDetails.advanced.contextAwareness'),
        });
      }
      contentEl.createDiv({
        cls: 'preset-script-command',
        text: this.getPresetScriptCommandPreview(script)
      });

      const actionsEl = row.createDiv({ cls: 'preset-script-actions' });

      const moveUpBtn = actionsEl.createEl('button', { cls: 'clickable-icon' });
      setIcon(moveUpBtn, 'arrow-up');
      moveUpBtn.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptsMoveUp'));
      moveUpBtn.disabled = index === 0;
      moveUpBtn.addEventListener('click', () => {
        if (index === 0) return;
        void this.movePresetScript(listEl, index, index - 1);
      });

      const moveDownBtn = actionsEl.createEl('button', { cls: 'clickable-icon' });
      setIcon(moveDownBtn, 'arrow-down');
      moveDownBtn.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptsMoveDown'));
      moveDownBtn.disabled = index === scripts.length - 1;
      moveDownBtn.addEventListener('click', () => {
        if (index >= scripts.length - 1) return;
        void this.movePresetScript(listEl, index, index + 1);
      });

      const editBtn = actionsEl.createEl('button', { cls: 'clickable-icon' });
      setIcon(editBtn, 'pencil');
      editBtn.setAttribute('aria-label', t('modals.presetScript.titleEdit'));
      editBtn.addEventListener('click', () => {
        this.openPresetScriptModal(this.clonePresetScript(script), false, listEl);
      });

      if (isBuiltIn) {
        const resetBtn = actionsEl.createEl('button', { cls: 'clickable-icon preset-script-reset' });
        setIcon(resetBtn, 'reset');
        resetBtn.setAttribute('aria-label', t('common.reset'));
        resetBtn.addEventListener('click', () => {
          const scriptName = script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed');
          void this.confirmPresetScriptReset(scriptName).then((confirmed) => {
            if (!confirmed) return;
            void this.resetBuiltInPresetScript(listEl, script.id);
          });
        });
      } else {
        const deleteBtn = actionsEl.createEl('button', { cls: 'clickable-icon preset-script-delete' });
        setIcon(deleteBtn, 'trash');
        deleteBtn.setAttribute('aria-label', t('common.delete'));
        deleteBtn.addEventListener('click', () => {
          const scriptName = script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed');
          void this.confirmPresetScriptDelete(scriptName).then((confirmed) => {
            if (!confirmed) return;

            this.context.plugin.settings.presetScripts = scripts.filter(item => item.id !== script.id);
            void this.saveSettings().then(() => {
              this.renderPresetScriptsList(listEl);
            });
          });
        });
      }

    });
  }

  private isBuiltInPresetScript(script: PresetScript): boolean {
    return this.builtInPresetIds.has(script.id);
  }

  private openPresetScriptModal(script: PresetScript, isNew: boolean, listEl: HTMLElement): void {
    const modal = new PresetScriptModal(this.context.app, script, (updatedScript) => {
      const scripts = this.context.plugin.settings.presetScripts ?? [];
      const index = scripts.findIndex(item => item.id === updatedScript.id);

      if (index >= 0) {
        scripts[index] = updatedScript;
      } else {
        scripts.push(updatedScript);
      }

      this.context.plugin.settings.presetScripts = scripts;
      void this.saveSettings().then(() => {
        this.renderPresetScriptsList(listEl);
      });
    }, isNew);

    modal.open();
  }

  private async movePresetScript(listEl: HTMLElement, from: number, to: number): Promise<void> {
    const scripts = this.context.plugin.settings.presetScripts ?? [];
    if (from < 0 || from >= scripts.length || to < 0 || to >= scripts.length) {
      return;
    }
    const updated = [...scripts];
    const [item] = updated.splice(from, 1);
    updated.splice(to, 0, item);
    this.context.plugin.settings.presetScripts = updated;
    await this.saveSettings();
    this.renderPresetScriptsList(listEl);
  }

  private createPresetScriptId(): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `preset-${Date.now()}-${random}`;
  }

  private createPresetActionId(): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `action-${Date.now()}-${random}`;
  }

  private getDefaultBuiltInPresetScript(scriptId: string): PresetScript | null {
    const script = DEFAULT_PRESET_SCRIPTS.find((item) => item.id === scriptId);
    return script ? this.clonePresetScript(script) : null;
  }

  private clonePresetScript(script: PresetScript): PresetScript {
    const actions = Array.isArray(script.actions)
      ? script.actions.map((action) => ({ ...action }))
      : [];
    return {
      ...script,
      actions,
    };
  }

  private async resetBuiltInPresetScript(listEl: HTMLElement, scriptId: string): Promise<void> {
    const defaultScript = this.getDefaultBuiltInPresetScript(scriptId);
    if (!defaultScript) {
      return;
    }

    const scripts = this.context.plugin.settings.presetScripts ?? [];
    const index = scripts.findIndex((script) => script.id === scriptId);
    if (index < 0) {
      return;
    }

    const updatedScripts = [...scripts];
    updatedScripts[index] = defaultScript;
    this.context.plugin.settings.presetScripts = updatedScripts;
    await this.saveSettings();
    this.renderPresetScriptsList(listEl);
  }

  private getPresetScriptCommandPreview(script: PresetScript): string {
    const actions = Array.isArray(script.actions) ? script.actions : [];
    const enabledActions = actions.filter((action) => action.enabled !== false);
    if (actions.length === 0) {
      return t('settingsDetails.terminal.presetScriptsEmptyCommand');
    }

    if (enabledActions.length === 0) {
      return t('settingsDetails.terminal.presetScriptsNoEnabledActions');
    }

    const first = enabledActions[0];
    const prefix = first.type === 'obsidian-command'
      ? 'Obsidian'
      : first.type === 'open-external'
        ? 'URL'
        : 'Terminal';
    const normalized = first.value.trim().replace(/\r?\n/g, ' \\n ');
    const suffix = enabledActions.length > 1 ? ` (+${enabledActions.length - 1})` : '';
    const preview = `${prefix}: ${normalized}${suffix}`;
    if (!normalized) {
      return t('settingsDetails.terminal.presetScriptsEmptyCommand');
    }
    return preview.length > 160 ? `${preview.slice(0, 157)}...` : preview;
  }

  /**
   * Render custom color settings content
   * Extracted into a separate method for toggleConditionalSection
   */
  private renderCustomColorSettingsContent(container: HTMLElement): void {
    let backgroundColorPicker: ColorComponent | null = null;
    let foregroundColorPicker: ColorComponent | null = null;

    // Background color
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundColor'))
      .setDesc(t('settingsDetails.terminal.backgroundColorDesc'))
      .addColorPicker(color => {
        backgroundColorPicker = color;
        return color
          .setValue(this.context.plugin.settings.backgroundColor || '#000000')
          .onChange((value) => {
            void this.updateThemeSetting(() => {
              this.context.plugin.settings.backgroundColor = value;
            });
          });
      })
      .addExtraButton(button => button
        .setIcon('reset')
        .setTooltip(t('common.reset'))
        .onClick(() => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.backgroundColor = undefined;
          }).then(() => {
            backgroundColorPicker?.setValue('#000000');
            new Notice(t('notices.settings.backgroundColorReset'));
          });
        }));

    // Foreground color
    new Setting(container)
      .setName(t('settingsDetails.terminal.foregroundColor'))
      .setDesc(t('settingsDetails.terminal.foregroundColorDesc'))
      .addColorPicker(color => {
        foregroundColorPicker = color;
        return color
          .setValue(this.context.plugin.settings.foregroundColor || '#FFFFFF')
          .onChange((value) => {
            void this.updateThemeSetting(() => {
              this.context.plugin.settings.foregroundColor = value;
            });
          });
      })
      .addExtraButton(button => button
        .setIcon('reset')
        .setTooltip(t('common.reset'))
        .onClick(() => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.foregroundColor = undefined;
          }).then(() => {
            foregroundColorPicker?.setValue('#FFFFFF');
            new Notice(t('notices.settings.foregroundColorReset'));
          });
        }));

    // Background image settings (WebGL mode will automatically fall back to Canvas)
    this.renderBackgroundImageSettings(container);
  }

  /**
   * Render background image settings
   */
  private renderBackgroundImageSettings(container: HTMLElement): void {
    const bgImageSetting = new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImage'))
      .setDesc(t('settingsDetails.terminal.backgroundImageDesc'));
    bgImageSetting.settingEl.addClass('terminal-background-image-setting');

    this.toggleConditionalSection(
      container,
      'background-image-webgl-hint',
      this.context.plugin.settings.preferredRenderer === 'webgl',
      (el) => {
        el.addClass('terminal-background-image-webgl-hint');
        el.createDiv({
          cls: 'setting-item-description',
          text: t('settingsDetails.terminal.backgroundImageWebglHint'),
        });
      },
      bgImageSetting.settingEl
    );

    let backgroundImageInput: TextComponent | null = null;

    bgImageSetting.addText(text => {
      backgroundImageInput = text;
      const inputEl = text
        .setPlaceholder(t('settingsDetails.terminal.backgroundImagePlaceholder'))
        .setValue(this.context.plugin.settings.backgroundImage || '')
        .onChange((value) => {
          this.context.plugin.settings.backgroundImage = value.trim() || undefined;
          this.updateThemePreview();
        });
      
      // Use a partial update on blur
      text.inputEl.addEventListener('blur', () => {
        void this.updateThemeSetting(() => {
          this.context.plugin.settings.backgroundImage = text.inputEl.value.trim() || undefined;
        }).then(() => {
          const hasImage = !!this.context.plugin.settings.backgroundImage;
          this.toggleConditionalSection(
            container,
            'background-image-options',
            hasImage,
            (el) => this.renderBackgroundImageOptionsContent(el),
            bgImageSetting.settingEl
          );
        });
      });
      
      return inputEl;
    });
    
    bgImageSetting.addExtraButton(button => button
      .setIcon('reset')
      .setTooltip(t('common.reset'))
      .onClick(() => {
        void this.updateThemeSetting(() => {
          this.context.plugin.settings.backgroundImage = undefined;
        }).then(() => {
          backgroundImageInput?.setValue('');
          
          // Use a partial update to remove background image options
          this.toggleConditionalSection(
            container,
            'background-image-options',
            false,
            (el) => this.renderBackgroundImageOptionsContent(el),
            bgImageSetting.settingEl
          );
          
          new Notice(t('notices.settings.backgroundImageCleared'));
        });
      }));

    // Background image-related options (shown only when a background image exists) - initial render
    this.toggleConditionalSection(
      container,
      'background-image-options',
      !!this.context.plugin.settings.backgroundImage,
      (el) => this.renderBackgroundImageOptionsContent(el),
      bgImageSetting.settingEl
    );
  }

  /**
   * Render background image-related options content
   * Extracted into a separate method for toggleConditionalSection
   */
  private renderBackgroundImageOptionsContent(container: HTMLElement): void {
    // Background image opacity
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImageOpacity'))
      .setDesc(t('settingsDetails.terminal.backgroundImageOpacityDesc'))
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.context.plugin.settings.backgroundImageOpacity ?? 0.5)
        .setDynamicTooltip()
        .onChange((value) => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.backgroundImageOpacity = value;
          });
        }));

    // Background image size
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImageSize'))
      .setDesc(t('settingsDetails.terminal.backgroundImageSizeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('cover', t('backgroundSizeOptions.cover'))
        .addOption('contain', t('backgroundSizeOptions.contain'))
        .addOption('auto', t('backgroundSizeOptions.auto'))
        .setValue(this.context.plugin.settings.backgroundImageSize || 'cover')
        .onChange((value) => {
          if (!isBackgroundImageSize(value)) {
            return;
          }
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.backgroundImageSize = value;
          });
        }));

    // Background image position
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImagePosition'))
      .setDesc(t('settingsDetails.terminal.backgroundImagePositionDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('center', t('backgroundPositionOptions.center'))
        .addOption('top', t('backgroundPositionOptions.top'))
        .addOption('bottom', t('backgroundPositionOptions.bottom'))
        .addOption('left', t('backgroundPositionOptions.left'))
        .addOption('right', t('backgroundPositionOptions.right'))
        .addOption('top left', t('backgroundPositionOptions.topLeft'))
        .addOption('top right', t('backgroundPositionOptions.topRight'))
        .addOption('bottom left', t('backgroundPositionOptions.bottomLeft'))
        .addOption('bottom right', t('backgroundPositionOptions.bottomRight'))
        .setValue(this.context.plugin.settings.backgroundImagePosition || 'center')
        .onChange((value) => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.backgroundImagePosition = value;
          });
        }));

    // Frosted glass effect
    const blurEffectSetting = new Setting(container)
      .setName(t('settingsDetails.terminal.blurEffect'))
      .setDesc(t('settingsDetails.terminal.blurEffectDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.enableBlur ?? false)
        .onChange((value) => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.enableBlur = value;
          });
          
          // Use a partial update instead of a full refresh
          this.toggleConditionalSection(
            container,
            'blur-amount-slider',
            value,
            (el) => this.renderBlurAmountSlider(el),
            blurEffectSetting.settingEl
          );
        }));

    // Frosted glass blur amount (shown only when the effect is enabled) - initial render
    this.toggleConditionalSection(
      container,
      'blur-amount-slider',
      this.context.plugin.settings.enableBlur ?? false,
      (el) => this.renderBlurAmountSlider(el),
      blurEffectSetting.settingEl
    );

    // Text opacity
    new Setting(container)
      .setName(t('settingsDetails.terminal.textOpacity'))
      .setDesc(t('settingsDetails.terminal.textOpacityDesc'))
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.context.plugin.settings.textOpacity ?? 1.0)
        .setDynamicTooltip()
        .onChange((value) => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.textOpacity = value;
          });
        }));
  }

  /**
   * Render the blur amount slider
   * Extracted into a separate method for toggleConditionalSection
   */
  private renderBlurAmountSlider(container: HTMLElement): void {
    new Setting(container)
      .setName(t('settingsDetails.terminal.blurAmount'))
      .setDesc(t('settingsDetails.terminal.blurAmountDesc'))
      .addSlider(slider => slider
        .setLimits(0, 20, 1)
        .setValue(this.context.plugin.settings.blurAmount ?? 10)
        .setDynamicTooltip()
        .onChange((value) => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.blurAmount = value;
          });
        }));
  }

  /**
   * Render appearance settings
   */
  private renderAppearanceSettings(containerEl: HTMLElement): void {
    const appearanceCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.appearanceSettings'))
      .setHeading();

    // Font size
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontSize'))
      .setDesc(t('settingsDetails.terminal.fontSizeDesc'))
      .addSlider(slider => slider
        .setLimits(8, 24, 1)
        .setValue(this.context.plugin.settings.fontSize)
        .setDynamicTooltip()
        .onChange((value) => {
          this.context.plugin.settings.fontSize = value;
          void this.saveSettings();
        }));

    // Font family
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontFamily'))
      .setDesc(t('settingsDetails.terminal.fontFamilyDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.fontFamilyPlaceholder'))
        .setValue(this.context.plugin.settings.fontFamily)
        .onChange((value) => {
          this.context.plugin.settings.fontFamily = value;
          void this.saveSettings();
        }));

    // Cursor style
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorStyle'))
      .setDesc(t('settingsDetails.terminal.cursorStyleDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('block', t('cursorStyleOptions.block'));
        dropdown.addOption('underline', t('cursorStyleOptions.underline'));
        dropdown.addOption('bar', t('cursorStyleOptions.bar'));

        dropdown.setValue(this.context.plugin.settings.cursorStyle);
        dropdown.onChange((value) => {
          if (!isCursorStyle(value)) return;
          this.context.plugin.settings.cursorStyle = value;
          void this.saveSettings();
        });
      });

    // Cursor blink
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorBlink'))
      .setDesc(t('settingsDetails.terminal.cursorBlinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.cursorBlink)
        .onChange((value) => {
          this.context.plugin.settings.cursorBlink = value;
          void this.saveSettings();
        }));

    // Renderer type
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.rendererType'))
      .setDesc(t('settingsDetails.terminal.rendererTypeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('canvas', t('rendererOptions.canvas'))
        .addOption('webgl', t('rendererOptions.webgl'))
        .setValue(this.context.plugin.settings.preferredRenderer)
        .onChange((value) => {
          if (!isPreferredRenderer(value)) {
            return;
          }
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.preferredRenderer = value;
          }).then(() => {
            this.updateBackgroundImageSettingsVisibility();
            new Notice(t('notices.settings.rendererUpdated'));
          });
        }));
  }

  /**
   * Update background image settings visibility
   * Only takes effect after custom theme settings have been rendered
   */
  private updateBackgroundImageSettingsVisibility(): void {
    const customColorContainer = this.context.containerEl.querySelector<HTMLElement>(
      '.conditional-section-custom-color-settings'
    );
    if (!customColorContainer) {
      return;
    }

    const bgImageSettingEl = customColorContainer.querySelector<HTMLElement>(
      '.terminal-background-image-setting'
    );
    if (!bgImageSettingEl) {
      return;
    }

    this.toggleConditionalSection(
      customColorContainer,
      'background-image-webgl-hint',
      this.context.plugin.settings.preferredRenderer === 'webgl',
      (el) => {
        el.addClass('terminal-background-image-webgl-hint');
        el.createDiv({
          cls: 'setting-item-description',
          text: t('settingsDetails.terminal.backgroundImageWebglHint'),
        });
      },
      bgImageSettingEl
    );
  }

  private updateCustomColorSettingsVisibility(themeCard: HTMLElement, insertAfter: HTMLElement): void {
    const shouldShow = !this.context.plugin.settings.useObsidianTheme;
    this.toggleConditionalSection(
      themeCard,
      'custom-color-settings',
      shouldShow,
      (el) => this.renderCustomColorSettingsContent(el),
      insertAfter
    );

    if (!shouldShow) {
      themeCard.querySelectorAll('.conditional-section-custom-color-settings')
        .forEach((el) => el.remove());
    }
  }

  private requestThemeRefresh(): void {
    const leaves = this.context.app.workspace.getLeavesOfType('terminal-view');
    leaves.forEach(leaf => {
      const view = asTerminalViewLike(leaf.view);
      view?.refreshAppearance?.();
    });
  }

  private applyScrollbackToOpenTerminals(scrollback: number): void {
    const leaves = this.context.app.workspace.getLeavesOfType('terminal-view');
    leaves.forEach(leaf => {
      const view = asTerminalViewLike(leaf.view);
      view?.getTerminalInstance?.()?.updateOptions({ scrollback });
    });
  }

  private async updateThemeSetting(update: () => void): Promise<void> {
    update();
    await this.saveSettings();
    this.updateThemePreview();
    this.updateRendererStatus();
    this.requestThemeRefresh();
  }

  private renderThemePreview(container: HTMLElement): void {
    const previewSection = container.createDiv({ cls: 'terminal-theme-preview-section' });
    previewSection.createDiv({
      cls: 'terminal-theme-preview-title',
      text: t('settingsDetails.terminal.themePreview'),
    });

    this.themePreviewEl = previewSection.createDiv({ cls: 'terminal-theme-preview' });
    this.themePreviewEl.createDiv({ cls: 'terminal-theme-preview-bg' });
    this.themePreviewContentEl = this.themePreviewEl.createDiv({ cls: 'terminal-theme-preview-content' });

    this.themePreviewContentEl.createDiv({ text: '$ echo "Termy"' });
    this.themePreviewContentEl.createDiv({ text: 'Termy' });
    this.themePreviewContentEl.createDiv({ text: '$ ls' });
    this.themePreviewContentEl.createDiv({ text: 'README.md  scripts  src  package.json' });
    this.themePreviewContentEl.createDiv({ text: '$' });

    this.updateThemePreview();
  }

  private renderRendererStatus(container: HTMLElement): void {
    const setting = new Setting(container)
      .setName(t('settingsDetails.terminal.rendererStatus'))
      .setDesc(t('settingsDetails.terminal.rendererStatusDesc'));

    this.rendererStatusEl = setting.controlEl.createDiv({ cls: 'terminal-renderer-status-value' });
    this.updateRendererStatus();
  }

  private updateRendererStatus(): void {
    if (!this.rendererStatusEl) return;

    const settings = this.context.plugin.settings;
    const preferred = settings.preferredRenderer;
    const hasBackgroundImage = !!settings.backgroundImage;
    const shouldFallback = !settings.useObsidianTheme && hasBackgroundImage;
    const predicted = preferred === 'webgl' && shouldFallback ? 'canvas' : preferred;

    let actualRenderer: 'canvas' | 'webgl' | null = null;
    const leaves = this.context.app.workspace.getLeavesOfType('terminal-view');
    for (const leaf of leaves) {
      const view = asTerminalViewLike(leaf.view);
      const instance = view?.getTerminalInstance?.() ?? null;
      if (instance?.isAlive?.() && instance.getCurrentRenderer) {
        actualRenderer = instance.getCurrentRenderer();
        break;
      }
    }

    const renderer = actualRenderer ?? predicted;
    const rendererLabel = renderer === 'webgl'
      ? t('rendererOptions.webgl')
      : t('rendererOptions.canvas');
    const sourceLabel = actualRenderer
      ? t('settingsDetails.terminal.rendererStatusLive')
      : t('settingsDetails.terminal.rendererStatusPredicted');
    const fallbackLabel = preferred === 'webgl' && renderer === 'canvas' && shouldFallback
      ? t('settingsDetails.terminal.rendererStatusFallback')
      : '';

    const suffix = fallbackLabel ? `${sourceLabel} · ${fallbackLabel}` : sourceLabel;
    this.rendererStatusEl.setText(`${rendererLabel}（${suffix}）`);
  }

  private updateThemePreview(): void {
    if (!this.themePreviewEl) return;
    const settings = this.context.plugin.settings;

    const useObsidianTheme = settings.useObsidianTheme;
    const backgroundColor = useObsidianTheme
      ? 'var(--background-primary)'
      : (settings.backgroundColor || '#000000');
    const foregroundColor = useObsidianTheme
      ? 'var(--text-normal)'
      : (settings.foregroundColor || '#FFFFFF');

    const showBackgroundImage = !useObsidianTheme
      && !!settings.backgroundImage;

    if (showBackgroundImage) {
      this.themePreviewEl.classList.add('has-background-image');
    } else {
      this.themePreviewEl.classList.remove('has-background-image');
    }

    const backgroundImageOpacity = settings.backgroundImageOpacity ?? 0.5;
    const overlayOpacity = showBackgroundImage
      ? clamp(1 - backgroundImageOpacity, 0, 1)
      : 0;
    const blurAmount = settings.blurAmount ?? 0;
    const blurEnabled = showBackgroundImage && settings.enableBlur && blurAmount > 0;

    this.applyThemePreviewStyleRule({
      backgroundColor,
      foregroundColor,
      backgroundImage: showBackgroundImage ? toCssUrl(settings.backgroundImage) : 'none',
      overlayOpacity,
      backgroundSize: normalizeBackgroundSize(settings.backgroundImageSize),
      backgroundPosition: normalizeBackgroundPosition(settings.backgroundImagePosition),
      blur: blurEnabled ? `${blurAmount}px` : '0px',
      scale: blurEnabled ? '1.05' : '1',
      textOpacity: showBackgroundImage ? String(settings.textOpacity ?? 1.0) : '1',
    });
  }

  private applyThemePreviewStyleRule(vars: {
    backgroundColor: string;
    foregroundColor: string;
    backgroundImage: string;
    overlayOpacity: number;
    backgroundSize: string;
    backgroundPosition: string;
    blur: string;
    scale: string;
    textOpacity: string;
  }): void {
    if (!this.themePreviewEl) return;
    const style = this.themePreviewEl.style;
    style.setProperty('--terminal-preview-bg', vars.backgroundColor);
    style.setProperty('--terminal-preview-fg', vars.foregroundColor);
    style.setProperty('--terminal-preview-bg-image', vars.backgroundImage);
    style.setProperty('--terminal-preview-bg-overlay-opacity', String(vars.overlayOpacity));
    style.setProperty('--terminal-preview-bg-size', vars.backgroundSize);
    style.setProperty('--terminal-preview-bg-position', vars.backgroundPosition);
    style.setProperty('--terminal-preview-bg-blur', vars.blur);
    style.setProperty('--terminal-preview-bg-scale', vars.scale);
    style.setProperty('--terminal-preview-text-opacity', vars.textOpacity);
  }

  /**
   * Render behavior settings
   */
  private renderBehaviorSettings(containerEl: HTMLElement): void {
    const behaviorCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.behaviorSettings'))
      .setHeading();

    // Scrollback buffer size
    new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.scrollback'))
      .setDesc(t('settingsDetails.terminal.scrollbackDesc'))
      .addText(text => {
      const inputEl = text
        .setPlaceholder('1000')
        .setValue(String(this.context.plugin.settings.scrollback))
        .onChange((value) => {
          // Save only while typing, without validation
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.context.plugin.settings.scrollback = numValue;
            void this.saveSettings();
            this.applyScrollbackToOpenTerminals(numValue);
          }
        });
      
      // Validate on blur
      text.inputEl.addEventListener('blur', () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 10000) {
          new Notice('⚠️ ' + t('notices.settings.scrollbackRangeError'));
          this.context.plugin.settings.scrollback = 1000;
          void this.saveSettings();
          text.setValue('1000');
          this.applyScrollbackToOpenTerminals(1000);
          return;
        }
        this.applyScrollbackToOpenTerminals(numValue);
      });
      
      return inputEl;
    });

  }

  /**
   * Validate the custom Shell path
   * @param containerEl Container element
   * @param path Shell path
   */
  private validateCustomShellPath(containerEl: HTMLElement, path: string): void {
    // Remove the previous validation message
    const existingValidation = containerEl.querySelector('.shell-path-validation');
    if (existingValidation) {
      existingValidation.remove();
    }
    
    // If the path is empty, do not show a validation message
    if (!path || path.trim() === '') {
      return;
    }
    
    // Create the validation message container
    const validationEl = containerEl.createDiv({
      cls: 'shell-path-validation setting-item-description terminal-settings-validation'
    });
    
    // Validate the path
    const isValid = validateShellPath(path);
    if (!validationEl.isConnected) return;

    if (isValid) {
      validationEl.setText(t('settingsDetails.terminal.pathValid'));
      validationEl.addClass('is-valid');
    } else {
      validationEl.setText(t('settingsDetails.terminal.pathInvalid'));
      validationEl.addClass('is-invalid');
    }
  }

  private confirmPresetScriptDelete(scriptName: string): Promise<boolean> {
    return confirmAction(
      this.context.app,
      t('settingsDetails.terminal.presetScriptsDeleteConfirm', { name: scriptName })
    );
  }

  private confirmPresetScriptReset(scriptName: string): Promise<boolean> {
    return confirmAction(
      this.context.app,
      t('settingsDetails.terminal.presetScriptsResetConfirm', { name: scriptName })
    );
  }

  /**
   * Render feature visibility settings
   */
  private renderVisibilitySettings(containerEl: HTMLElement): void {
    const visibilityCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(visibilityCard)
      .setName(t('visibility.visibilitySettings'))
      .setHeading();

    // Show in the command palette
    new Setting(visibilityCard)
      .setName(t('visibility.showInCommandPalette'))
      .setDesc(t('visibility.showInCommandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.visibility.showInCommandPalette)
        .onChange((value) => {
          this.context.plugin.settings.visibility.showInCommandPalette = value;
          void this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // Show the icon in the ribbon
    new Setting(visibilityCard)
      .setName(t('visibility.showInRibbon'))
      .setDesc(t('visibility.showInRibbonDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.visibility.showInRibbon)
        .onChange((value) => {
          this.context.plugin.settings.visibility.showInRibbon = value;
          void this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // Show in the new tab view
    new Setting(visibilityCard)
      .setName(t('visibility.showInNewTab'))
      .setDesc(t('visibility.showInNewTabDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.visibility.showInNewTab)
        .onChange((value) => {
          this.context.plugin.settings.visibility.showInNewTab = value;
          void this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // Show in the status bar
    new Setting(visibilityCard)
      .setName(t('visibility.showInStatusBar'))
      .setDesc(t('visibility.showInStatusBarDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.visibility.showInStatusBar)
        .onChange((value) => {
          this.context.plugin.settings.visibility.showInStatusBar = value;
          void this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // Debug settings card
    const debugCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(debugCard)
      .setName(t('settingsDetails.advanced.performanceAndDebug'))
      .setHeading();

    // Enable debug logging
    new Setting(debugCard)
      .setName(t('settingsDetails.advanced.debugMode'))
      .setDesc(t('settingsDetails.advanced.debugModeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.enableDebugLog)
        .onChange((value) => {
          this.context.plugin.settings.enableDebugLog = value;
          void this.saveSettings().then(() => {
            new Notice(value
              ? t('notices.settings.debugLogEnabled')
              : t('notices.settings.debugLogDisabled'));
          });
        }));
  }

  /**
   * Render server connection settings
   */
  private renderServerConnectionSettings(containerEl: HTMLElement): void {
    const connectionCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(connectionCard)
      .setName(t('settingsDetails.advanced.serverConnection'))
      .setDesc(t('settingsDetails.advanced.serverConnectionDesc'))
      .setHeading();

    // Render the settings content in a conditional section so it can refresh after reset
    this.toggleConditionalSection(
      connectionCard,
      'server-connection-settings',
      true,
      (el) => this.renderServerConnectionContent(el)
    );
  }

  /**
   * Render server connection settings content
   */
  private renderServerConnectionContent(containerEl: HTMLElement): void {
    const settings = this.context.plugin.settings;

    // Binary download source
    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.binaryDownloadSource'))
      .setDesc(t('settingsDetails.advanced.binaryDownloadSourceDesc'))
      .addDropdown((dropdown) => {
        dropdown.addOption(
          'github-release',
          t('settingsDetails.advanced.binaryDownloadSourceGithubRelease')
        );
        dropdown.addOption(
          'cloudflare-r2',
          t('settingsDetails.advanced.binaryDownloadSourceCloudflareR2')
        );
        dropdown
          .setValue(settings.serverConnection.binaryDownloadSource)
          .onChange((value) => {
            settings.serverConnection.binaryDownloadSource = value as BinaryDownloadSource;
            void this.saveSettings();

            void this.context.plugin.getServerManager()
              .then((serverManager) => {
                serverManager.updateBinaryDownloadConfig({
                  source: settings.serverConnection.binaryDownloadSource,
                });
              })
              .catch(() => {
                // ServerManager may not be initialized yet
              });
          });
      })
      .addButton((button) => {
        button
          .setButtonText(t('settingsDetails.advanced.binaryDownloadNow'))
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText(t('settingsDetails.advanced.binaryDownloadNowRunning'));

            try {
              const serverManager = await this.context.plugin.getServerManager();
              serverManager.updateBinaryDownloadConfig({
                source: settings.serverConnection.binaryDownloadSource,
              });

              const result = await serverManager.ensureBinaryUpdated();
              if (result === 'already-ready') {
                new Notice(t('notices.settings.binaryAlreadyUpToDate'));
              } else if (result === 'skipped-offline') {
                new Notice(t('notices.settings.binaryDownloadSkippedOffline'));
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(t('notices.settings.binaryDownloadFailed', { message }), 5000);
            } finally {
              button.setButtonText(t('settingsDetails.advanced.binaryDownloadNow'));
              button.setDisabled(false);
            }
          });
      });

    // Offline mode
    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.offlineMode'))
      .setDesc(t('settingsDetails.advanced.offlineModeDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.serverConnection.offlineMode)
        .onChange((value) => {
          settings.serverConnection.offlineMode = value;
          void this.saveSettings();

          void this.context.plugin.getServerManager()
            .then((serverManager) => {
              serverManager.updateOfflineMode(value);
            })
            .catch(() => {
              // ServerManager may not be initialized yet
            });
        }));

    // Reset button
    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.resetToDefaults'))
      .setDesc(t('settingsDetails.advanced.resetToDefaultsDesc'))
      .addButton(button => button
        .setButtonText(t('common.reset'))
        .onClick(() => {
          this.context.plugin.settings.serverConnection = { ...DEFAULT_SERVER_CONNECTION_SETTINGS };
          void this.saveSettings();

          void this.context.plugin.getServerManager()
            .then((serverManager) => {
              serverManager.updateOfflineMode(this.context.plugin.settings.serverConnection.offlineMode);
              serverManager.updateBinaryDownloadConfig({
                source: this.context.plugin.settings.serverConnection.binaryDownloadSource,
              });
            })
            .catch(() => {
              // ServerManager may not be initialized yet
            });

          const parentCard = containerEl.parentElement;
          if (parentCard) {
            this.toggleConditionalSection(parentCard, 'server-connection-settings', false, () => {});
            this.toggleConditionalSection(parentCard, 'server-connection-settings', true, (el) => this.renderServerConnectionContent(el));
          }
        }));
  }
}
