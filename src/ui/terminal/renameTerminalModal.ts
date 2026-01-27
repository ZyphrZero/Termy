/**
 * 终端重命名模态框
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
    
    // 添加自定义样式类
    modalEl.addClass('rename-terminal-modal');
    contentEl.empty();

    // 标题
    const titleEl = contentEl.createDiv({ cls: 'modal-title' });
    titleEl.createEl('h2', { text: t('modals.renameTerminal.title') });

    // 输入区域容器
    const inputContainer = contentEl.createDiv({ cls: 'rename-input-container' });
    
    // 标签
    const label = inputContainer.createEl('label', { 
      cls: 'rename-input-label',
      text: t('modals.renameTerminal.placeholder')
    });
    
    // 输入框
    this.inputEl = inputContainer.createEl('input', {
      cls: 'rename-input',
      type: 'text',
      value: this.currentTitle,
      placeholder: t('modals.renameTerminal.placeholder')
    });

    // 输入事件
    this.inputEl.addEventListener('input', (e) => {
      this.inputValue = (e.target as HTMLInputElement).value;
    });

    // 回车确认
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    // 取消按钮
    const cancelBtn = buttonContainer.createEl('button', {
      cls: 'mod-cancel',
      text: t('common.cancel')
    });
    cancelBtn.addEventListener('click', () => this.close());

    // 确认按钮
    const confirmBtn = buttonContainer.createEl('button', {
      cls: 'mod-cta',
      text: t('common.confirm')
    });
    confirmBtn.addEventListener('click', () => this.submit());

    // 自动聚焦并选中文本
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
