/**
 * 终端设置渲染器
 * 负责渲染终端相关的所有设置
 */

import type { App, ColorComponent, TextComponent } from 'obsidian';
import { Modal, Setting, Notice, Platform, ToggleComponent, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import type { PresetScript, ShellType } from '../settings';
import { 
  DEFAULT_SERVER_CONNECTION_SETTINGS,
  getCurrentPlatformShell, 
  setCurrentPlatformShell, 
  getCurrentPlatformCustomShellPath, 
  setCurrentPlatformCustomShellPath 
} from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';
import { PresetScriptModal } from '../../ui/terminal/presetScriptModal';
import { PRESET_SCRIPT_ICON_OPTIONS, renderPresetScriptIcon } from '../../ui/terminal/presetScriptIcons';
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

type NewInstanceBehavior = (typeof NEW_INSTANCE_BEHAVIORS)[number];
type CursorStyle = (typeof CURSOR_STYLES)[number];

const isNewInstanceBehavior = (value: string): value is NewInstanceBehavior =>
  NEW_INSTANCE_BEHAVIORS.includes(value as NewInstanceBehavior);

const isCursorStyle = (value: string): value is CursorStyle =>
  CURSOR_STYLES.includes(value as CursorStyle);

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
 * 验证 Shell 路径是否有效（仅桌面端可用）
 * @param path Shell 可执行文件路径
 * @returns 路径是否存在且有效
 */
async function validateShellPath(path: string): Promise<boolean> {
  if (!path || path.trim() === '') return false;
  // 移动端不支持文件系统检查
  if (Platform.isMobile) return true;
  try {
    // 动态导入 fs 模块，避免移动端加载失败
    const { existsSync } = await import('fs');
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * 终端设置渲染器
 * 处理 Shell 程序、实例行为、主题和外观设置的渲染
 */
export class TerminalSettingsRenderer extends BaseSettingsRenderer {
  private themePreviewEl: HTMLElement | null = null;
  private themePreviewContentEl: HTMLElement | null = null;
  private rendererStatusEl: HTMLElement | null = null;

  /**
   * 渲染终端设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;
    const containerEl = context.containerEl;

    // Shell 程序设置卡片
    this.renderShellSettings(containerEl);

    // 实例行为设置卡片
    this.renderInstanceBehaviorSettings(containerEl);

    // 预设脚本设置卡片
    this.renderPresetScriptsSettings(containerEl);

    // 主题设置卡片
    this.renderThemeSettings(containerEl);

    // 外观设置卡片
    this.renderAppearanceSettings(containerEl);

    // 行为设置卡片
    this.renderBehaviorSettings(containerEl);

    // 服务器连接设置卡片
    this.renderServerConnectionSettings(containerEl);

    // 功能显示设置卡片
    this.renderVisibilitySettings(containerEl);
  }

  /**
   * 渲染 Shell 程序设置
   */
  private renderShellSettings(containerEl: HTMLElement): void {
    const shellCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.shellSettings'))
      .setHeading();

    // 默认 Shell 程序选择
    const currentShell = getCurrentPlatformShell(this.context.plugin.settings);
    
    const shellDropdownSetting = new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultShell'))
      .setDesc(t('settingsDetails.terminal.defaultShellDesc'))
      .addDropdown(dropdown => {
        // 根据平台显示不同的选项
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
        dropdown.addOption('custom', t('shellOptions.custom'));

        dropdown.setValue(currentShell);
        dropdown.onChange((value) => {
          setCurrentPlatformShell(this.context.plugin.settings, value as ShellType);
          void this.saveSettings();
          
          // 使用局部更新替代全量刷新
          this.toggleConditionalSection(
            shellCard,
            'custom-shell-path',
            value === 'custom',
            (el) => this.renderCustomShellPathSetting(el),
            shellDropdownSetting.settingEl
          );
        });
      });

    // 自定义程序路径（仅在选择 custom 时显示）- 初始渲染
    this.toggleConditionalSection(
      shellCard,
      'custom-shell-path',
      currentShell === 'custom',
      (el) => this.renderCustomShellPathSetting(el),
      shellDropdownSetting.settingEl
    );

    // 默认启动参数
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultArgs'))
      .setDesc(t('settingsDetails.terminal.defaultArgsDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.defaultArgsPlaceholder'))
        .setValue(this.context.plugin.settings.shellArgs.join(' '))
        .onChange((value) => {
          // 将字符串分割为数组，过滤空字符串
          this.context.plugin.settings.shellArgs = value
            .split(' ')
            .filter(arg => arg.trim().length > 0);
          void this.saveSettings();
        }));

    // 自动进入项目目录
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
   * 渲染自定义 Shell 路径设置
   * 提取为独立方法，用于 toggleConditionalSection 调用
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
            
            // 验证路径
            void this.validateCustomShellPath(container, value);
          });
        
        // 初始验证
        setTimeout(() => {
          void this.validateCustomShellPath(container, currentCustomPath);
        }, 0);
        
        return text;
      });
  }

  /**
   * 渲染实例行为设置
   */
  private renderInstanceBehaviorSettings(containerEl: HTMLElement): void {
    const instanceCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.instanceBehavior'))
      .setHeading();

    // 新实例行为
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

    // 在现有终端附近创建
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.createNearExisting'))
      .setDesc(t('settingsDetails.terminal.createNearExistingDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.createInstanceNearExistingOnes)
        .onChange((value) => {
          this.context.plugin.settings.createInstanceNearExistingOnes = value;
          void this.saveSettings();
        }));

    // 聚焦新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.focusNewInstance'))
      .setDesc(t('settingsDetails.terminal.focusNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.focusNewInstance)
        .onChange((value) => {
          this.context.plugin.settings.focusNewInstance = value;
          void this.saveSettings();
        }));

    // 锁定新实例
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
   * 渲染主题设置
   */
  private renderThemeSettings(containerEl: HTMLElement): void {
    const themeCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(themeCard)
      .setName(t('settingsDetails.terminal.themeSettings'))
      .setHeading();

    this.renderThemePreview(themeCard);
    this.renderRendererStatus(themeCard);

    // 使用 Obsidian 主题
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
   * 渲染预设脚本设置
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

    const addBtn = headerEl.createEl('button', { cls: 'preset-scripts-add-btn' });
    addBtn.textContent = t('settingsDetails.terminal.presetScriptsAdd');
    addBtn.addEventListener('click', () => {
          const newScript: PresetScript = {
            id: this.createPresetScriptId(),
            name: '',
            icon: PRESET_SCRIPT_ICON_OPTIONS[0] || 'terminal',
            command: '',
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
      contentEl.createDiv({
        cls: 'preset-script-name',
        text: script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed')
      });
      contentEl.createDiv({
        cls: 'preset-script-command',
        text: this.getPresetScriptCommandPreview(script.command)
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
      editBtn.setAttribute('aria-label', t('common.save'));
      editBtn.addEventListener('click', () => {
        this.openPresetScriptModal({ ...script }, false, listEl);
      });

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
    });
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

  private getPresetScriptCommandPreview(command: string): string {
    const trimmed = (command || '').trim();
    if (!trimmed) {
      return t('settingsDetails.terminal.presetScriptsEmptyCommand');
    }
    const normalized = trimmed.replace(/\r?\n/g, ' \\n ');
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
  }

  /**
   * 渲染自定义颜色设置内容
   * 提取为独立方法，用于 toggleConditionalSection 调用
   */
  private renderCustomColorSettingsContent(container: HTMLElement): void {
    let backgroundColorPicker: ColorComponent | null = null;
    let foregroundColorPicker: ColorComponent | null = null;

    // 背景色
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

    // 前景色
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

    // 背景图片设置（WebGL 模式将自动降级为 Canvas）
    this.renderBackgroundImageSettings(container);
  }

  /**
   * 渲染背景图片设置
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
      
      // 失去焦点时使用局部更新
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
          
          // 使用局部更新移除背景图片选项
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

    // 背景图片相关选项（仅在有背景图片时显示）- 初始渲染
    this.toggleConditionalSection(
      container,
      'background-image-options',
      !!this.context.plugin.settings.backgroundImage,
      (el) => this.renderBackgroundImageOptionsContent(el),
      bgImageSetting.settingEl
    );
  }

  /**
   * 渲染背景图片相关选项内容
   * 提取为独立方法，用于 toggleConditionalSection 调用
   */
  private renderBackgroundImageOptionsContent(container: HTMLElement): void {
    // 背景图片透明度
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

    // 背景图片大小
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImageSize'))
      .setDesc(t('settingsDetails.terminal.backgroundImageSizeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('cover', t('backgroundSizeOptions.cover'))
        .addOption('contain', t('backgroundSizeOptions.contain'))
        .addOption('auto', t('backgroundSizeOptions.auto'))
        .setValue(this.context.plugin.settings.backgroundImageSize || 'cover')
        .onChange((value: 'cover' | 'contain' | 'auto') => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.backgroundImageSize = value;
          });
        }));

    // 背景图片位置
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

    // 毛玻璃效果
    const blurEffectSetting = new Setting(container)
      .setName(t('settingsDetails.terminal.blurEffect'))
      .setDesc(t('settingsDetails.terminal.blurEffectDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.enableBlur ?? false)
        .onChange((value) => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.enableBlur = value;
          });
          
          // 使用局部更新替代全量刷新
          this.toggleConditionalSection(
            container,
            'blur-amount-slider',
            value,
            (el) => this.renderBlurAmountSlider(el),
            blurEffectSetting.settingEl
          );
        }));

    // 毛玻璃模糊程度（仅在启用毛玻璃效果时显示）- 初始渲染
    this.toggleConditionalSection(
      container,
      'blur-amount-slider',
      this.context.plugin.settings.enableBlur ?? false,
      (el) => this.renderBlurAmountSlider(el),
      blurEffectSetting.settingEl
    );

    // 文本透明度
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
   * 渲染模糊程度滑块
   * 提取为独立方法，用于 toggleConditionalSection 调用
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
   * 渲染外观设置
   */
  private renderAppearanceSettings(containerEl: HTMLElement): void {
    const appearanceCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.appearanceSettings'))
      .setHeading();

    // 字体大小
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

    // 字体族
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

    // 光标样式
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

    // 光标闪烁
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorBlink'))
      .setDesc(t('settingsDetails.terminal.cursorBlinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.cursorBlink)
        .onChange((value) => {
          this.context.plugin.settings.cursorBlink = value;
          void this.saveSettings();
        }));

    // 渲染器类型
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.rendererType'))
      .setDesc(t('settingsDetails.terminal.rendererTypeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('canvas', t('rendererOptions.canvas'))
        .addOption('webgl', t('rendererOptions.webgl'))
        .setValue(this.context.plugin.settings.preferredRenderer)
        .onChange((value: 'canvas' | 'webgl') => {
          void this.updateThemeSetting(() => {
            this.context.plugin.settings.preferredRenderer = value;
          }).then(() => {
            this.updateBackgroundImageSettingsVisibility();
            new Notice(t('notices.settings.rendererUpdated'));
          });
        }));
  }

  /**
   * 更新背景图片设置可见性
   * 仅在自定义主题设置已渲染时生效
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
   * 渲染行为设置
   */
  private renderBehaviorSettings(containerEl: HTMLElement): void {
    const behaviorCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.behaviorSettings'))
      .setHeading();

    // 滚动缓冲区大小
    new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.scrollback'))
      .setDesc(t('settingsDetails.terminal.scrollbackDesc'))
      .addText(text => {
      const inputEl = text
        .setPlaceholder('1000')
        .setValue(String(this.context.plugin.settings.scrollback))
        .onChange((value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.context.plugin.settings.scrollback = numValue;
            void this.saveSettings();
            this.applyScrollbackToOpenTerminals(numValue);
          }
        });
      
      // 失去焦点时验证
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
   * 验证自定义 Shell 路径
   * @param containerEl 容器元素
   * @param path Shell 路径
   */
  private async validateCustomShellPath(containerEl: HTMLElement, path: string): Promise<void> {
    // 移除之前的验证消息
    const existingValidation = containerEl.querySelector('.shell-path-validation');
    if (existingValidation) {
      existingValidation.remove();
    }
    
    // 如果路径为空，不显示验证消息
    if (!path || path.trim() === '') {
      return;
    }
    
    // 创建验证消息容器
    const validationEl = containerEl.createDiv({
      cls: 'shell-path-validation setting-item-description terminal-settings-validation'
    });
    
    // 验证路径
    const isValid = await validateShellPath(path);
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

  /**
   * 渲染功能显示设置
   */
  private renderVisibilitySettings(containerEl: HTMLElement): void {
    const visibilityCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(visibilityCard)
      .setName(t('visibility.visibilitySettings'))
      .setHeading();

    // 在命令面板中显示
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

    // 在侧边栏显示图标
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

    // 在新标签页显示
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

    // 在状态栏显示
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

    // 调试设置卡片
    const debugCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(debugCard)
      .setName('🐛 调试设置')
      .setHeading();

    // 启用调试日志
    new Setting(debugCard)
      .setName('启用调试日志')
      .setDesc('在控制台输出详细的调试信息，用于排查问题')
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.enableDebugLog)
        .onChange((value) => {
          this.context.plugin.settings.enableDebugLog = value;
          void this.saveSettings().then(() => {
            new Notice(value ? '调试日志已启用，请打开控制台查看' : '调试日志已禁用');
          });
        }));
  }

  /**
   * 渲染服务器连接设置
   */
  private renderServerConnectionSettings(containerEl: HTMLElement): void {
    const connectionCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(connectionCard)
      .setName(t('settingsDetails.advanced.serverConnection'))
      .setDesc(t('settingsDetails.advanced.serverConnectionDesc'))
      .setHeading();

    // 使用条件区域渲染设置内容，便于重置后刷新
    this.toggleConditionalSection(
      connectionCard,
      'server-connection-settings',
      true,
      (el) => this.renderServerConnectionContent(el)
    );
  }

  /**
   * 渲染服务器连接设置内容
   */
  private renderServerConnectionContent(containerEl: HTMLElement): void {
    const settings = this.context.plugin.settings;

    // 离线模式
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
              // ServerManager 可能尚未初始化
            });
        }));

    // 下载加速源
    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.downloadAccelerator'))
      .setDesc(t('settingsDetails.advanced.downloadAcceleratorDesc'))
      .addText(text => text
        .setPlaceholder('https://ghfast.top/')
        .setValue(settings.serverConnection.downloadAcceleratorUrl || '')
        .onChange((value) => {
          settings.serverConnection.downloadAcceleratorUrl = value.trim();
          void this.saveSettings();

          void this.context.plugin.getServerManager()
            .then((serverManager) => {
              serverManager.updateDownloadAcceleratorUrl(settings.serverConnection.downloadAcceleratorUrl);
            })
            .catch(() => {
              // ServerManager 可能尚未初始化
            });
        }));

    // 重置按钮
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
              serverManager.updateDownloadAcceleratorUrl(this.context.plugin.settings.serverConnection.downloadAcceleratorUrl);
            })
            .catch(() => {
              // ServerManager 可能尚未初始化
            });

          const parentCard = containerEl.parentElement;
          if (parentCard) {
            this.toggleConditionalSection(parentCard, 'server-connection-settings', false, () => {});
            this.toggleConditionalSection(parentCard, 'server-connection-settings', true, (el) => this.renderServerConnectionContent(el));
          }
        }));
  }
}
