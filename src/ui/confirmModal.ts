import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import { t } from '../i18n';

class ConfirmModal extends Modal {
  private message: string;
  private onResult: (confirmed: boolean) => void;
  private confirmed = false;

  constructor(app: App, message: string, onResult: (confirmed: boolean) => void) {
    super(app);
    this.message = message;
    this.onResult = onResult;
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
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = buttonContainer.createEl('button', {
      cls: 'mod-cta',
      text: t('common.confirm')
    });
    confirmBtn.addEventListener('click', () => {
      this.confirmed = true;
      this.close();
    });
  }

  onClose(): void {
    this.onResult(this.confirmed);
    this.contentEl.empty();
  }
}

export const confirmAction = (app: App, message: string): Promise<boolean> =>
  new Promise((resolve) => {
    new ConfirmModal(app, message, resolve).open();
  });
