/**
 * 终端设置渲染器
 * 负责渲染终端相关的所有设置
 */

import type { ColorComponent, TextComponent } from 'obsidian';
import { Setting, Notice, Platform } from 'obsidian';
import type { RendererContext } from '../types';
import type { ShellType } from '../settings';
import { 
  DEFAULT_SERVER_CONNECTION_SETTINGS,
  getCurrentPlatformShell, 
  setCurrentPlatformShell, 
  getCurrentPlatformCustomShellPath, 
  setCurrentPlatformCustomShellPath 
} from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';

/**
 * 验证 Shell 路径是否有效（仅桌面端可用）
 * @param path Shell 可执行文件路径
 * @returns 路径是否存在且有效
 */
function validateShellPath(path: string): boolean {
  if (!path || path.trim() === '') return false;
  // 移动端不支持文件系统检查
  if (Platform.isMobile) return true;
  try {
    // 动态导入 fs 模块，避免移动端加载失败
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require('fs');
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
          dropdown.addOption('gitbash', t('shellOptions.gitbash'));
          dropdown.addOption('wsl', t('shellOptions.wsl'));
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
          dropdown.addOption('bash', t('shellOptions.bash'));
          dropdown.addOption('zsh', t('shellOptions.zsh'));
        }
        dropdown.addOption('custom', t('shellOptions.custom'));

        dropdown.setValue(currentShell);
        dropdown.onChange(async (value) => {
          setCurrentPlatformShell(this.context.plugin.settings, value as ShellType);
          await this.saveSettings();
          
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
        .onChange(async (value) => {
          // 将字符串分割为数组，过滤空字符串
          this.context.plugin.settings.shellArgs = value
            .split(' ')
            .filter(arg => arg.trim().length > 0);
          await this.saveSettings();
        }));

    // 自动进入项目目录
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.autoEnterVault'))
      .setDesc(t('settingsDetails.terminal.autoEnterVaultDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.autoEnterVaultDirectory)
        .onChange(async (value) => {
          this.context.plugin.settings.autoEnterVaultDirectory = value;
          await this.saveSettings();
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
          .onChange(async (value) => {
            setCurrentPlatformCustomShellPath(this.context.plugin.settings, value);
            await this.saveSettings();
            
            // 验证路径
            this.validateCustomShellPath(container, value);
          });
        
        // 初始验证
        setTimeout(() => {
          this.validateCustomShellPath(container, currentCustomPath);
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
        dropdown.onChange(async (value) => {
          this.context.plugin.settings.newInstanceBehavior = value as any;
          await this.saveSettings();
        });
      });

    // 在现有终端附近创建
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.createNearExisting'))
      .setDesc(t('settingsDetails.terminal.createNearExistingDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.createInstanceNearExistingOnes)
        .onChange(async (value) => {
          this.context.plugin.settings.createInstanceNearExistingOnes = value;
          await this.saveSettings();
        }));

    // 聚焦新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.focusNewInstance'))
      .setDesc(t('settingsDetails.terminal.focusNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.focusNewInstance)
        .onChange(async (value) => {
          this.context.plugin.settings.focusNewInstance = value;
          await this.saveSettings();
        }));

    // 锁定新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.lockNewInstance'))
      .setDesc(t('settingsDetails.terminal.lockNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.lockNewInstance)
        .onChange(async (value) => {
          this.context.plugin.settings.lockNewInstance = value;
          await this.saveSettings();
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

    // 使用 Obsidian 主题
    const useObsidianThemeSetting = new Setting(themeCard)
      .setName(t('settingsDetails.terminal.useObsidianTheme'))
      .setDesc(t('settingsDetails.terminal.useObsidianThemeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.useObsidianTheme)
        .onChange(async (value) => {
          await this.updateThemeSetting(() => {
            this.context.plugin.settings.useObsidianTheme = value;
          });
          
          // 使用局部更新替代全量刷新
          this.toggleConditionalSection(
            themeCard,
            'custom-color-settings',
            !value,
            (el) => this.renderCustomColorSettingsContent(el),
            useObsidianThemeSetting.settingEl
          );
        }));

    // 自定义颜色设置（仅在不使用 Obsidian 主题时显示）- 初始渲染
    this.toggleConditionalSection(
      themeCard,
      'custom-color-settings',
      !this.context.plugin.settings.useObsidianTheme,
      (el) => this.renderCustomColorSettingsContent(el),
      useObsidianThemeSetting.settingEl
    );
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
          .onChange(async (value) => {
            await this.updateThemeSetting(() => {
              this.context.plugin.settings.backgroundColor = value;
            });
          });
      })
      .addExtraButton(button => button
        .setIcon('reset')
        .setTooltip(t('common.reset'))
        .onClick(async () => {
          await this.updateThemeSetting(() => {
            this.context.plugin.settings.backgroundColor = undefined;
          });
          backgroundColorPicker?.setValue('#000000');
          new Notice(t('notices.settings.backgroundColorReset'));
        }));

    // 前景色
    new Setting(container)
      .setName(t('settingsDetails.terminal.foregroundColor'))
      .setDesc(t('settingsDetails.terminal.foregroundColorDesc'))
      .addColorPicker(color => {
        foregroundColorPicker = color;
        return color
          .setValue(this.context.plugin.settings.foregroundColor || '#FFFFFF')
          .onChange(async (value) => {
            await this.updateThemeSetting(() => {
              this.context.plugin.settings.foregroundColor = value;
            });
          });
      })
      .addExtraButton(button => button
        .setIcon('reset')
        .setTooltip(t('common.reset'))
        .onClick(async () => {
          await this.updateThemeSetting(() => {
            this.context.plugin.settings.foregroundColor = undefined;
          });
          foregroundColorPicker?.setValue('#FFFFFF');
          new Notice(t('notices.settings.foregroundColorReset'));
        }));

    // 背景图片设置（仅 Canvas 渲染器支持）
    this.toggleConditionalSection(
      container,
      'background-image-settings',
      this.context.plugin.settings.preferredRenderer === 'canvas',
      (el) => this.renderBackgroundImageSettings(el)
    );
  }

  /**
   * 渲染背景图片设置
   */
  private renderBackgroundImageSettings(container: HTMLElement): void {
    const bgImageSetting = new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImage'))
      .setDesc(t('settingsDetails.terminal.backgroundImageDesc'));

    let backgroundImageInput: TextComponent | null = null;
    
    bgImageSetting.addText(text => {
      backgroundImageInput = text;
      const inputEl = text
        .setPlaceholder(t('settingsDetails.terminal.backgroundImagePlaceholder'))
        .setValue(this.context.plugin.settings.backgroundImage || '')
        .onChange(async (value) => {
          this.context.plugin.settings.backgroundImage = value.trim() || undefined;
        });
      
      // 失去焦点时使用局部更新
      text.inputEl.addEventListener('blur', async () => {
        await this.updateThemeSetting(() => {
          this.context.plugin.settings.backgroundImage = text.inputEl.value.trim() || undefined;
        });

        const hasImage = !!this.context.plugin.settings.backgroundImage;
        this.toggleConditionalSection(
          container,
          'background-image-options',
          hasImage,
          (el) => this.renderBackgroundImageOptionsContent(el),
          bgImageSetting.settingEl
        );
      });
      
      return inputEl;
    });
    
    bgImageSetting.addExtraButton(button => button
      .setIcon('reset')
      .setTooltip(t('common.reset'))
      .onClick(async () => {
        await this.updateThemeSetting(() => {
          this.context.plugin.settings.backgroundImage = undefined;
        });
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
        .onChange(async (value) => {
          await this.updateThemeSetting(() => {
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
        .onChange(async (value: 'cover' | 'contain' | 'auto') => {
          await this.updateThemeSetting(() => {
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
        .onChange(async (value) => {
          await this.updateThemeSetting(() => {
            this.context.plugin.settings.backgroundImagePosition = value;
          });
        }));

    // 毛玻璃效果
    const blurEffectSetting = new Setting(container)
      .setName(t('settingsDetails.terminal.blurEffect'))
      .setDesc(t('settingsDetails.terminal.blurEffectDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.enableBlur ?? false)
        .onChange(async (value) => {
          await this.updateThemeSetting(() => {
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
        .onChange(async (value) => {
          await this.updateThemeSetting(() => {
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
        .onChange(async (value) => {
          await this.updateThemeSetting(() => {
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
        .onChange(async (value) => {
          this.context.plugin.settings.fontSize = value;
          await this.saveSettings();
        }));

    // 字体族
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontFamily'))
      .setDesc(t('settingsDetails.terminal.fontFamilyDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.fontFamilyPlaceholder'))
        .setValue(this.context.plugin.settings.fontFamily)
        .onChange(async (value) => {
          this.context.plugin.settings.fontFamily = value;
          await this.saveSettings();
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
        dropdown.onChange(async (value) => {
          this.context.plugin.settings.cursorStyle = value as any;
          await this.saveSettings();
        });
      });

    // 光标闪烁
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorBlink'))
      .setDesc(t('settingsDetails.terminal.cursorBlinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.cursorBlink)
        .onChange(async (value) => {
          this.context.plugin.settings.cursorBlink = value;
          await this.saveSettings();
        }));

    // 渲染器类型
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.rendererType'))
      .setDesc(t('settingsDetails.terminal.rendererTypeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('canvas', t('rendererOptions.canvas'))
        .addOption('webgl', t('rendererOptions.webgl'))
        .setValue(this.context.plugin.settings.preferredRenderer)
        .onChange(async (value: 'canvas' | 'webgl') => {
          await this.updateThemeSetting(() => {
            this.context.plugin.settings.preferredRenderer = value;
          });
          this.updateBackgroundImageSettingsVisibility();
          new Notice(t('notices.settings.rendererUpdated'));
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

    this.toggleConditionalSection(
      customColorContainer,
      'background-image-settings',
      this.context.plugin.settings.preferredRenderer === 'canvas',
      (el) => this.renderBackgroundImageSettings(el)
    );
  }

  private requestThemeRefresh(): void {
    const leaves = this.context.app.workspace.getLeavesOfType('terminal-view');
    leaves.forEach(leaf => {
      const view = leaf.view as any;
      if (typeof view?.refreshAppearance === 'function') {
        view.refreshAppearance();
      }
    });
  }

  private async updateThemeSetting(update: () => void): Promise<void> {
    update();
    await this.saveSettings();
    this.requestThemeRefresh();
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
        .onChange(async (value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.context.plugin.settings.scrollback = numValue;
            await this.saveSettings();
          }
        });
      
      // 失去焦点时验证
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 10000) {
          new Notice('⚠️ ' + t('notices.settings.scrollbackRangeError'));
          this.context.plugin.settings.scrollback = 1000;
          await this.saveSettings();
          text.setValue('1000');
        }
      });
      
      return inputEl;
    });

    // 终端面板默认高度
    new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.defaultHeight'))
      .setDesc(t('settingsDetails.terminal.defaultHeightDesc'))
      .addText(text => {
      const inputEl = text
        .setPlaceholder('300')
        .setValue(String(this.context.plugin.settings.defaultHeight))
        .onChange(async (value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.context.plugin.settings.defaultHeight = numValue;
            await this.saveSettings();
          }
        });
      
      // 失去焦点时验证
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 1000) {
          new Notice('⚠️ ' + t('notices.settings.heightRangeError'));
          this.context.plugin.settings.defaultHeight = 300;
          await this.saveSettings();
          text.setValue('300');
        }
      });
      
      return inputEl;
    });
  }

  /**
   * 验证自定义 Shell 路径
   * @param containerEl 容器元素
   * @param path Shell 路径
   */
  private validateCustomShellPath(containerEl: HTMLElement, path: string): void {
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
    const validationEl = containerEl.createDiv({ cls: 'shell-path-validation setting-item-description' });
    validationEl.style.marginTop = '8px';
    
    // 验证路径
    const isValid = validateShellPath(path);
    
    if (isValid) {
      validationEl.setText(t('settingsDetails.terminal.pathValid'));
      validationEl.style.color = 'var(--text-success)';
    } else {
      validationEl.setText(t('settingsDetails.terminal.pathInvalid'));
      validationEl.style.color = 'var(--text-error)';
    }
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
        .onChange(async (value) => {
          this.context.plugin.settings.visibility.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 在侧边栏显示图标
    new Setting(visibilityCard)
      .setName(t('visibility.showInRibbon'))
      .setDesc(t('visibility.showInRibbonDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.visibility.showInRibbon)
        .onChange(async (value) => {
          this.context.plugin.settings.visibility.showInRibbon = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 在新标签页显示
    new Setting(visibilityCard)
      .setName(t('visibility.showInNewTab'))
      .setDesc(t('visibility.showInNewTabDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.visibility.showInNewTab)
        .onChange(async (value) => {
          this.context.plugin.settings.visibility.showInNewTab = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 在状态栏显示
    new Setting(visibilityCard)
      .setName(t('visibility.showInStatusBar'))
      .setDesc(t('visibility.showInStatusBarDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.visibility.showInStatusBar)
        .onChange(async (value) => {
          this.context.plugin.settings.visibility.showInStatusBar = value;
          await this.saveSettings();
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
        .onChange(async (value) => {
          this.context.plugin.settings.enableDebugLog = value;
          await this.saveSettings();
          new Notice(value ? '调试日志已启用，请打开控制台查看' : '调试日志已禁用');
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
        .onChange(async (value) => {
          settings.serverConnection.offlineMode = value;
          await this.saveSettings();

          try {
            const serverManager = await this.context.plugin.getServerManager();
            serverManager.updateOfflineMode(value);
          } catch {
            // ServerManager 可能尚未初始化
          }
        }));

    // 下载加速源
    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.downloadAccelerator'))
      .setDesc(t('settingsDetails.advanced.downloadAcceleratorDesc'))
      .addText(text => text
        .setPlaceholder('https://ghfast.top/')
        .setValue(settings.serverConnection.downloadAcceleratorUrl || '')
        .onChange(async (value) => {
          settings.serverConnection.downloadAcceleratorUrl = value.trim();
          await this.saveSettings();

          try {
            const serverManager = await this.context.plugin.getServerManager();
            serverManager.updateDownloadAcceleratorUrl(settings.serverConnection.downloadAcceleratorUrl);
          } catch {
            // ServerManager 可能尚未初始化
          }
        }));

    // 重置按钮
    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.resetToDefaults'))
      .setDesc(t('settingsDetails.advanced.resetToDefaultsDesc'))
      .addButton(button => button
        .setButtonText(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.serverConnection = { ...DEFAULT_SERVER_CONNECTION_SETTINGS };
          await this.saveSettings();

          try {
            const serverManager = await this.context.plugin.getServerManager();
            serverManager.updateOfflineMode(this.context.plugin.settings.serverConnection.offlineMode);
            serverManager.updateDownloadAcceleratorUrl(this.context.plugin.settings.serverConnection.downloadAcceleratorUrl);
          } catch {
            // ServerManager 可能尚未初始化
          }

          const parentCard = containerEl.parentElement;
          if (parentCard) {
            this.toggleConditionalSection(parentCard, 'server-connection-settings', false, () => {});
            this.toggleConditionalSection(parentCard, 'server-connection-settings', true, (el) => this.renderServerConnectionContent(el));
          }
        }));
  }
}
