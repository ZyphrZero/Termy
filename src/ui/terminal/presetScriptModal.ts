/**
 * 预设脚本编辑模态框
 */

import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { PresetScript } from '@/settings/settings';
import { t } from '@/i18n';
import { PRESET_SCRIPT_ICON_OPTIONS, renderPresetScriptIcon } from './presetScriptIcons';

export class PresetScriptModal extends Modal {
  private draft: PresetScript;
  private onSubmit: (script: PresetScript) => void;
  private isNew: boolean;
  private nameInput: HTMLInputElement | null = null;
  private iconInput: HTMLInputElement | null = null;
  private commandInput: HTMLTextAreaElement | null = null;
  private iconPreview: HTMLElement | null = null;
  private iconPickerButtons: Map<string, HTMLButtonElement> = new Map();
  private iconPickerPanel: HTMLElement | null = null;
  private iconPickerContainer: HTMLElement | null = null;
  private iconPickerGrid: HTMLElement | null = null;
  private iconPickerPager: HTMLElement | null = null;
  private iconPrevButton: HTMLButtonElement | null = null;
  private iconNextButton: HTMLButtonElement | null = null;
  private iconPageInfo: HTMLElement | null = null;
  private iconPage = 0;
  private readonly iconPageSize = 42;
  private outsideClickHandler: ((event: MouseEvent) => void) | null = null;

  constructor(app: App, script: PresetScript, onSubmit: (script: PresetScript) => void, isNew: boolean) {
    super(app);
    this.draft = { ...script };
    this.onSubmit = onSubmit;
    this.isNew = isNew;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;

    modalEl.addClass('preset-script-modal');
    contentEl.empty();

    const titleEl = contentEl.createDiv({ cls: 'modal-title' });
    titleEl.createEl('h2', { text: this.isNew ? t('modals.presetScript.titleCreate') : t('modals.presetScript.titleEdit') });

    const formEl = contentEl.createDiv({ cls: 'preset-script-form' });

    this.renderTextField(formEl, t('settingsDetails.terminal.presetScriptName'), t('settingsDetails.terminal.presetScriptNamePlaceholder'), (input) => {
      this.nameInput = input;
      input.value = this.draft.name ?? '';
      input.addEventListener('input', () => {
        this.draft.name = input.value;
      });
    });

    this.renderTextField(formEl, t('settingsDetails.terminal.presetScriptIcon'), t('settingsDetails.terminal.presetScriptIconPlaceholder'), (input) => {
      this.iconInput = input;
      input.value = this.draft.icon ?? '';
      input.addEventListener('input', () => {
        this.draft.icon = input.value.trim();
        this.updateIconPickerSelection();
      });
    });

    this.renderTextField(formEl, t('settingsDetails.terminal.presetScriptTerminalTitle'), t('settingsDetails.terminal.presetScriptTerminalTitlePlaceholder'), (input) => {
      input.value = this.draft.terminalTitle ?? '';
      input.addEventListener('input', () => {
        this.draft.terminalTitle = input.value;
      });
    });

    this.iconPickerContainer = formEl.createDiv({ cls: 'preset-script-icon-selector' });
    const previewButton = this.iconPickerContainer.createEl('button', { cls: 'preset-script-icon-preview' });
    previewButton.setAttribute('type', 'button');
    previewButton.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptIcon'));
    this.iconPreview = previewButton;
    renderPresetScriptIcon(this.iconPreview, this.draft.icon || 'terminal');

    this.iconPickerPanel = this.iconPickerContainer.createDiv({ cls: 'preset-script-icon-picker-panel' });
    this.iconPickerGrid = this.iconPickerPanel.createDiv({ cls: 'preset-script-icon-grid' });
    this.iconPickerPager = this.iconPickerPanel.createDiv({ cls: 'preset-script-icon-pager' });

    this.iconPrevButton = this.iconPickerPager.createEl('button', {
      cls: 'preset-script-icon-page-btn',
      text: '‹'
    });
    this.iconPrevButton.setAttribute('type', 'button');
    this.iconPrevButton.addEventListener('click', () => this.changeIconPage(-1));

    this.iconPageInfo = this.iconPickerPager.createDiv({ cls: 'preset-script-icon-page-info' });

    this.iconNextButton = this.iconPickerPager.createEl('button', {
      cls: 'preset-script-icon-page-btn',
      text: '›'
    });
    this.iconNextButton.setAttribute('type', 'button');
    this.iconNextButton.addEventListener('click', () => this.changeIconPage(1));

    this.renderIconPickerPage();

    previewButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleIconPicker();
    });

    this.outsideClickHandler = (event: MouseEvent) => {
      if (!this.iconPickerContainer) return;
      if (!this.iconPickerContainer.contains(event.target as Node)) {
        this.closeIconPicker();
      }
    };
    document.addEventListener('click', this.outsideClickHandler);

    this.renderTextAreaField(formEl, t('settingsDetails.terminal.presetScriptCommand'), t('settingsDetails.terminal.presetScriptCommandPlaceholder'), (input) => {
      this.commandInput = input;
      input.value = this.draft.command ?? '';
      input.addEventListener('input', () => {
        this.draft.command = input.value;
      });
    });

    new Setting(formEl)
      .setName(t('settingsDetails.terminal.presetScriptShowInStatusBar'))
      .setDesc(t('settingsDetails.terminal.presetScriptShowInStatusBarDesc'))
      .addToggle(toggle => toggle
        .setValue(this.draft.showInStatusBar)
        .onChange((value) => {
          this.draft.showInStatusBar = value;
        }));

    new Setting(formEl)
      .setName(t('settingsDetails.terminal.presetScriptAutoOpenTerminal'))
      .setDesc(t('settingsDetails.terminal.presetScriptAutoOpenTerminalDesc'))
      .addToggle(toggle => toggle
        .setValue(this.draft.autoOpenTerminal)
        .onChange((value) => {
          this.draft.autoOpenTerminal = value;
        }));

    new Setting(formEl)
      .setName(t('settingsDetails.terminal.presetScriptRunInNewTerminal'))
      .setDesc(t('settingsDetails.terminal.presetScriptRunInNewTerminalDesc'))
      .addToggle(toggle => toggle
        .setValue(this.draft.runInNewTerminal)
        .onChange((value) => {
          this.draft.runInNewTerminal = value;
        }));

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    const cancelBtn = buttonContainer.createEl('button', {
      cls: 'mod-cancel',
      text: t('common.cancel')
    });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = buttonContainer.createEl('button', {
      cls: 'mod-cta',
      text: t('common.save')
    });
    confirmBtn.addEventListener('click', () => this.submit());

    setTimeout(() => {
      this.nameInput?.focus();
      this.nameInput?.select();
    }, 10);
  }

  private renderTextField(
    container: HTMLElement,
    labelText: string,
    placeholder: string,
    setup: (input: HTMLInputElement) => void
  ): void {
    const field = container.createDiv({ cls: 'preset-script-field' });
    field.createEl('label', { cls: 'preset-script-label', text: labelText });
    const input = field.createEl('input', {
      cls: 'preset-script-input',
      type: 'text',
      placeholder: placeholder
    });
    setup(input);
  }

  private renderTextAreaField(
    container: HTMLElement,
    labelText: string,
    placeholder: string,
    setup: (input: HTMLTextAreaElement) => void
  ): void {
    const field = container.createDiv({ cls: 'preset-script-field' });
    field.createEl('label', { cls: 'preset-script-label', text: labelText });
    const input = field.createEl('textarea', {
      cls: 'preset-script-textarea',
      placeholder: placeholder
    });
    setup(input);
  }

  private submit(): void {
    const updated: PresetScript = {
      ...this.draft,
      name: (this.draft.name || '').trim(),
      icon: (this.draft.icon || '').trim(),
      command: (this.draft.command || '').replace(/\r\n/g, '\n'),
      terminalTitle: (this.draft.terminalTitle || '').trim(),
    };
    this.onSubmit(updated);
    this.close();
  }

  private updateIconPickerSelection(): void {
    const active = (this.draft.icon || '').trim();
    this.iconPickerButtons.forEach((button, iconName) => {
      button.toggleClass('is-active', iconName === active);
    });
    if (this.iconPreview) {
      renderPresetScriptIcon(this.iconPreview, active || 'terminal');
    }
  }

  private renderIconPickerPage(): void {
    if (!this.iconPickerGrid) return;
    const total = PRESET_SCRIPT_ICON_OPTIONS.length;
    const totalPages = Math.max(1, Math.ceil(total / this.iconPageSize));
    this.iconPage = Math.min(Math.max(this.iconPage, 0), totalPages - 1);

    this.iconPickerGrid.empty();
    this.iconPickerButtons.clear();

    const start = this.iconPage * this.iconPageSize;
    const pageIcons = PRESET_SCRIPT_ICON_OPTIONS.slice(start, start + this.iconPageSize);

    pageIcons.forEach((iconName) => {
      const button = this.iconPickerGrid!.createEl('button', { cls: 'preset-script-icon-option' });
      button.setAttribute('type', 'button');
      renderPresetScriptIcon(button, iconName);
      button.setAttribute('aria-label', iconName);
      button.addEventListener('click', () => {
        this.draft.icon = iconName;
        if (this.iconInput) {
          this.iconInput.value = iconName;
        }
        this.updateIconPickerSelection();
        this.closeIconPicker();
      });
      this.iconPickerButtons.set(iconName, button);
    });

    if (this.iconPageInfo) {
      this.iconPageInfo.setText(`${this.iconPage + 1} / ${totalPages}`);
    }
    if (this.iconPrevButton) {
      this.iconPrevButton.disabled = this.iconPage === 0;
    }
    if (this.iconNextButton) {
      this.iconNextButton.disabled = this.iconPage >= totalPages - 1;
    }

    this.updateIconPickerSelection();
  }

  private changeIconPage(delta: number): void {
    this.iconPage += delta;
    this.renderIconPickerPage();
  }

  private toggleIconPicker(): void {
    if (!this.iconPickerPanel) return;
    const isOpen = this.iconPickerPanel.hasClass('is-open');
    if (isOpen) {
      this.closeIconPicker();
    } else {
      this.openIconPicker();
    }
  }

  private openIconPicker(): void {
    if (!this.iconPickerPanel) return;
    this.iconPickerPanel.addClass('is-open');
  }

  private closeIconPicker(): void {
    if (!this.iconPickerPanel) return;
    this.iconPickerPanel.removeClass('is-open');
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.nameInput = null;
    this.iconInput = null;
    this.commandInput = null;
    this.iconPreview = null;
    this.iconPickerButtons.clear();
    this.iconPickerPanel = null;
    this.iconPickerContainer = null;
    this.iconPickerGrid = null;
    this.iconPickerPager = null;
    this.iconPrevButton = null;
    this.iconNextButton = null;
    this.iconPageInfo = null;
    if (this.outsideClickHandler) {
      document.removeEventListener('click', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }
}

export default PresetScriptModal;
