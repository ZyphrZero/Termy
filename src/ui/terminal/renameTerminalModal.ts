/**
 * Terminal rename modal
 */

import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import { t } from '../../i18n';

export class RenameTerminalModal extends Modal {
  private currentTitle: string;
  private onSubmit: (newTitle: string) => void;
  private inputValue: string;
  private inputEl: HTMLInputElement | null = null;

  constructor(app: App, currentTitle: string, onSubmit: (newTitle: string) => void) {
    super(app);
    this.currentTitle = currentTitle;
    this.inputValue = currentTitle;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    
    // Add custom style class
    modalEl.addClass('rename-terminal-modal');
    contentEl.empty();

    // Title
    const titleEl = contentEl.createDiv({ cls: 'modal-title' });
    titleEl.createDiv({ cls: 'modal-title-text', text: t('modals.renameTerminal.title') });

    // Input area container
    const inputContainer = contentEl.createDiv({ cls: 'rename-input-container' });
    
    // Label
    inputContainer.createEl('label', { 
      cls: 'rename-input-label',
      text: t('modals.renameTerminal.placeholder')
    });
    
    // Input field
    this.inputEl = inputContainer.createEl('input', {
      cls: 'rename-input',
      type: 'text',
      value: this.currentTitle,
      placeholder: t('modals.renameTerminal.placeholder')
    });

    // Input handler
    this.inputEl.addEventListener('input', (e) => {
      this.inputValue = (e.target as HTMLInputElement).value;
    });

    // Confirm on Enter
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    // Button container
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    // Cancel button
    const cancelBtn = buttonContainer.createEl('button', {
      cls: 'mod-cancel',
      text: t('common.cancel')
    });
    cancelBtn.addEventListener('click', () => this.close());

    // Confirm button
    const confirmBtn = buttonContainer.createEl('button', {
      cls: 'mod-cta',
      text: t('common.confirm')
    });
    confirmBtn.addEventListener('click', () => this.submit());

    // Auto-focus and select the text
    setTimeout(() => {
      this.inputEl?.focus();
      this.inputEl?.select();
    }, 10);
  }

  private submit(): void {
    const trimmedValue = this.inputValue.trim();
    if (trimmedValue && trimmedValue !== this.currentTitle) {
      this.onSubmit(trimmedValue);
    }
    this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.inputEl = null;
  }
}

export default RenameTerminalModal;
