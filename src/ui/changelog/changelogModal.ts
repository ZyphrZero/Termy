import type { App } from 'obsidian';
import { Component, MarkdownRenderer, Modal, setIcon } from 'obsidian';
import { shell } from 'electron';
import type TerminalPlugin from '@/main';
import { t } from '@/i18n';
import { errorLog } from '@/utils/logger';

export class ChangelogModal extends Modal {
  private readonly plugin: TerminalPlugin;
  private readonly requestedVersion: string;
  private readonly markdownComponent = new Component();
  private markdownContainer: HTMLElement | null = null;
  private subtitleEl: HTMLElement | null = null;
  private versionBadgeEl: HTMLElement | null = null;

  constructor(app: App, plugin: TerminalPlugin, version: string) {
    super(app);
    this.plugin = plugin;
    this.requestedVersion = version.trim() || plugin.manifest.version;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('termy-changelog-modal');
    contentEl.empty();
    this.markdownComponent.load();

    const shellEl = contentEl.createDiv({ cls: 'termy-changelog-shell' });
    const headerEl = shellEl.createDiv({ cls: 'termy-changelog-header' });
    const headingEl = headerEl.createDiv({ cls: 'termy-changelog-heading' });

    headingEl.createDiv({
      cls: 'modal-title-text',
      text: t('modals.changelog.title'),
    });
    this.subtitleEl = headingEl.createDiv({
      cls: 'termy-changelog-subtitle',
      text: t('modals.changelog.subtitle', { version: this.requestedVersion }),
    });

    const actionsEl = headerEl.createDiv({ cls: 'termy-changelog-actions' });
    this.versionBadgeEl = actionsEl.createDiv({
      cls: 'termy-changelog-version-badge',
      text: this.requestedVersion,
    });

    this.markdownContainer = shellEl.createDiv({ cls: 'termy-changelog-body' });
    this.markdownContainer.createDiv({
      cls: 'termy-changelog-loading',
      text: t('modals.changelog.loading'),
    });

    void this.renderChangelog(actionsEl);
  }

  private async renderChangelog(actionsEl: HTMLElement): Promise<void> {
    if (!this.markdownContainer) {
      return;
    }

    try {
      const changelog = await this.plugin.getChangelogDetails(this.requestedVersion);
      if (this.subtitleEl) {
        this.subtitleEl.setText(t('modals.changelog.subtitle', { version: changelog.version }));
      }
      if (this.versionBadgeEl) {
        this.versionBadgeEl.setText(changelog.version);
      }
      this.renderHeaderActions(actionsEl, changelog.releaseUrl, changelog.fullChangelogUrl);

      this.markdownContainer.empty();
      const markdownEl = this.markdownContainer.createDiv({
        cls: 'markdown-rendered termy-changelog-markdown',
      });

      await MarkdownRenderer.render(
        this.app,
        changelog.markdown,
        markdownEl,
        changelog.sourcePath,
        this.markdownComponent,
      );
    } catch (error) {
      errorLog('[ChangelogModal] Failed to render changelog:', error);
      this.markdownContainer.empty();
      this.markdownContainer.createDiv({
        cls: 'termy-changelog-error',
        text: t('modals.changelog.unavailable'),
      });
    }
  }

  private renderHeaderActions(actionsEl: HTMLElement, releaseUrl: string | null, fullChangelogUrl: string): void {
    if (releaseUrl) {
      const releaseBtn = actionsEl.createEl('button', { cls: 'clickable-icon termy-changelog-action' });
      releaseBtn.setAttribute('type', 'button');
      releaseBtn.setAttribute('aria-label', t('modals.changelog.openRelease'));
      setIcon(releaseBtn, 'rocket');
      releaseBtn.addEventListener('click', () => {
        void shell.openExternal(releaseUrl);
      });
    }

    const fullBtn = actionsEl.createEl('button', { cls: 'clickable-icon termy-changelog-action' });
    fullBtn.setAttribute('type', 'button');
    fullBtn.setAttribute('aria-label', t('modals.changelog.openFull'));
    setIcon(fullBtn, 'external-link');
    fullBtn.addEventListener('click', () => {
      void shell.openExternal(fullChangelogUrl);
    });
  }

  onClose(): void {
    this.markdownComponent.unload();
    this.markdownContainer = null;
    this.subtitleEl = null;
    this.versionBadgeEl = null;
    this.contentEl.empty();
  }
}
