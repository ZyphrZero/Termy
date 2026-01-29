/**
 * 终端插件设置标签页
 * 提供终端配置界面
 */

import type { App } from 'obsidian';
import { PluginSettingTab, setIcon } from 'obsidian';
import type TerminalPlugin from '../main';
import { TerminalSettingsRenderer } from './renderers/terminalSettingsRenderer';
import type { RendererContext } from './types';
import { t } from '../i18n';

/**
 * 终端设置标签页类
 */
export class TerminalSettingTab extends PluginSettingTab {
  plugin: TerminalPlugin;
  private terminalRenderer: TerminalSettingsRenderer;
  private expandedSections: Set<string> = new Set();

  constructor(app: App, plugin: TerminalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.terminalRenderer = new TerminalSettingsRenderer();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 添加主容器类
    containerEl.addClass('terminal-settings-container');

    // 渲染头部区域
    this.renderHeader(containerEl);

    // 内容容器
    const contentEl = containerEl.createDiv({ cls: 'terminal-settings-content' });

    // 创建渲染器上下文
    const context: RendererContext = {
      app: this.app,
      plugin: this.plugin,
      containerEl: contentEl,
      expandedSections: this.expandedSections
    };

    // 渲染终端设置
    this.terminalRenderer.render(context);
  }

  /**
   * 渲染头部区域
   */
  private renderHeader(containerEl: HTMLElement): void {
    const headerEl = containerEl.createDiv({ cls: 'terminal-settings-header settings-header' });

    // 标题行（包含标题和重载按钮）
    const titleRow = headerEl.createDiv({ cls: 'settings-title-row' });

    const titleEl = titleRow.createEl('h2', { text: t('settings.header.title') });
    titleEl.addClass('settings-title');

    const reloadBtn = titleRow.createEl('button', { cls: 'clickable-icon' });
    setIcon(reloadBtn, 'refresh-cw');
    reloadBtn.setAttribute('aria-label', t('settings.header.reload'));
    reloadBtn.addEventListener('click', async () => {
      const pluginId = this.plugin.manifest.id;
      // @ts-expect-error - 访问 Obsidian 内部 API
      await this.app.plugins.disablePlugin(pluginId);
      // @ts-expect-error - 访问 Obsidian 内部 API
      await this.app.plugins.enablePlugin(pluginId);
      // @ts-expect-error - 访问 Obsidian 内部 API
      this.app.setting.openTabById(pluginId);
    });

    const feedbackContainer = headerEl.createDiv({ cls: 'settings-feedback' });
    feedbackContainer.appendText(t('settings.header.feedbackText'));
    feedbackContainer.createEl('a', {
      text: t('settings.header.feedbackLink'),
      href: 'https://github.com/ZyphrZero/Obsidian-Termy'
    });
  }
}
