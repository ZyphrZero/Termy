/**
 * Terminal settings renderer
 * Responsible for rendering all terminal-related settings
 */

import type { ColorComponent, SettingDefinition, SliderComponent, TextComponent } from 'obsidian';
import { Setting, Notice, Platform } from 'obsidian';
import type { ISettingsRenderer, RendererContext } from '../types';
import type { BinaryDownloadSource, ShellType } from '../settings';

import { 
  DEFAULT_SERVER_CONNECTION_SETTINGS,
  getCurrentPlatformShell, 
  setCurrentPlatformShell, 
  getCurrentPlatformCustomShellPath, 
  setCurrentPlatformCustomShellPath 
} from '../settings';
import { t } from '../../i18n';
import { BinarySettingsRenderer } from './binarySettingsRenderer';
import { PresetScriptSettings } from './presetScriptSettings';
import { getSelectableShellTypes } from '../../services/terminal/shellProfiles';
import {
  clearNodeRuntimeCache,
  type NodeRuntimeSnapshot,
  type RuntimeCommandInfo,
} from '../../services/terminal/nodeRuntime';
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

interface TerminalSettingsSection {
  name: string;
  aliases: string[];
  render: (containerEl: HTMLElement) => void;
  dispose?: () => void;
}

function withSliderValueTooltip(slider: SliderComponent): SliderComponent {
  // Native value tooltips also work on Obsidian versions without inline slider values.
  const updateTooltip = (): void => {
    slider.sliderEl.title = slider.sliderEl.value;
  };
  updateTooltip();
  slider.sliderEl.addEventListener('input', updateTooltip);
  return slider;
}

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
  onRendererChange?: (callback: (renderer: 'canvas' | 'webgl') => void) => () => void;
};

type TerminalViewLike = {
  refreshAppearance?: () => void;
  getTerminalInstance?: () => TerminalInstanceLike | null;
  realView?: unknown;
};

const asTerminalViewLike = (value: unknown): TerminalViewLike | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as TerminalViewLike;
  if (typeof candidate.refreshAppearance === 'function') return candidate;
  if (typeof candidate.getTerminalInstance === 'function') return candidate;
  if (candidate.realView && candidate.realView !== value) return asTerminalViewLike(candidate.realView);
  return null;
};

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
    const fs = window.require('fs') as typeof import('fs');
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Terminal settings renderer
 * Handles rendering for Shell program, instance behavior, theme, and appearance settings
 */
export class TerminalSettingsRenderer implements ISettingsRenderer {
  private context!: RendererContext;
  private themePreviewEl: HTMLElement | null = null;
  private themePreviewContentEl: HTMLElement | null = null;
  private themePreviewCursorEl: HTMLElement | null = null;
  private rendererStatusEl: HTMLElement | null = null;
  private displayActiveTab: 'theme' | 'appearance' = 'theme';
  private rendererChangeUnsubscribers: Array<() => void> = [];
  private presetScriptSettings: PresetScriptSettings | null = null;
  private binarySettings: BinarySettingsRenderer | null = null;

  dispose(): void {
    this.disposeRendererChangeSubscriptions();
    this.presetScriptSettings?.dispose();
    this.presetScriptSettings = null;
    this.binarySettings?.dispose();
    this.binarySettings = null;
  }

  private toggleConditionalSection(
    container: HTMLElement,
    sectionId: string,
    shouldShow: boolean,
    renderFn: (container: HTMLElement) => void,
    insertAfter?: HTMLElement,
  ): void {
    if (!container) return;

    const sectionClass = `conditional-section-${sectionId}`;
    const existingSection = container.querySelector<HTMLElement>(`.${sectionClass}`);
    if (shouldShow && !existingSection) {
      const sectionEl = container.createDiv({ cls: sectionClass });
      if (insertAfter) {
        container.insertBefore(sectionEl, insertAfter.nextSibling);
      }
      try {
        renderFn(sectionEl);
      } catch (error) {
        console.error(`[Settings] Error rendering conditional section "${sectionId}":`, error);
      }
    } else if (!shouldShow && existingSection) {
      existingSection.remove();
    }
  }

  /**
   * Render terminal settings
   * @param context Renderer context
   */
  render(context: RendererContext): void {
    this.dispose();
    this.context = context;
    for (const section of this.getSections(context)) {
      section.render(context.containerEl);
    }
  }

  getSettingDefinitions(context: RendererContext): SettingDefinition[] {
    // Registration indexes these definitions without rendering or probing CLIs.
    // Custom renderers retain validation, live previews, and saveSettings effects.
    return this.getSections(context).map(section => ({
      name: section.name,
      aliases: section.aliases,
      render: (setting: Setting) => {
        section.dispose?.();
        this.context = context;
        setting.settingEl.empty();
        setting.settingEl.addClass('terminal-settings-section', 'terminal-settings-content');
        section.render(setting.settingEl);
        return section.dispose;
      },
    }));
  }

  private getSections(context: RendererContext): TerminalSettingsSection[] {
    const terminalNames = (...keys: string[]): string[] =>
      keys.map(key => t(`settingsDetails.terminal.${key}`));
    const advancedNames = (...keys: string[]): string[] =>
      keys.map(key => t(`settingsDetails.advanced.${key}`));

    return [
      {
        name: t('settingsDetails.terminal.shellSettings'),
        aliases: terminalNames('defaultShell', 'customShellPath', 'defaultArgs', 'autoEnterVault'),
        render: el => this.renderShellSettings(el),
      },
      {
        name: t('settingsDetails.terminal.instanceBehavior'),
        aliases: terminalNames('newInstanceLayout', 'createNearExisting', 'focusNewInstance', 'lockNewInstance'),
        render: el => this.renderInstanceBehaviorSettings(el),
      },
      {
        name: t('settingsDetails.terminal.nodeRuntimeSettings'),
        aliases: [...terminalNames('customNodePath'), 'Node.js', 'npm'],
        render: el => this.renderNodeRuntimeSettings(el),
      },
      {
        name: t('settingsDetails.terminal.presetScripts'),
        aliases: [
          ...terminalNames('hideUnavailableAiLaunchers', 'checkAiLauncherUpdates', 'aiLauncherInstallationRefresh'),
          ...context.plugin.settings.presetScripts.map(script => script.name).filter(Boolean),
        ],
        render: el => {
          this.presetScriptSettings = new PresetScriptSettings(this.context);
          this.presetScriptSettings.render(el);
        },
        dispose: () => {
          this.presetScriptSettings?.dispose();
          this.presetScriptSettings = null;
        },
      },
      {
        name: t('settingsDetails.terminal.displaySettings'),
        aliases: terminalNames(
          'useObsidianTheme', 'fontSize', 'fontFamily', 'cursorStyle', 'cursorBlink', 'rendererType',
          'backgroundColor', 'foregroundColor', 'backgroundImage', 'backgroundImageOpacity',
          'backgroundImageSize', 'backgroundImagePosition', 'blurEffect', 'blurAmount', 'textOpacity',
        ),
        render: el => this.renderDisplaySettings(el),
        dispose: () => this.disposeRendererChangeSubscriptions(),
      },
      {
        name: t('settingsDetails.terminal.behaviorSettings'),
        aliases: terminalNames('scrollback'),
        render: el => this.renderBehaviorSettings(el),
      },
      {
        name: t('settingsDetails.advanced.serverConnection'),
        aliases: advancedNames('binaryDownloadSource', 'binaryManagement', 'offlineMode', 'resetToDefaults'),
        render: el => this.renderServerConnectionSettings(el),
        dispose: () => {
          this.binarySettings?.dispose();
          this.binarySettings = null;
        },
      },
      {
        name: t('visibility.visibilitySettings'),
        aliases: [
          ...['showInCommandPalette', 'showInRibbon', 'showInNewTab', 'showInStatusBar']
            .map(key => t(`visibility.${key}`)),
          ...advancedNames('performanceAndDebug', 'debugMode'),
        ],
        render: el => this.renderVisibilitySettings(el),
      },
    ];
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
        for (const shellType of getSelectableShellTypes(currentShell)) {
          dropdown.addOption(shellType, t(`shellOptions.${shellType}`));
        }

        dropdown.setValue(currentShell);
        dropdown.onChange((value) => {
          setCurrentPlatformShell(this.context.plugin.settings, value as ShellType);
          void this.context.plugin.saveSettings();
          
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
          void this.context.plugin.saveSettings();
        }));

    // Automatically enter the vault directory
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.autoEnterVault'))
      .setDesc(t('settingsDetails.terminal.autoEnterVaultDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.autoEnterVaultDirectory)
        .onChange((value) => {
          this.context.plugin.settings.autoEnterVaultDirectory = value;
          void this.context.plugin.saveSettings();
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
            void this.context.plugin.saveSettings();
            
            // Validate the path
            this.validateCustomShellPath(container, value);
          });
        
        // Initial validation
        window.setTimeout(() => {
          this.validateCustomShellPath(container, currentCustomPath);
        }, 0);
        
        return text;
      });
  }

  private renderNodeRuntimeSettings(containerEl: HTMLElement): void {
    const runtimeCard = containerEl.createDiv({ cls: 'settings-card node-runtime-settings-card' });

    const header = runtimeCard.createDiv({ cls: 'node-runtime-header' });
    const headerText = header.createDiv({ cls: 'node-runtime-header-text' });
    headerText.createDiv({
      cls: 'node-runtime-title',
      text: t('settingsDetails.terminal.nodeRuntimeSettings'),
    });
    headerText.createDiv({
      cls: 'node-runtime-desc',
      text: t('settingsDetails.terminal.nodeRuntimeSettingsDesc'),
    });

    const headerActions = header.createDiv({ cls: 'node-runtime-header-actions' });
    const refreshButton = headerActions.createEl('button', {
      cls: 'node-runtime-refresh-btn',
      text: t('settingsDetails.terminal.nodeRuntimeRefresh'),
    });

    const runtimeRowsEl = runtimeCard.createDiv({ cls: 'node-runtime-list' });
    this.renderNodeRuntimeSnapshot(runtimeRowsEl, this.context.plugin.getNodeRuntimeSnapshot());

    const customPath = this.context.plugin.settings.customNodePath ?? '';
    const customPathSetting = new Setting(runtimeCard)
      .setName(t('settingsDetails.terminal.customNodePath'))
      .setDesc(t('settingsDetails.terminal.customNodePathDesc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settingsDetails.terminal.customNodePathPlaceholder'))
          .setValue(customPath)
          .onChange((value) => {
            this.context.plugin.settings.customNodePath = value.trim();
            clearNodeRuntimeCache();
            void this.context.plugin.saveSettings().then(() => {
              void this.refreshNodeRuntimeRows(runtimeRowsEl);
              void this.context.plugin.refreshAiLauncherStatusFromSettings({ force: true });
            });
            this.validateCustomNodePath(runtimeCard, value);
          });
      });

    this.validateCustomNodePath(runtimeCard, customPath);

    refreshButton.addEventListener('click', () => {
      void this.refreshNodeRuntimeRows(runtimeRowsEl, refreshButton);
    });

    // Initial render: wait for the already-in-flight warm (kicked off
    // during plugin load) rather than force-clearing and re-running.
    void this.context.plugin.warmRuntimeAndLaunchers().then(() => {
      const snapshot = this.context.plugin.getNodeRuntimeSnapshot();
      this.renderNodeRuntimeSnapshot(runtimeRowsEl, snapshot);
    });
    // Keep the setting visually grouped with the runtime list, while
    // still using Obsidian's native Setting component for accessibility.
    customPathSetting.settingEl.addClass('node-runtime-custom-path-setting');
  }

  private async refreshNodeRuntimeRows(
    rowsEl: HTMLElement,
    button?: HTMLButtonElement,
  ): Promise<void> {
    if (button) {
      button.disabled = true;
      button.textContent = t('settingsDetails.terminal.nodeRuntimeRefreshing');
    }
    try {
      // Re-warm both the enriched login-shell PATH and the runtime
      // probe so the user gets a single, consistent snapshot after a
      // refresh click. Order matters: enriched PATH must finish before
      // the runtime probe so the runtime probe's spawn calls inherit
      // the harvested PATH.
      await this.context.plugin.warmRuntimeAndLaunchers({ force: true });
      const snapshot = this.context.plugin.getNodeRuntimeSnapshot();
      this.renderNodeRuntimeSnapshot(rowsEl, snapshot);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = t('settingsDetails.terminal.nodeRuntimeRefresh');
      }
    }
  }

  private renderNodeRuntimeSnapshot(
    rowsEl: HTMLElement,
    snapshot: NodeRuntimeSnapshot | null,
  ): void {
    rowsEl.empty();
    this.renderNodeRuntimeRow(rowsEl, 'Node.js', snapshot?.node ?? null);
    this.renderNodeRuntimeRow(rowsEl, 'npm', snapshot?.npm ?? null);

    if (snapshot?.customNodePath) {
      rowsEl.createDiv({
        cls: 'node-runtime-custom-path-hint',
        text: t('settingsDetails.terminal.nodeRuntimeCustomPathActive'),
      });
    }
  }

  private renderNodeRuntimeRow(
    rowsEl: HTMLElement,
    label: string,
    command: RuntimeCommandInfo | null,
  ): void {
    const row = rowsEl.createDiv({ cls: 'node-runtime-row' });
    row.createDiv({ cls: 'node-runtime-row-label', text: label });

    const meta = row.createDiv({ cls: 'node-runtime-row-meta' });
    meta.createDiv({
      cls: `node-runtime-row-version is-${command?.availability ?? 'unknown'}`,
      text: this.formatRuntimeVersion(command),
    });
    const pathText = this.formatRuntimePath(command);
    const pathEl = meta.createEl('code', {
      cls: 'node-runtime-row-path',
      text: pathText,
    });
    if (command?.path) {
      pathEl.setAttr('title', command.path);
    }
  }

  private formatRuntimeVersion(command: RuntimeCommandInfo | null): string {
    if (!command || command.availability === 'unknown') {
      return t('settingsDetails.terminal.nodeRuntimePathUnknown');
    }
    if (command.availability === 'not-installed') {
      return t('settingsDetails.terminal.nodeRuntimePathMissing');
    }
    return command.version ? `v${command.version}` : t('settingsDetails.terminal.nodeRuntimePathAuto');
  }

  private formatRuntimePath(command: RuntimeCommandInfo | null): string {
    if (!command || command.availability === 'unknown') {
      return t('settingsDetails.terminal.nodeRuntimePathUnknown');
    }
    if (command.availability === 'not-installed') {
      return t('settingsDetails.terminal.nodeRuntimePathMissing');
    }
    return command.path ?? t('settingsDetails.terminal.nodeRuntimePathAuto');
  }

  private validateCustomNodePath(containerEl: HTMLElement, path: string): void {
    const existingValidation = containerEl.querySelector('.node-path-validation');
    existingValidation?.remove();

    if (!path || path.trim() === '') {
      return;
    }

    const validationEl = containerEl.createDiv({
      cls: 'node-path-validation setting-item-description terminal-settings-validation',
    });

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
          void this.context.plugin.saveSettings();
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
          void this.context.plugin.saveSettings();
        }));

    // Focus the new instance
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.focusNewInstance'))
      .setDesc(t('settingsDetails.terminal.focusNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.focusNewInstance)
        .onChange((value) => {
          this.context.plugin.settings.focusNewInstance = value;
          void this.context.plugin.saveSettings();
        }));

    // Lock the new instance
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.lockNewInstance'))
      .setDesc(t('settingsDetails.terminal.lockNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.lockNewInstance)
        .onChange((value) => {
          this.context.plugin.settings.lockNewInstance = value;
          void this.context.plugin.saveSettings();
        }));
  }

  /**
   * Render unified display settings (preview + theme/appearance tabs)
   */
  private renderDisplaySettings(containerEl: HTMLElement): void {
    const displayCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(displayCard)
      .setName(t('settingsDetails.terminal.displaySettings'))
      .setHeading();

    // Persistent preview area (always visible regardless of active tab)
    this.renderThemePreview(displayCard);

    // Tab switcher
    const tabBar = displayCard.createDiv({ cls: 'terminal-display-tabs' });
    const themeTabBtn = tabBar.createEl('button', {
      cls: 'terminal-display-tab',
      text: t('settingsDetails.terminal.displayTabTheme'),
    });
    const appearanceTabBtn = tabBar.createEl('button', {
      cls: 'terminal-display-tab',
      text: t('settingsDetails.terminal.displayTabAppearance'),
    });

    // Tab content container
    const tabContent = displayCard.createDiv({ cls: 'terminal-display-tab-content' });

    const renderActiveTab = (): void => {
      tabContent.empty();
      themeTabBtn.toggleClass('is-active', this.displayActiveTab === 'theme');
      appearanceTabBtn.toggleClass('is-active', this.displayActiveTab === 'appearance');
      themeTabBtn.setAttribute('aria-pressed', String(this.displayActiveTab === 'theme'));
      appearanceTabBtn.setAttribute('aria-pressed', String(this.displayActiveTab === 'appearance'));

      if (this.displayActiveTab === 'theme') {
        this.renderThemeTabContent(tabContent);
      } else {
        this.renderAppearanceTabContent(tabContent);
      }
    };

    themeTabBtn.addEventListener('click', () => {
      if (this.displayActiveTab === 'theme') return;
      this.displayActiveTab = 'theme';
      renderActiveTab();
    });
    appearanceTabBtn.addEventListener('click', () => {
      if (this.displayActiveTab === 'appearance') return;
      this.displayActiveTab = 'appearance';
      renderActiveTab();
    });

    renderActiveTab();
  }

  /**
   * Render theme tab content (Obsidian theme toggle + custom color settings)
   */
  private renderThemeTabContent(container: HTMLElement): void {
    // Use the Obsidian theme
    const useObsidianThemeSetting = new Setting(container)
      .setName(t('settingsDetails.terminal.useObsidianTheme'))
      .setDesc(t('settingsDetails.terminal.useObsidianThemeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.useObsidianTheme)
        .onChange((value) => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.useObsidianTheme = value;
          }).then(() => {
            this.updateCustomColorSettingsVisibility(container, useObsidianThemeSetting.settingEl);
          });
        }));

    this.updateCustomColorSettingsVisibility(container, useObsidianThemeSetting.settingEl);
  }

  /**
   * Render appearance tab content (font + cursor + renderer)
   */
  private renderAppearanceTabContent(container: HTMLElement): void {
    // Font size
    new Setting(container)
      .setName(t('settingsDetails.terminal.fontSize'))
      .setDesc(t('settingsDetails.terminal.fontSizeDesc'))
      .addSlider(slider => withSliderValueTooltip(
        slider.setLimits(8, 24, 1).setValue(this.context.plugin.settings.fontSize),
      ).onChange((value) => {
        void this.updateAppearanceSetting(() => {
          this.context.plugin.settings.fontSize = value;
        });
      }));

    // Font family
    new Setting(container)
      .setName(t('settingsDetails.terminal.fontFamily'))
      .setDesc(t('settingsDetails.terminal.fontFamilyDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.fontFamilyPlaceholder'))
        .setValue(this.context.plugin.settings.fontFamily)
        .onChange((value) => {
          void this.updateAppearanceSetting(() => {
            this.context.plugin.settings.fontFamily = value;
          });
        }));

    // Cursor style
    new Setting(container)
      .setName(t('settingsDetails.terminal.cursorStyle'))
      .setDesc(t('settingsDetails.terminal.cursorStyleDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('block', t('cursorStyleOptions.block'));
        dropdown.addOption('underline', t('cursorStyleOptions.underline'));
        dropdown.addOption('bar', t('cursorStyleOptions.bar'));

        dropdown.setValue(this.context.plugin.settings.cursorStyle);
        dropdown.onChange((value) => {
          if (!isCursorStyle(value)) return;
          void this.updateAppearanceSetting(() => {
            this.context.plugin.settings.cursorStyle = value;
          });
        });
      });

    // Cursor blink
    new Setting(container)
      .setName(t('settingsDetails.terminal.cursorBlink'))
      .setDesc(t('settingsDetails.terminal.cursorBlinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.cursorBlink)
        .onChange((value) => {
          void this.updateAppearanceSetting(() => {
            this.context.plugin.settings.cursorBlink = value;
          });
        }));

    // Renderer type
    new Setting(container)
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

    // Background image settings (WebGL mode silently ignores the background image)
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
      .addSlider(slider => withSliderValueTooltip(
        slider.setLimits(0, 1, 0.05).setValue(this.context.plugin.settings.backgroundImageOpacity ?? 0.5),
      ).onChange((value) => {
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
      .addSlider(slider => withSliderValueTooltip(
        slider.setLimits(0, 1, 0.05).setValue(this.context.plugin.settings.textOpacity ?? 1.0),
      ).onChange((value) => {
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
      .addSlider(slider => withSliderValueTooltip(
        slider.setLimits(0, 20, 1).setValue(this.context.plugin.settings.blurAmount ?? 10),
      ).onChange((value) => {
        void this.updateThemeSetting(() => {
          this.context.plugin.settings.blurAmount = value;
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
    await this.context.plugin.saveSettings();
    this.updateThemePreview();
    this.requestThemeRefresh();
  }

  private async updateAppearanceSetting(update: () => void): Promise<void> {
    update();
    await this.context.plugin.saveSettings();
    this.updateThemePreview();
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

    // Renderer badge in the top-right corner of the preview
    this.rendererStatusEl = this.themePreviewEl.createDiv({ cls: 'terminal-theme-preview-renderer-badge' });

    this.themePreviewContentEl = this.themePreviewEl.createDiv({ cls: 'terminal-theme-preview-content' });

    this.themePreviewContentEl.createDiv({ text: '$ echo "Termy"' });
    this.themePreviewContentEl.createDiv({ text: 'Termy' });
    this.themePreviewContentEl.createDiv({ text: '$ ls' });
    this.themePreviewContentEl.createDiv({ text: 'README.md  scripts  src  package.json' });
    const promptLine = this.themePreviewContentEl.createDiv({ cls: 'terminal-theme-preview-prompt-line' });
    promptLine.createSpan({ text: '$ ' });
    this.themePreviewCursorEl = promptLine.createSpan({ cls: 'terminal-theme-preview-cursor' });

    this.updateThemePreview();
    this.subscribeToRendererChanges();
    this.refreshRendererBadge();
  }

  private disposeRendererChangeSubscriptions(): void {
    for (const unsubscribe of this.rendererChangeUnsubscribers) {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    }
    this.rendererChangeUnsubscribers = [];
  }

  /**
   * Subscribe to renderer-change events on every alive terminal instance so the
   * badge reflects the actual addon swap (not a synchronous prediction made
   * before xterm finishes loading the new renderer).
   */
  private subscribeToRendererChanges(): void {
    const leaves = this.context.app.workspace.getLeavesOfType('terminal-view');
    for (const leaf of leaves) {
      const view = asTerminalViewLike(leaf.view);
      const instance = view?.getTerminalInstance?.() ?? null;
      if (!instance?.isAlive?.() || !instance.onRendererChange) continue;
      const unsubscribe = instance.onRendererChange(() => {
        this.refreshRendererBadge();
      });
      this.rendererChangeUnsubscribers.push(unsubscribe);
    }
  }

  /**
   * Render the renderer badge. Prefers the live renderer reported by an open
   * terminal instance; falls back to the configured `preferredRenderer` when
   * no terminal is alive so the badge stays visible in the preview.
   */
  private refreshRendererBadge(): void {
    if (!this.rendererStatusEl) return;

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

    if (!actualRenderer) {
      actualRenderer = this.context.plugin.settings.preferredRenderer ?? 'canvas';
    }

    const rendererLabel = actualRenderer === 'webgl'
      ? t('rendererOptions.webgl')
      : t('rendererOptions.canvas');

    this.rendererStatusEl.toggleClass('is-hidden', false);
    this.rendererStatusEl.setText(rendererLabel);
    this.rendererStatusEl.setAttribute('aria-label', rendererLabel);
    this.rendererStatusEl.setAttribute('title', rendererLabel);
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
      && !!settings.backgroundImage
      && settings.preferredRenderer !== 'webgl';

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

    const fontSize = clamp(settings.fontSize ?? 14, 8, 24);
    const fontFamily = settings.fontFamily?.trim() || 'var(--font-monospace)';
    const cursorStyle = settings.cursorStyle ?? 'block';
    const cursorBlink = !!settings.cursorBlink;

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
      fontSize: `${fontSize}px`,
      fontFamily,
    });

    if (this.themePreviewCursorEl) {
      this.themePreviewCursorEl.classList.remove(
        'is-block',
        'is-underline',
        'is-bar',
      );
      this.themePreviewCursorEl.classList.add(`is-${cursorStyle}`);
      this.themePreviewCursorEl.classList.toggle('is-blinking', cursorBlink);
    }

    this.refreshRendererBadge();
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
    fontSize: string;
    fontFamily: string;
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
    style.setProperty('--terminal-preview-font-size', vars.fontSize);
    style.setProperty('--terminal-preview-font-family', vars.fontFamily);
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
        .setPlaceholder('5000')
        .setValue(String(this.context.plugin.settings.scrollback))
        .onChange((value) => {
          // Save only while typing, without validation
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.context.plugin.settings.scrollback = numValue;
            void this.context.plugin.saveSettings();
            this.applyScrollbackToOpenTerminals(numValue);
          }
        });
      
      // Validate on blur
      text.inputEl.addEventListener('blur', () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 10000) {
          new Notice('⚠️ ' + t('notices.settings.scrollbackRangeError'));
          this.context.plugin.settings.scrollback = 5000;
          void this.context.plugin.saveSettings();
          text.setValue('5000');
          this.applyScrollbackToOpenTerminals(5000);
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
          void this.context.plugin.saveSettings();
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
          void this.context.plugin.saveSettings();
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
          void this.context.plugin.saveSettings();
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
          void this.context.plugin.saveSettings();
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
          void this.context.plugin.saveSettings().then(() => {
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
            void this.context.plugin.saveSettings();

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
      });

    this.binarySettings?.dispose();
    this.binarySettings = new BinarySettingsRenderer(this.context);
    this.binarySettings.render(containerEl);

    // Offline mode
    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.offlineMode'))
      .setDesc(t('settingsDetails.advanced.offlineModeDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.serverConnection.offlineMode)
        .onChange((value) => {
          settings.serverConnection.offlineMode = value;
          void this.context.plugin.saveSettings();

          // Keep the AI-launcher-update-check hint in the preset-scripts
          // card in sync — the toggle there is suppressed by offline mode
          // and we want the user to see that immediately.
          this.presetScriptSettings?.refreshUpdateHint();

          // When the user just turned offline mode OFF and the update
          // check is enabled, kick a forced refresh so badges flip from
          // "Ready" to "Update available" without waiting for the next
          // menu open. Force clears the 12h registry cache, which would
          // otherwise still hold the "request failed" entries from
          // earlier offline-mode probes.
          if (!value && this.context.plugin.settings.checkAiLauncherUpdates === true) {
            void this.context.plugin.refreshAiLauncherStatusFromSettings({ force: true });
          }

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
          void this.context.plugin.saveSettings();

          // The default ships offline mode off, so the suppression hint
          // in the preset-scripts card needs to disappear after reset.
          this.presetScriptSettings?.refreshUpdateHint();

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
