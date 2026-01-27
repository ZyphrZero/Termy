/**
 * 终端插件设置标签页
 * 提供终端配置界面
 */

import type { App } from 'obsidian';
import { PluginSettingTab } from 'obsidian';
import type TerminalPlugin from '../main';
import { TerminalSettingsRenderer } from './renderers/terminalSettingsRenderer';
import type { RendererContext } from './types';

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

    // 创建渲染器上下文
    const context: RendererContext = {
      app: this.app,
      plugin: this.plugin,
      containerEl: containerEl,
      expandedSections: this.expandedSections
    };

    // 渲染终端设置
    this.terminalRenderer.render(context);
  }
}
