/**
 * Preset workflow edit modal
 */

import type { App } from 'obsidian';
import { Modal, Setting, setIcon } from 'obsidian';
import type {
  PresetScript,
  PresetWorkflowAction,
  PresetWorkflowActionType,
} from '@/settings/settings';
import { t } from '@/i18n';
import { PRESET_SCRIPT_ICON_OPTIONS, renderPresetScriptIcon } from './presetScriptIcons';
import {
  listObsidianCommandOptions,
  searchObsidianCommandOptions,
  type ObsidianCommandOption,
} from './obsidianCommandSearch';

type ActionOption = {
  value: PresetWorkflowActionType;
  label: string;
  placeholder: string;
};

const ACTION_OPTIONS: ActionOption[] = [
  {
    value: 'terminal-command',
    label: 'Terminal command',
    placeholder: 'e.g., git status',
  },
  {
    value: 'obsidian-command',
    label: 'Obsidian command ID',
    placeholder: 'e.g., save / workspace:save',
  },
  {
    value: 'open-external',
    label: 'Open external URL',
    placeholder: 'e.g., https://obsidian.md',
  },
];

const COMMAND_SUGGESTION_LIMIT = 20;

export class PresetScriptModal extends Modal {
  private draft: PresetScript;
  private onSubmit: (script: PresetScript) => void;
  private isNew: boolean;
  private nameInput: HTMLInputElement | null = null;
  private iconInput: HTMLInputElement | null = null;
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
  private actionsContainer: HTMLElement | null = null;
  private obsidianCommandOptions: ObsidianCommandOption[] = [];

  constructor(app: App, script: PresetScript, onSubmit: (script: PresetScript) => void, isNew: boolean) {
    super(app);
    this.draft = this.normalizeDraft(script);
    this.onSubmit = onSubmit;
    this.isNew = isNew;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('preset-script-modal');
    contentEl.empty();
    this.obsidianCommandOptions = listObsidianCommandOptions(this.app);

    const titleEl = contentEl.createDiv({ cls: 'modal-title' });
    titleEl.createDiv({
      cls: 'modal-title-text',
      text: this.isNew ? t('modals.presetScript.titleCreate') : t('modals.presetScript.titleEdit')
    });

    const formEl = contentEl.createDiv({ cls: 'preset-script-form' });
    this.renderNameField(formEl);
    this.renderIconField(formEl);
    this.renderTerminalTitleField(formEl);
    this.renderActionsField(formEl);
    this.renderToggles(formEl);
    this.renderButtons(contentEl);

    setTimeout(() => {
      this.nameInput?.focus();
      this.nameInput?.select();
    }, 10);
  }

  private renderNameField(formEl: HTMLElement): void {
    this.renderTextField(
      formEl,
      t('settingsDetails.terminal.presetScriptName'),
      t('settingsDetails.terminal.presetScriptNamePlaceholder'),
      (input) => {
        this.nameInput = input;
        input.value = this.draft.name ?? '';
        input.addEventListener('input', () => {
          this.draft.name = input.value;
        });
      }
    );
  }

  private renderIconField(formEl: HTMLElement): void {
    this.renderTextField(
      formEl,
      t('settingsDetails.terminal.presetScriptIcon'),
      t('settingsDetails.terminal.presetScriptIconPlaceholder'),
      (input) => {
        this.iconInput = input;
        input.value = this.draft.icon ?? '';
        input.addEventListener('input', () => {
          this.draft.icon = input.value.trim();
          this.updateIconPickerSelection();
        });
      }
    );
    this.renderIconPicker(formEl);
  }

  private renderTerminalTitleField(formEl: HTMLElement): void {
    this.renderTextField(
      formEl,
      t('settingsDetails.terminal.presetScriptTerminalTitle'),
      t('settingsDetails.terminal.presetScriptTerminalTitlePlaceholder'),
      (input) => {
        input.value = this.draft.terminalTitle ?? '';
        input.addEventListener('input', () => {
          this.draft.terminalTitle = input.value;
        });
      }
    );
  }

  private renderActionsField(formEl: HTMLElement): void {
    const field = formEl.createDiv({ cls: 'preset-script-field' });
    field.createEl('label', { cls: 'preset-script-label', text: t('settingsDetails.terminal.presetScriptCommand') });
    this.actionsContainer = field.createDiv({ cls: 'preset-workflow-actions' });
    this.renderActionRows();

    const addActionBtn = field.createEl('button', {
      cls: 'preset-workflow-action-add',
      text: '+ Add action',
    });
    addActionBtn.setAttribute('type', 'button');
    addActionBtn.addEventListener('click', () => {
      this.draft.actions.push(this.createEmptyAction());
      this.renderActionRows();
    });
  }

  private renderToggles(formEl: HTMLElement): void {
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
  }

  private renderButtons(contentEl: HTMLElement): void {
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
  }

  private renderActionRows(): void {
    if (!this.actionsContainer) return;
    this.actionsContainer.empty();

    const actions = this.draft.actions;
    if (actions.length === 0) {
      this.actionsContainer.createDiv({
        cls: 'preset-workflow-action-empty',
        text: t('settingsDetails.terminal.presetScriptsEmptyCommand'),
      });
      return;
    }

    actions.forEach((action, index) => {
      this.renderActionRow(action, index, actions.length);
    });
  }

  private renderActionRow(action: PresetWorkflowAction, index: number, total: number): void {
    const row = this.actionsContainer!.createDiv({ cls: 'preset-workflow-action-row' });
    this.renderActionTypeSelect(row, action);
    this.renderActionValueInput(row, action);
    this.renderActionDeleteButton(row, action);
    this.renderActionMoveUpButton(row, index);
    this.renderActionMoveDownButton(row, index, total);
  }

  private renderActionTypeSelect(row: HTMLElement, action: PresetWorkflowAction): void {
    const typeSelect = row.createEl('select', { cls: 'preset-workflow-action-type' });
    this.renderActionTypeOptions(typeSelect, action.type);
    typeSelect.addEventListener('change', () => {
      action.type = this.parseActionType(typeSelect.value);
      this.renderActionRows();
    });
  }

  private renderActionValueInput(row: HTMLElement, action: PresetWorkflowAction): void {
    const valueInput = row.createEl('input', {
      cls: 'preset-workflow-action-value',
      type: 'text',
      placeholder: this.getActionPlaceholder(action.type),
    });
    valueInput.value = action.value;
    valueInput.addEventListener('input', () => {
      action.value = valueInput.value;
    });
    this.attachCommandSuggestions(row, valueInput, action);
  }

  private attachCommandSuggestions(
    row: HTMLElement,
    valueInput: HTMLInputElement,
    action: PresetWorkflowAction
  ): void {
    if (action.type !== 'obsidian-command') return;
    if (this.obsidianCommandOptions.length === 0) return;

    const dataListId = `obsidian-command-options-${action.id}`;
    const dataList = row.createEl('datalist', { attr: { id: dataListId } });
    valueInput.setAttribute('list', dataListId);

    const refreshSuggestions = () => {
      const matches = searchObsidianCommandOptions(
        this.obsidianCommandOptions,
        valueInput.value,
        COMMAND_SUGGESTION_LIMIT
      );
      this.renderCommandSuggestionOptions(dataList, matches);
    };

    valueInput.addEventListener('focus', refreshSuggestions);
    valueInput.addEventListener('input', refreshSuggestions);
    refreshSuggestions();
  }

  private renderCommandSuggestionOptions(
    dataList: HTMLDataListElement,
    matches: readonly ObsidianCommandOption[]
  ): void {
    dataList.empty();
    matches.forEach((option) => {
      const optionEl = dataList.createEl('option', { value: option.id });
      optionEl.label = option.name;
      optionEl.textContent = `${option.name} (${option.id})`;
    });
  }

  private renderActionDeleteButton(row: HTMLElement, action: PresetWorkflowAction): void {
    const deleteBtn = row.createEl('button', { cls: 'clickable-icon', attr: { type: 'button' } });
    setIcon(deleteBtn, 'trash');
    deleteBtn.setAttribute('aria-label', t('common.delete'));
    deleteBtn.addEventListener('click', () => {
      this.draft.actions = this.draft.actions.filter((item) => item.id !== action.id);
      this.renderActionRows();
    });
  }

  private renderActionMoveUpButton(row: HTMLElement, index: number): void {
    const moveUpBtn = row.createEl('button', { cls: 'clickable-icon', attr: { type: 'button' } });
    setIcon(moveUpBtn, 'arrow-up');
    moveUpBtn.disabled = index === 0;
    moveUpBtn.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptsMoveUp'));
    moveUpBtn.addEventListener('click', () => {
      this.moveAction(index, index - 1);
    });
  }

  private renderActionMoveDownButton(row: HTMLElement, index: number, total: number): void {
    const moveDownBtn = row.createEl('button', { cls: 'clickable-icon', attr: { type: 'button' } });
    setIcon(moveDownBtn, 'arrow-down');
    moveDownBtn.disabled = index >= total - 1;
    moveDownBtn.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptsMoveDown'));
    moveDownBtn.addEventListener('click', () => {
      this.moveAction(index, index + 1);
    });
  }

  private renderActionTypeOptions(select: HTMLSelectElement, current: PresetWorkflowActionType): void {
    ACTION_OPTIONS.forEach((option) => {
      const optionEl = select.createEl('option', { value: option.value, text: option.label });
      optionEl.selected = option.value === current;
    });
  }

  private moveAction(from: number, to: number): void {
    if (from === to) return;
    if (from < 0 || to < 0 || from >= this.draft.actions.length || to >= this.draft.actions.length) {
      return;
    }
    const cloned = [...this.draft.actions];
    const [item] = cloned.splice(from, 1);
    cloned.splice(to, 0, item);
    this.draft.actions = cloned;
    this.renderActionRows();
  }

  private parseActionType(value: string): PresetWorkflowActionType {
    if (value === 'obsidian-command' || value === 'open-external') {
      return value;
    }
    return 'terminal-command';
  }

  private getActionPlaceholder(type: PresetWorkflowActionType): string {
    const matched = ACTION_OPTIONS.find((option) => option.value === type);
    return matched?.placeholder ?? '';
  }

  private createEmptyAction(): PresetWorkflowAction {
    return {
      id: this.createActionId(),
      type: 'terminal-command',
      value: '',
    };
  }

  private createActionId(): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `action-${Date.now()}-${random}`;
  }

  private normalizeDraft(script: PresetScript): PresetScript {
    const sourceActions = Array.isArray(script.actions) ? script.actions : [];
    const actions = sourceActions
      .map((action) => this.normalizeAction(action))
      .filter((action) => action.value.length > 0);
    const fallbackCommand = (script.command || '').trim();
    if (actions.length === 0 && fallbackCommand) {
      actions.push({
        id: this.createActionId(),
        type: 'terminal-command',
        value: fallbackCommand,
      });
    }
    return {
      ...script,
      command: fallbackCommand,
      actions,
    };
  }

  private normalizeAction(action: PresetWorkflowAction): PresetWorkflowAction {
    const id = (action.id || '').trim() || this.createActionId();
    const type = this.parseActionType(action.type);
    const value = (action.value || '').trim();
    return { id, type, value };
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

  private submit(): void {
    const normalizedActions = this.draft.actions
      .map((action) => this.normalizeAction(action))
      .filter((action) => action.value.length > 0);
    const fallbackCommand = normalizedActions.find((action) => action.type === 'terminal-command')?.value ?? '';

    const updated: PresetScript = {
      ...this.draft,
      name: (this.draft.name || '').trim(),
      icon: (this.draft.icon || '').trim(),
      command: fallbackCommand,
      actions: normalizedActions,
      terminalTitle: (this.draft.terminalTitle || '').trim(),
    };
    this.onSubmit(updated);
    this.close();
  }

  private renderIconPicker(formEl: HTMLElement): void {
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
    this.iconPreview = null;
    this.iconPickerButtons.clear();
    this.iconPickerPanel = null;
    this.iconPickerContainer = null;
    this.iconPickerGrid = null;
    this.iconPickerPager = null;
    this.iconPrevButton = null;
    this.iconNextButton = null;
    this.iconPageInfo = null;
    this.actionsContainer = null;
    this.obsidianCommandOptions = [];
    if (this.outsideClickHandler) {
      document.removeEventListener('click', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }
}

export default PresetScriptModal;
