/**
 * Agent settings renderer — "Agents" section in the settings tab.
 * Allows users to view, add, edit, reorder, delete, and reset ACP agent configs.
 */

import { Modal, Setting, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import type { AgentConfig, AgentConfigValidation } from '../../services/agentStream/agentConfig';
import { validateAgentConfig } from '../../services/agentStream/agentConfig';
import { BUILT_IN_AGENTS } from '../../services/agentStream/builtInAgents';
import {
  getAcpAgentInstallEntry,
  isAcpAgentUsingRegistryCommand,
} from '../../services/agentStream/acpAgentInstallRegistry';
import {
  detectCommandAvailability,
  type CommandAvailability,
} from '../../services/terminal/commandAvailability';
import type { SettingsAccessor } from '../settingsAccessor';
import { getCustomAgentSettingsRows } from '../agentSettingsRows';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';

export class AgentSettingsRenderer extends BaseSettingsRenderer {
  private settingsAccessor: SettingsAccessor | null = null;

  render(context: RendererContext): void {
    this.context = context;
    this.settingsAccessor = context.plugin.getSettingsAccessor();
    this.renderAgentList(context.containerEl);
  }

  private renderAgentList(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: 'settings-card' });
    new Setting(card)
      .setName(t('settingsDetails.agents.heading'))
      .setDesc(t('settingsDetails.agents.headingDesc'))
      .setHeading();

    const headerActions = card.createDiv({ cls: 'agent-settings-header-actions' });
    const addBtn = headerActions.createEl('button', {
      cls: 'agent-settings-add-btn',
      text: t('settingsDetails.agents.addAgent'),
    });
    addBtn.addEventListener('click', () => { this.openEditModal(null); });

    const listEl = card.createDiv({ cls: 'agent-settings-list' });
    this.renderAgentRows(listEl);
  }

  private renderAgentRows(listEl: HTMLElement): void {
    listEl.empty();
    const agents = getCustomAgentSettingsRows(this.settingsAccessor?.getAllAgents() ?? []);
    if (agents.length === 0) {
      listEl.createDiv({
        cls: 'agent-settings-empty',
        text: t('settingsDetails.agents.emptyCustomAgents'),
      });
      return;
    }
    for (let i = 0; i < agents.length; i++) {
      this.renderAgentRow(listEl, agents[i], i, agents.length);
    }
  }

  private renderAgentRow(
    listEl: HTMLElement, agent: AgentConfig, index: number, total: number,
  ): void {
    const row = listEl.createDiv({ cls: 'agent-settings-row' });

    // Enabled toggle
    const toggleEl = row.createDiv({ cls: 'agent-settings-row-toggle' });
    const toggle = toggleEl.createEl('input', { type: 'checkbox' });
    toggle.checked = agent.enabled;
    toggle.addEventListener('change', () => {
      void this.settingsAccessor?.upsertAgent({ ...agent, enabled: toggle.checked });
    });

    // Label + command preview
    const infoEl = row.createDiv({ cls: 'agent-settings-row-info' });
    const labelRowEl = infoEl.createDiv({ cls: 'agent-settings-row-label-row' });
    labelRowEl.createDiv({ cls: 'agent-settings-row-label', text: agent.label });
    infoEl.createDiv({
      cls: 'agent-settings-row-command',
      text: [agent.command, ...(agent.args ?? [])].join(' '),
    });

    // Action buttons
    const actionsEl = row.createDiv({ cls: 'agent-settings-row-actions' });
    this.renderAcpAdapterControls(agent, labelRowEl, actionsEl);
    this.addIconBtn(actionsEl, 'pencil', 'settingsDetails.agents.editAgent', () => {
      this.openEditModal(agent);
    });
    this.addIconBtn(actionsEl, 'arrow-up', 'settingsDetails.agents.moveUp', () => {
      void this.moveAgent(index, index - 1);
    }, index === 0);
    this.addIconBtn(actionsEl, 'arrow-down', 'settingsDetails.agents.moveDown', () => {
      void this.moveAgent(index, index + 1);
    }, index === total - 1);

    // Delete button (disabled for built-in agents)
    const deleteBtn = this.addIconBtn(
      actionsEl, 'trash-2', 'settingsDetails.agents.deleteAgent',
      () => { void this.settingsAccessor?.removeAgent(agent.id).then(() => this.rerender()); },
      agent.isBuiltIn,
    );
    if (agent.isBuiltIn) {
      deleteBtn.setAttr('title', t('settingsDetails.agents.cannotDeleteBuiltIn'));
    }

    // Reset button (only when built-in agent is modified)
    if (agent.isBuiltIn && this.isBuiltInModified(agent)) {
      this.addIconBtn(actionsEl, 'rotate-ccw', 'settingsDetails.agents.resetAgent', () => {
        void this.settingsAccessor?.resetAgentToBuiltIn(agent.id).then(() => this.rerender());
      });
    }
  }

  private renderAcpAdapterControls(
    agent: AgentConfig,
    labelRowEl: HTMLElement,
    actionsEl: HTMLElement,
  ): void {
    const entry = getAcpAgentInstallEntry(agent.id);
    if (!entry || !isAcpAgentUsingRegistryCommand(agent, entry)) return;

    const badge = labelRowEl.createDiv({
      cls: 'preset-scripts-menu-status-badge agent-settings-acp-status is-checking',
      text: t('settingsDetails.agents.acpAdapterStatusChecking'),
    });
    const installBtn = this.addIconBtn(
      actionsEl,
      'download',
      'settingsDetails.agents.installAcpAdapter',
      () => {
        this.context.plugin.openAcpAgentInstallModal(agent);
      },
    );
    installBtn.addClass('agent-settings-acp-install');
    installBtn.addClass('is-hidden');

    void this.refreshAcpAdapterStatus(agent.command, badge, installBtn);
  }

  private async refreshAcpAdapterStatus(
    command: string,
    badge: HTMLElement,
    installBtn: HTMLButtonElement,
  ): Promise<void> {
    const status = await detectCommandAvailability(command);
    if (!badge.isConnected) return;
    this.applyAcpAdapterStatus(badge, installBtn, status);
  }

  private applyAcpAdapterStatus(
    badge: HTMLElement,
    installBtn: HTMLButtonElement,
    status: CommandAvailability,
  ): void {
    badge.removeClass('is-ready');
    badge.removeClass('is-not-installed');
    badge.removeClass('is-checking');
    const missing = status === 'not-installed';
    if (status === 'ready') {
      badge.addClass('is-ready');
      badge.setText(t('settingsDetails.agents.acpAdapterStatusReady'));
    } else if (missing) {
      badge.addClass('is-not-installed');
      badge.setText(t('settingsDetails.agents.acpAdapterStatusMissing'));
    } else {
      badge.addClass('is-checking');
      badge.setText(t('settingsDetails.agents.acpAdapterStatusUnknown'));
    }
    installBtn.toggleClass('is-hidden', !missing);
  }

  private addIconBtn(
    parent: HTMLElement, icon: string, labelKey: string,
    onClick: () => void, disabled = false,
  ): HTMLButtonElement {
    const btn = parent.createEl('button', {
      cls: 'agent-settings-action-btn',
      attr: { 'aria-label': t(labelKey) },
    });
    setIcon(btn, icon);
    btn.disabled = disabled;
    if (!disabled) btn.addEventListener('click', onClick);
    return btn;
  }

  private isBuiltInModified(agent: AgentConfig): boolean {
    const orig = BUILT_IN_AGENTS.find((b) => b.id === agent.id);
    if (!orig) return false;
    return (
      agent.label !== orig.label ||
      agent.command !== orig.command ||
      JSON.stringify(agent.args ?? []) !== JSON.stringify(orig.args ?? []) ||
      JSON.stringify(agent.env ?? {}) !== JSON.stringify(orig.env ?? {}) ||
      agent.icon !== orig.icon ||
      agent.description !== orig.description ||
      agent.enabled !== orig.enabled
    );
  }

  private async moveAgent(from: number, to: number): Promise<void> {
    const agents = this.settingsAccessor?.getAllAgents() ?? [];
    const customAgents = agents.filter((agent) => !agent.isBuiltIn);
    const customIds = customAgents.map((agent) => agent.id);
    const [moved] = customIds.splice(from, 1);
    customIds.splice(to, 0, moved);
    const orderedIds = [
      ...agents.filter((agent) => agent.isBuiltIn).map((agent) => agent.id),
      ...customIds,
    ];
    await this.settingsAccessor?.reorderAgents(orderedIds);
    this.rerender();
  }

  private rerender(): void {
    const card = this.context.containerEl.querySelector('.agent-settings-list');
    if (card instanceof HTMLElement) this.renderAgentRows(card);
  }

  private openEditModal(config: AgentConfig | null): void {
    if (!this.context) return;
    new AgentEditModal(
      this.context.app, config, this.settingsAccessor, () => this.rerender(),
    ).open();
  }
}

/**
 * Modal for editing or creating an agent configuration.
 */
class AgentEditModal extends Modal {
  private config: AgentConfig | null;
  private accessor: SettingsAccessor | null;
  private onSaved: () => void;
  private errorEls = new Map<string, HTMLElement>();
  private saveBtn: HTMLButtonElement | null = null;
  private formId = '';
  private formLabel = '';
  private formCommand = '';
  private formArgs = '';
  private formEnv = '';
  private formIcon = '';
  private formDescription = '';
  private formEnabled = true;

  constructor(
    app: import('obsidian').App, config: AgentConfig | null,
    accessor: SettingsAccessor | null, onSaved: () => void,
  ) {
    super(app);
    this.config = config;
    this.accessor = accessor;
    this.onSaved = onSaved;
    if (config) {
      this.formId = config.id;
      this.formLabel = config.label;
      this.formCommand = config.command;
      this.formArgs = (config.args ?? []).join(' ');
      this.formEnv = envToString(config.env);
      this.formIcon = config.icon ?? '';
      this.formDescription = config.description ?? '';
      this.formEnabled = config.enabled;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('agent-edit-modal');
    const title = this.config
      ? t('settingsDetails.agents.editAgentTitle')
      : t('settingsDetails.agents.addAgentTitle');
    contentEl.createEl('h2', { text: title });

    this.addField(contentEl, 'id', (v) => { this.formId = v; this.validateForm(); }, this.config !== null);
    this.addField(contentEl, 'label', (v) => { this.formLabel = v; this.validateForm(); });
    this.addField(contentEl, 'command', (v) => { this.formCommand = v; this.validateForm(); });
    this.addField(contentEl, 'args', (v) => { this.formArgs = v; });
    this.addField(contentEl, 'env', (v) => { this.formEnv = v; });
    this.addField(contentEl, 'icon', (v) => { this.formIcon = v; });
    this.addField(contentEl, 'description', (v) => { this.formDescription = v; });

    // Enabled toggle
    const enabledRow = contentEl.createDiv({ cls: 'agent-edit-field' });
    enabledRow.createDiv({ cls: 'agent-edit-field-label', text: t('settingsDetails.agents.fieldEnabled') });
    const enabledToggle = enabledRow.createEl('input', { type: 'checkbox' });
    enabledToggle.checked = this.formEnabled;
    enabledToggle.addEventListener('change', () => { this.formEnabled = enabledToggle.checked; });

    // Buttons
    const btnContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancelBtn = btnContainer.createEl('button', { cls: 'mod-cancel', text: t('common.cancel') });
    cancelBtn.addEventListener('click', () => { this.close(); });
    this.saveBtn = btnContainer.createEl('button', { cls: 'mod-cta', text: t('common.save') });
    this.saveBtn.addEventListener('click', () => { void this.handleSave(); });
    this.validateForm();
  }

  onClose(): void { this.contentEl.empty(); }

  private addField(
    container: HTMLElement, key: string,
    onChange: (v: string) => void, disabled = false,
  ): void {
    const fieldKey = key as keyof AgentConfig;
    const value = this.getFormValue(fieldKey);
    const fieldEl = container.createDiv({ cls: 'agent-edit-field' });
    fieldEl.createDiv({
      cls: 'agent-edit-field-label',
      text: t(`settingsDetails.agents.field${key.charAt(0).toUpperCase()}${key.slice(1)}`),
    });
    const input = fieldEl.createEl('input', { type: 'text', cls: 'agent-edit-field-input', value });
    if (disabled) input.disabled = true;
    input.addEventListener('input', () => { onChange(input.value); });
    const errorEl = fieldEl.createDiv({ cls: 'agent-edit-field-error' });
    this.errorEls.set(fieldKey, errorEl);
  }

  private getFormValue(key: keyof AgentConfig): string {
    switch (key) {
      case 'id': return this.formId;
      case 'label': return this.formLabel;
      case 'command': return this.formCommand;
      case 'args': return this.formArgs;
      case 'env': return this.formEnv;
      case 'icon': return this.formIcon;
      case 'description': return this.formDescription;
      default: return '';
    }
  }

  private validateForm(): AgentConfigValidation {
    const candidate = this.buildConfig();
    const siblings = this.accessor?.getAllAgents() ?? [];
    const validation = validateAgentConfig(candidate, siblings);
    for (const el of this.errorEls.values()) {
      el.textContent = '';
      el.removeClass('is-visible');
    }
    for (const err of validation.errors) {
      const el = this.errorEls.get(err.field);
      if (el) { el.textContent = t(err.messageKey); el.addClass('is-visible'); }
    }
    if (this.saveBtn) this.saveBtn.disabled = !validation.ok;
    return validation;
  }

  private buildConfig(): AgentConfig {
    const args = this.formArgs.trim()
      ? this.formArgs.split(' ').filter((s) => s.length > 0)
      : undefined;
    const env = parseEnv(this.formEnv);
    return {
      id: this.formId.trim(),
      label: this.formLabel.trim(),
      command: this.formCommand.trim(),
      args,
      env: env && Object.keys(env).length > 0 ? env : undefined,
      icon: this.formIcon.trim() || undefined,
      description: this.formDescription.trim() || undefined,
      enabled: this.formEnabled,
      isBuiltIn: this.config?.isBuiltIn ?? false,
      rememberPermissions: this.config?.rememberPermissions,
    };
  }

  private async handleSave(): Promise<void> {
    const validation = this.validateForm();
    if (!validation.ok) return;
    const result = await this.accessor?.upsertAgent(this.buildConfig());
    if (result && !result.ok) {
      for (const err of result.errors) {
        const el = this.errorEls.get(err.field);
        if (el) { el.textContent = t(err.messageKey); el.addClass('is-visible'); }
      }
      return;
    }
    this.onSaved();
    this.close();
  }
}

// Utility: convert env record to display string
function envToString(env: Readonly<Record<string, string>> | undefined): string {
  if (!env) return '';
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
}

// Utility: parse KEY=VALUE lines into a record
function parseEnv(raw: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined;
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key) result[key] = val;
    }
  }
  return result;
}
