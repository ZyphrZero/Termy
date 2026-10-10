import type { ButtonComponent } from 'obsidian';
import { Notice, Setting } from 'obsidian';
import { t } from '../../i18n';
import type { BinaryManagementStatus, ServerManager } from '../../services/server/serverManager';
import { confirmAction } from '../../ui/confirmModal';
import type { RendererContext } from '../types';

/** Local binary status and actions share the manager's operation lifecycle. */
export class BinarySettingsRenderer {
  private manager: ServerManager | null = null;
  private disposed = false;
  private pending = false;
  private error = '';
  private badgeEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private offlineEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private downloadButton!: ButtonComponent;
  private removeButton!: ButtonComponent;
  private refreshButton!: ButtonComponent;
  private readonly onStatusChanged = () => this.refresh();

  constructor(private readonly context: RendererContext) {}

  render(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl)
      .setName(t('settingsDetails.advanced.binaryManagement'))
      .setDesc(t('settingsDetails.advanced.binaryManagementDesc'));
    setting.settingEl.addClass('termy-binary-setting');
    this.badgeEl = setting.nameEl.createSpan({
      cls: 'termy-binary-status is-checking',
      text: t('settingsDetails.advanced.binaryDownloadNowRunning'),
      attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    });
    this.detailEl = setting.descEl.createDiv({ cls: 'termy-binary-detail' });
    this.offlineEl = setting.descEl.createDiv({
      text: t('settingsDetails.advanced.binaryOfflineHint'),
    });
    this.errorEl = setting.descEl.createDiv({ cls: 'termy-binary-error', attr: { role: 'alert' } });
    this.offlineEl.hidden = !this.context.plugin.settings.serverConnection.offlineMode;
    this.errorEl.hidden = true;

    setting.addButton(button => {
      this.refreshButton = button
        .setIcon('refresh-cw')
        .setTooltip(t('settingsDetails.advanced.binaryRefreshStatus'))
        .onClick(() => {
          this.error = '';
          if (this.manager) this.refresh();
          else void this.initialize();
        });
    });
    setting.addButton(button => {
      this.downloadButton = button
        .setButtonText(t('settingsDetails.advanced.binaryDownloadNow'))
        .setCta()
        .setDisabled(true)
        .onClick(() => this.run('download'));
    });
    setting.addButton(button => {
      this.removeButton = button
        .setButtonText(t('settingsDetails.advanced.binaryRemove'))
        // Keep the warning style compatible with Obsidian versions before 1.13.
        .setClass('mod-warning')
        .setDisabled(true)
        .onClick(() => this.run('remove'));
      button.buttonEl.hidden = true;
    });
    void this.initialize();
  }

  dispose(): void {
    this.disposed = true;
    this.manager?.off('binary-status-changed', this.onStatusChanged);
  }

  private async initialize(): Promise<void> {
    this.refreshButton.setDisabled(true);
    try {
      const manager = await this.context.plugin.getServerManager();
      if (this.disposed) return;
      this.manager = manager;
      manager.on('binary-status-changed', this.onStatusChanged);
      this.refresh();
    } catch (error) {
      if (!this.disposed) this.showDetectionError(error);
    }
  }

  private refresh(): void {
    if (this.disposed || !this.manager) return;
    try {
      const status = this.manager.getBinaryStatus();
      const busy = this.pending || status.operation !== 'idle';
      const offline = this.context.plugin.settings.serverConnection.offlineMode;
      const installed = status.state !== 'missing';
      const stateKey = {
        missing: 'binaryStatusMissing',
        ready: 'binaryStatusReady',
        'update-required': 'binaryStatusUpdateRequired',
        'unknown-version': 'binaryStatusUnknownVersion',
      }[status.state];
      const stateText = t(`settingsDetails.advanced.${stateKey}`);
      const progressText = this.getProgressText(status);
      this.badgeEl.setText(progressText ? `${stateText} · ${progressText}` : stateText);
      this.badgeEl.className = `termy-binary-status is-${busy ? 'checking' : status.state}`;
      this.detailEl.setText(status.installedVersion
        ? t('settingsDetails.advanced.binaryVersionInstalled', {
          installed: status.installedVersion, expected: status.expectedVersion,
        })
        : t('settingsDetails.advanced.binaryVersionExpected', { version: status.expectedVersion }));
      this.offlineEl.hidden = !offline;
      this.errorEl.setText(this.error);
      this.errorEl.hidden = !this.error;

      this.downloadButton.buttonEl.hidden = status.state === 'ready' && status.operation !== 'downloading';
      const downloadKey = status.state === 'update-required' ? 'binaryUpdateNow'
        : status.state === 'unknown-version' ? 'binaryDownloadAgain' : 'binaryDownloadNow';
      this.downloadButton
        .setButtonText(status.operation === 'downloading' ? progressText : t(`settingsDetails.advanced.${downloadKey}`))
        .setDisabled(busy || offline);
      this.removeButton.buttonEl.hidden = !installed && status.operation !== 'removing';
      this.removeButton
        .setButtonText(t(status.operation === 'removing'
          ? 'settingsDetails.advanced.binaryRemoveRunning' : 'settingsDetails.advanced.binaryRemove'))
        .setDisabled(busy || !installed);
      this.refreshButton.setDisabled(busy);
    } catch (error) {
      this.showDetectionError(error);
    }
  }

  private getProgressText(status: BinaryManagementStatus): string {
    if (status.operation === 'removing') return t('settingsDetails.advanced.binaryRemoveRunning');
    if (status.operation !== 'downloading') return '';
    if (status.progress?.stage === 'verifying') return t('notices.verifyingBinary');
    if (status.progress?.stage === 'downloading') {
      return t('settingsDetails.advanced.binaryDownloading', { percent: Math.round(status.progress.percent) });
    }
    return t('settingsDetails.advanced.binaryDownloadNowRunning');
  }

  private showDetectionError(error: unknown): void {
    this.badgeEl.setText(t('settingsDetails.advanced.binaryStatusUnavailable'));
    this.badgeEl.className = 'termy-binary-status is-unavailable';
    this.detailEl.setText('');
    this.errorEl.setText(error instanceof Error ? error.message : String(error));
    this.errorEl.hidden = false;
    this.downloadButton.setDisabled(true);
    this.removeButton.setDisabled(true);
    this.refreshButton.setDisabled(this.pending);
  }

  private async run(action: 'download' | 'remove'): Promise<void> {
    if (!this.manager || this.pending) return;
    this.pending = true;
    this.error = '';
    this.refresh();
    try {
      if (this.manager.getBinaryStatus().operation !== 'idle') return;
      if (action === 'remove') {
        const confirmed = await confirmAction(this.context.app, t('settingsDetails.advanced.binaryRemoveConfirm'));
        if (!confirmed) return;
        await this.manager.removeBinary();
        new Notice(t('notices.settings.binaryRemoved'));
      } else {
        this.manager.updateBinaryDownloadConfig({
          source: this.context.plugin.settings.serverConnection.binaryDownloadSource,
        });
        const result = await this.manager.ensureBinaryUpdated();
        if (result === 'already-ready') new Notice(t('notices.settings.binaryAlreadyUpToDate'));
        else if (result === 'skipped-offline') new Notice(t('notices.settings.binaryDownloadSkippedOffline'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error = t(action === 'remove' ? 'notices.settings.binaryRemoveFailed' : 'notices.settings.binaryDownloadFailed', { message });
      new Notice(this.error, 5000);
    } finally {
      this.pending = false;
      this.refresh();
    }
  }
}
