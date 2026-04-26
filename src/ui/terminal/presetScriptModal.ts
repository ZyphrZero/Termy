/**
 * Preset workflow edit modal
 */

import type { App } from 'obsidian';
import { Modal, Setting, ToggleComponent, setIcon } from 'obsidian';
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

const COMMAND_SUGGESTION_LIMIT = 50;

export class PresetScriptModal extends Modal {
  private readonly builtInPresetIds = new Set(['claude-code', 'codex', 'opencode', 'gemini-cli']);
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

  constructor(
    app: App,
    script: PresetScript,
    onSubmit: (script: PresetScript) => void,
    isNew: boolean,
  ) {
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
    const titleRow = titleEl.createDiv({ cls: 'preset-script-modal-title-row' });
    titleRow.createDiv({
      cls: 'modal-title-text',
      text: this.isNew ? t('modals.presetScript.titleCreate') : t('modals.presetScript.titleEdit')
    });
    if (this.isBuiltInPreset()) {
      titleRow.createDiv({
        cls: 'preset-script-built-in-badge',
        text: t('common.builtIn'),
      });
    }

    const formEl = contentEl.createDiv({ cls: 'preset-script-form' });
    this.renderNameField(formEl);
    this.renderIconField(formEl);
    this.renderTerminalTitleField(formEl);
    this.renderActionsField(formEl);
    if (this.draft.id === 'claude-code') {
      this.renderClaudeCodeContextNotice(formEl);
    }
    if (this.draft.id === 'opencode') {
      this.renderOpenCodeContextNotice(formEl);
    }
    if (this.draft.id === 'codex') {
      this.renderAgentContextNotice(formEl);
    }
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

  private renderAgentContextNotice(formEl: HTMLElement): void {
    const section = this.renderIntegrationSection(
      formEl,
      this.draft.id === 'codex' ? 'openai' : 'opencode',
      t('settingsDetails.advanced.agentCliIntegration')
    );

    new Setting(section)
      .setName(t('settingsDetails.advanced.agentCliContext'))
      .setDesc(t('settingsDetails.advanced.agentCliContextDesc'));
  }

  private renderClaudeCodeContextNotice(formEl: HTMLElement): void {
    const section = this.renderIntegrationSection(
      formEl,
      'claude',
      t('settingsDetails.advanced.claudeCodeIntegration')
    );

    new Setting(section)
      .setName(t('settingsDetails.advanced.claudeCodeContext'))
      .setDesc(t('settingsDetails.advanced.claudeCodeContextDesc'));
  }

  private renderOpenCodeContextNotice(formEl: HTMLElement): void {
    const section = this.renderIntegrationSection(
      formEl,
      'opencode',
      t('settingsDetails.advanced.openCodeIntegration')
    );

    new Setting(section)
      .setName(t('settingsDetails.advanced.openCodeContext'))
      .setDesc(t('settingsDetails.advanced.openCodeContextDesc'));
  }

  private renderIntegrationSection(
    formEl: HTMLElement,
    iconName: string,
    title: string,
  ): HTMLElement {
    const section = formEl.createDiv({ cls: 'preset-script-integration-section' });

    const kicker = section.createDiv({
      cls: 'preset-script-integration-kicker',
      text: t('settingsDetails.advanced.contextAwareness'),
    });
    kicker.setAttribute('aria-hidden', 'true');

    const header = section.createDiv({ cls: 'preset-script-integration-header' });
    const icon = header.createDiv({ cls: 'preset-script-integration-icon' });
    renderPresetScriptIcon(icon, iconName);
    header.createDiv({
      cls: 'preset-script-integration-title',
      text: title,
    });

    return section.createDiv({ cls: 'preset-script-integration-body' });
  }

  private isBuiltInPreset(): boolean {
    return this.builtInPresetIds.has(this.draft.id);
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
    row.toggleClass('is-disabled', action.enabled === false);
    this.renderActionEnabledToggle(row, action);
    this.renderActionTypeSelect(row, action);
    this.renderActionValueInput(row, action);
    this.renderActionNoteInput(row, action);
    this.renderActionDeleteButton(row, action);
    this.renderActionMoveUpButton(row, index);
    this.renderActionMoveDownButton(row, index, total);
  }

  private renderActionEnabledToggle(row: HTMLElement, action: PresetWorkflowAction): void {
    const toggleWrap = row.createDiv({ cls: 'preset-workflow-action-toggle' });
    const toggle = new ToggleComponent(toggleWrap);
    toggle.setValue(action.enabled !== false);
    toggle.toggleEl.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptActionEnabled'));
    toggle.onChange((value) => {
      action.enabled = value;
      row.toggleClass('is-disabled', !value);
    });
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
    const valueWrap = row.createDiv({ cls: 'preset-workflow-action-value-wrap' });
    const valueInput = valueWrap.createEl('input', {
      cls: 'preset-workflow-action-value',
      type: 'text',
      placeholder: this.getActionPlaceholder(action.type),
    });
    valueInput.value = action.value;
    valueInput.addEventListener('input', () => {
      action.value = valueInput.value;
    });
    this.attachCommandSuggestions(valueWrap, valueInput, action);
  }

  private renderActionNoteInput(row: HTMLElement, action: PresetWorkflowAction): void {
    const noteInput = row.createEl('textarea', {
      cls: 'preset-workflow-action-note',
      attr: {
        rows: '2',
        placeholder: t('settingsDetails.terminal.presetScriptActionNotePlaceholder'),
        'aria-label': t('settingsDetails.terminal.presetScriptActionNote'),
      },
    });
    noteInput.value = action.note ?? '';
    noteInput.addEventListener('input', () => {
      action.note = noteInput.value;
    });
  }

  private attachCommandSuggestions(
    container: HTMLElement,
    valueInput: HTMLInputElement,
    action: PresetWorkflowAction
  ): void {
    if (action.type !== 'obsidian-command') return;
    if (this.obsidianCommandOptions.length === 0) return;

    const listId = `obsidian-command-options-${action.id}`;
    const suggestionPanel = container.createDiv({
      cls: 'preset-command-suggestion-panel',
      attr: { id: listId, role: 'listbox' },
    });
    let matches: ObsidianCommandOption[] = [];
    let activeIndex = -1;
    let blurTimer: number | null = null;
    let pointerInsidePanel = false;

    valueInput.removeAttribute('list');
    valueInput.setAttribute('autocomplete', 'off');
    valueInput.setAttribute('aria-autocomplete', 'list');
    valueInput.setAttribute('aria-controls', listId);
    valueInput.setAttribute('aria-expanded', 'false');

    const clearBlurTimer = () => {
      if (blurTimer !== null) {
        window.clearTimeout(blurTimer);
        blurTimer = null;
      }
    };

    const closeSuggestionPanel = () => {
      clearBlurTimer();
      suggestionPanel.removeClass('is-open');
      suggestionPanel.empty();
      activeIndex = -1;
      valueInput.setAttribute('aria-expanded', 'false');
      valueInput.removeAttribute('aria-activedescendant');
    };

    const ensureActiveSuggestionVisible = () => {
      if (activeIndex < 0) return;
      const activeEl = suggestionPanel.children.item(activeIndex) as HTMLElement | null;
      activeEl?.scrollIntoView({ block: 'nearest' });
    };

    const setActiveIndex = (nextIndex: number) => {
      if (matches.length === 0) {
        activeIndex = -1;
        valueInput.removeAttribute('aria-activedescendant');
        return;
      }

      const normalizedIndex = ((nextIndex % matches.length) + matches.length) % matches.length;
      activeIndex = normalizedIndex;
      Array.from(suggestionPanel.children).forEach((child, index) => {
        const childEl = child as HTMLElement;
        const isActive = index === normalizedIndex;
        childEl.toggleClass('is-active', isActive);
        childEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive) {
          valueInput.setAttribute('aria-activedescendant', childEl.id);
        }
      });
      ensureActiveSuggestionVisible();
    };

    const selectSuggestion = (option: ObsidianCommandOption) => {
      valueInput.value = option.id;
      action.value = option.id;
      closeSuggestionPanel();
      valueInput.focus();
      valueInput.setSelectionRange(option.id.length, option.id.length);
    };

    const renderSuggestionPanel = (nextMatches: ObsidianCommandOption[]) => {
      matches = nextMatches;
      suggestionPanel.empty();

      if (matches.length === 0) {
        closeSuggestionPanel();
        return;
      }

      matches.forEach((option, index) => {
        const optionEl = suggestionPanel.createDiv({
          cls: 'preset-command-suggestion-item',
          attr: {
            id: `${listId}-option-${index}`,
            role: 'option',
            'aria-selected': 'false',
          },
        });
        optionEl.createDiv({
          cls: 'preset-command-suggestion-name',
          text: option.name,
        });
        optionEl.createDiv({
          cls: 'preset-command-suggestion-id',
          text: option.id,
        });
        optionEl.addEventListener('mouseenter', () => {
          setActiveIndex(index);
        });
        optionEl.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        optionEl.addEventListener('click', () => {
          selectSuggestion(option);
        });
      });

      suggestionPanel.addClass('is-open');
      valueInput.setAttribute('aria-expanded', 'true');
      setActiveIndex(activeIndex >= 0 && activeIndex < matches.length ? activeIndex : 0);
    };

    const refreshSuggestions = (preferredActiveIndex = 0) => {
      const nextMatches = searchObsidianCommandOptions(
        this.obsidianCommandOptions,
        valueInput.value,
        COMMAND_SUGGESTION_LIMIT
      );
      activeIndex = nextMatches.length === 0 ? -1 : Math.min(preferredActiveIndex, nextMatches.length - 1);
      renderSuggestionPanel(nextMatches);
    };

    valueInput.addEventListener('focus', () => {
      clearBlurTimer();
      refreshSuggestions(activeIndex >= 0 ? activeIndex : 0);
    });

    valueInput.addEventListener('input', () => {
      action.value = valueInput.value;
      refreshSuggestions(0);
    });

    valueInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (suggestionPanel.hasClass('is-open')) {
          event.preventDefault();
          closeSuggestionPanel();
        }
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!suggestionPanel.hasClass('is-open')) {
          refreshSuggestions(0);
          return;
        }
        setActiveIndex(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
        return;
      }

      if (event.key === 'Enter' && suggestionPanel.hasClass('is-open') && activeIndex >= 0 && matches[activeIndex]) {
        event.preventDefault();
        selectSuggestion(matches[activeIndex]);
      }
    });

    valueInput.addEventListener('blur', () => {
      clearBlurTimer();
      blurTimer = window.setTimeout(() => {
        if (pointerInsidePanel) {
          return;
        }
        closeSuggestionPanel();
      }, 120);
    });

    suggestionPanel.addEventListener('mouseenter', () => {
      pointerInsidePanel = true;
      clearBlurTimer();
    });

    suggestionPanel.addEventListener('mouseleave', () => {
      pointerInsidePanel = false;
      if (document.activeElement !== valueInput) {
        closeSuggestionPanel();
      }
    });
  }

  private renderActionDeleteButton(row: HTMLElement, action: PresetWorkflowAction): void {
    const deleteBtn = row.createEl('button', {
      cls: 'clickable-icon preset-workflow-action-delete',
      attr: { type: 'button' },
    });
    setIcon(deleteBtn, 'trash');
    deleteBtn.setAttribute('aria-label', t('common.delete'));
    deleteBtn.addEventListener('click', () => {
      this.draft.actions = this.draft.actions.filter((item) => item.id !== action.id);
      this.renderActionRows();
    });
  }

  private renderActionMoveUpButton(row: HTMLElement, index: number): void {
    const moveUpBtn = row.createEl('button', {
      cls: 'clickable-icon preset-workflow-action-move-up',
      attr: { type: 'button' },
    });
    setIcon(moveUpBtn, 'arrow-up');
    moveUpBtn.disabled = index === 0;
    moveUpBtn.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptsMoveUp'));
    moveUpBtn.addEventListener('click', () => {
      this.moveAction(index, index - 1);
    });
  }

  private renderActionMoveDownButton(row: HTMLElement, index: number, total: number): void {
    const moveDownBtn = row.createEl('button', {
      cls: 'clickable-icon preset-workflow-action-move-down',
      attr: { type: 'button' },
    });
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
      enabled: true,
      note: '',
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
    return {
      ...script,
      actions,
    };
  }

  private normalizeAction(action: PresetWorkflowAction): PresetWorkflowAction {
    const id = (action.id || '').trim() || this.createActionId();
    const type = this.parseActionType(action.type);
    const value = (action.value || '').trim();
    const enabled = action.enabled !== false;
    const note = typeof action.note === 'string' ? action.note.trim() : '';
    return { id, type, value, enabled, note };
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

    const updated: PresetScript = {
      ...this.draft,
      name: (this.draft.name || '').trim(),
      icon: (this.draft.icon || '').trim(),
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
