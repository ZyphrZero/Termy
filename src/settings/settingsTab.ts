/**
 * Terminal plugin settings tab
 * Provides the terminal configuration interface
 */

import type { App } from 'obsidian';
import { PluginSettingTab, setIcon } from 'obsidian';
import type TerminalPlugin from '../main';
import { TerminalSettingsRenderer } from './renderers/terminalSettingsRenderer';
import { AgentSettingsRenderer } from './renderers/agentSettingsRenderer';
import type { RendererContext } from './types';
import { t } from '../i18n';
import { createTermyLogoSvg } from '../ui/icons';

/**
 * Terminal settings tab class
 */
export class TerminalSettingTab extends PluginSettingTab {
  plugin: TerminalPlugin;
  private terminalRenderer: TerminalSettingsRenderer;
  private agentRenderer: AgentSettingsRenderer;
  private expandedSections: Set<string> = new Set();

  constructor(app: App, plugin: TerminalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.terminalRenderer = new TerminalSettingsRenderer();
    this.agentRenderer = new AgentSettingsRenderer();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Add the main container class
    containerEl.addClass('terminal-settings-container');

    // Render the header section
    this.renderHeader(containerEl);

    // Content container
    const contentEl = containerEl.createDiv({ cls: 'terminal-settings-content' });

    // Create the renderer context
    const context: RendererContext = {
      app: this.app,
      plugin: this.plugin,
      containerEl: contentEl,
      expandedSections: this.expandedSections
    };

    // Render terminal settings
    this.terminalRenderer.render(context);

    // Render agent settings
    this.agentRenderer.render(context);
  }

  /**
   * Render the header section
   */
  private renderHeader(containerEl: HTMLElement): void {
    const headerEl = containerEl.createDiv({ cls: 'terminal-settings-header settings-header' });

    // Title row (includes the icon, title, changelog button, and reload button)
    const titleRow = headerEl.createDiv({ cls: 'settings-title-row' });

    // Left side: logo + title + changelog button
    const titleGroup = titleRow.createDiv({ cls: 'settings-title-group' });
    
    // Add the Termy logo
    const iconContainer = titleGroup.createDiv({ cls: 'settings-title-icon' });
    iconContainer.appendChild(createTermyLogoSvg(32));

    titleGroup.createDiv({ cls: 'settings-title', text: t('settings.header.title') });

    const changelogBtn = titleGroup.createEl('button', {
      cls: 'settings-header-button settings-title-changelog-button',
    });
    changelogBtn.setAttribute('type', 'button');
    setIcon(changelogBtn, 'scroll-text');
    changelogBtn.createSpan({ text: t('settings.header.changelog') });
    changelogBtn.addEventListener('click', () => {
      this.plugin.showChangelog();
    });

    // Right side: feedback link + reload button
    const actionsGroup = titleRow.createDiv({ cls: 'settings-actions-group' });
    
    const feedbackContainer = actionsGroup.createDiv({ cls: 'settings-feedback' });
    feedbackContainer.appendText(t('settings.header.feedbackText'));
    feedbackContainer.createEl('a', {
      text: t('settings.header.feedbackLink'),
      href: 'https://github.com/ZyphrZero/Termy'
    });
    feedbackContainer.createSpan({ cls: 'settings-feedback-separator', text: ' · ' });
    feedbackContainer.createEl('a', {
      text: t('settings.header.communityLink'),
      href: 'https://t.me/+t6oRqhaw8c1jNzE1'
    });
  }
}

