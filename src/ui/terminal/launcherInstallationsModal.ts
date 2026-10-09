import type { App } from 'obsidian';
import { Modal, Notice } from 'obsidian';
import { t } from '../../i18n';
import type { AiLauncherStatusSnapshot } from '../../services/terminal/aiLauncherStatus';

export function getLauncherInstallationTooltip(snapshot: AiLauncherStatusSnapshot): string {
  const lines = [t('settingsDetails.terminal.aiLauncherVersionConflict')];
  for (const installation of snapshot.installations) {
    const version = installation.version ? `v${installation.version}` : t('settingsDetails.terminal.aiLauncherInstallationVersionUnknown');
    const marker = installation.isDefault ? ` (${t('settingsDetails.terminal.aiLauncherDefaultInstallation')})`
      : !installation.onPath ? ` (${t('settingsDetails.terminal.aiLauncherOutsidePath')})` : '';
    lines.push(`${version} — ${installation.path}${marker}`);
  }
  if (snapshot.discoveryErrors.length > 0) lines.push(t('settingsDetails.terminal.aiLauncherDiscoveryIncomplete'));
  return lines.join('\n');
}

export class LauncherInstallationsModal extends Modal {
  private closed = false;
  private refreshing = false;

  constructor(
    app: App,
    private readonly launcherName: string,
    private snapshot: AiLauncherStatusSnapshot | null,
    private readonly refresh: () => Promise<AiLauncherStatusSnapshot | null>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.closed = false;
    this.modalEl.addClass('termy-launcher-installations-modal');
    this.render();
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', {
      text: t('settingsDetails.terminal.aiLauncherVersionDetectionTitle', { name: this.launcherName }),
    });
    contentEl.createEl('p', { text: t('settingsDetails.terminal.aiLauncherInstallationsDesc') });
    if (this.snapshot?.installationIssue === 'version-conflict') {
      contentEl.createEl('p', { cls: 'termy-launcher-installation-warning', text: t('settingsDetails.terminal.aiLauncherVersionConflict') });
      contentEl.createEl('p', { text: t('settingsDetails.terminal.aiLauncherInstallationConflictHint') });
    }
    const list = contentEl.createDiv({ cls: 'termy-launcher-installation-list' });
    for (const installation of this.snapshot?.installations ?? []) {
      const row = list.createDiv({ cls: 'termy-launcher-installation-row' });
      const heading = row.createDiv({ cls: 'termy-launcher-installation-heading' });
      heading.createEl('span', {
        text: installation.version ? `v${installation.version}` : t('settingsDetails.terminal.aiLauncherInstallationVersionUnknown'),
      });
      if (installation.isDefault || !installation.onPath) {
        heading.createEl('span', {
          cls: 'termy-launcher-installation-marker',
          text: t(installation.isDefault
            ? 'settingsDetails.terminal.aiLauncherDefaultInstallation'
            : 'settingsDetails.terminal.aiLauncherOutsidePath'),
        });
      }
      row.createEl('code', { cls: 'termy-launcher-installation-path', text: installation.path });
      if (installation.realPath !== installation.path) {
        row.createEl('code', { cls: 'termy-launcher-installation-path', text: `→ ${installation.realPath}` });
      }
      if (installation.error) {
        row.createDiv({
          cls: 'termy-launcher-installation-warning',
          text: t('settingsDetails.terminal.aiLauncherInstallationProbeFailed', { message: installation.error }),
        });
      }
    }
    if (!this.snapshot?.installations.length) {
      list.createEl('p', { text: t('settingsDetails.terminal.aiLauncherNoInstallations') });
    }
    if (this.snapshot?.discoveryErrors.length) {
      contentEl.createEl('p', { cls: 'termy-launcher-installation-warning', text: t('settingsDetails.terminal.aiLauncherDiscoveryIncomplete') });
      for (const error of this.snapshot.discoveryErrors) {
        contentEl.createDiv({ cls: 'termy-launcher-installation-path', text: error });
      }
    }
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    const refreshButton = buttons.createEl('button', {
      text: t(this.refreshing
        ? 'settingsDetails.terminal.aiLauncherInstallationRefreshing'
        : 'settingsDetails.terminal.aiLauncherInstallationRefresh'),
    });
    refreshButton.disabled = this.refreshing;
    refreshButton.addEventListener('click', () => { void this.refreshSnapshot(); });
    buttons.createEl('button', { text: t('modals.launcherInstall.buttonClose') })
      .addEventListener('click', () => this.close());
  }

  private async refreshSnapshot(): Promise<void> {
    this.refreshing = true;
    this.render();
    try {
      this.snapshot = await this.refresh();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.refreshing = false;
      if (!this.closed) this.render();
    }
  }
}
