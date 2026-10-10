import { Setting, ToggleComponent, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { DEFAULT_PRESET_SCRIPTS, type PresetScript } from '../settings';
import { t } from '../../i18n';
import { confirmAction } from '../../ui/confirmModal';
import { PresetScriptModal } from '../../ui/terminal/presetScriptModal';
import { renderPresetScriptIcon } from '../../ui/terminal/presetScriptIcons';
import {
  getAiLauncherEntry,
  getUpgradeCommandForPlatform,
  partitionLaunchers,
  type AiLauncherCatalogEntry,
  type AiLauncherCategory,
} from '../../services/terminal/aiLauncherCatalog';
import { readinessToBadge, type AiLauncherStatusSnapshot } from '../../services/terminal/aiLauncherStatus';
import { clearCommandVersionCache } from '../../services/terminal/commandVersionProbe';
import { getLauncherInstallationTooltip } from '../../ui/terminal/launcherInstallationsModal';

interface DragState {
  row: HTMLElement | null;
  index: number | null;
}

type LauncherRowElements = {
  badge: HTMLElement;
  versionEl: HTMLElement;
  installationsButton: HTMLButtonElement;
  updateButton?: HTMLButtonElement;
};

/** Owns the workflow list, its launcher badges, and their subscriptions. */
export class PresetScriptSettings {
  private readonly context: RendererContext;
  private readonly builtInPresetIds = new Set(DEFAULT_PRESET_SCRIPTS.map((script) => script.id));
  private launcherSnapshotUnsubscribers: Array<() => void> = [];
  private refreshOfflineHint: (() => void) | null = null;
  private disposed = false;

  constructor(context: RendererContext) {
    this.context = context;
  }

  refreshUpdateHint(): void {
    this.refreshOfflineHint?.();
  }

  dispose(): void {
    this.disposed = true;
    this.disposeLauncherSnapshotSubscriptions();
    this.refreshOfflineHint = null;
  }

  /**
   * Render preset scripts settings
   */
  render(containerEl: HTMLElement): void {
    const scriptCard = containerEl.createDiv({ cls: 'settings-card' });

    const headerEl = scriptCard.createDiv({ cls: 'preset-scripts-header' });
    const headerText = headerEl.createDiv({ cls: 'preset-scripts-header-text' });
    headerText.createDiv({
      cls: 'preset-scripts-title',
      text: t('settingsDetails.terminal.presetScripts')
    });
    headerText.createDiv({
      cls: 'preset-scripts-desc',
      text: t('settingsDetails.terminal.presetScriptsDesc')
    });

    const headerActions = headerEl.createDiv({ cls: 'preset-scripts-header-actions' });
    const refreshBtn = headerActions.createEl('button', {
      cls: 'preset-scripts-refresh-btn',
      text: t('settingsDetails.terminal.aiLauncherInstallationRefresh'),
    });
    refreshBtn.setAttribute('type', 'button');
    refreshBtn.addEventListener('click', () => {
      void this.refreshLauncherStatuses(refreshBtn);
    });

    const addBtn = headerActions.createEl('button', { cls: 'preset-scripts-add-btn' });
    addBtn.textContent = t('settingsDetails.terminal.presetScriptsAdd');
    addBtn.addEventListener('click', () => {
      const newScript: PresetScript = {
        id: this.createPresetScriptId(),
        name: '',
        icon: '',
        actions: [{
          id: this.createPresetActionId(),
          type: 'terminal-command',
          value: '',
          enabled: true,
          note: '',
        }],
        terminalTitle: '',
        showInStatusBar: true,
        showInCommandPalette: true,
        autoOpenTerminal: true,
        runInNewTerminal: false,
      };
      this.openPresetScriptModal(newScript, true, listEl);
    });

    const listEl = scriptCard.createDiv({ cls: 'preset-scripts-list' });
    this.renderPresetScriptsList(listEl);

    // "Hide unavailable AI launchers" toggle. Lives below the workflow list
    // so power users can declutter their menu after deciding which CLIs they
    // want to keep around. Default is `false` because a fresh install needs
    // the install guidance to be visible.
    new Setting(scriptCard)
      .setName(t('settingsDetails.terminal.hideUnavailableAiLaunchers'))
      .setDesc(t('settingsDetails.terminal.hideUnavailableAiLaunchersDesc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.context.plugin.settings.hideUnavailableAiLaunchers === true)
          .onChange((value) => {
            this.context.plugin.settings.hideUnavailableAiLaunchers = value;
            void this.context.plugin.saveSettings();
          });
      });

    // "Check for AI launcher updates" toggle. Off by default because it
    // introduces outbound traffic to npm and GitHub — the README and
    // AGENTS.md document the additional endpoints when this is enabled.
    //
    // Offline mode wins regardless of this toggle (the README's "no extra
    // outbound traffic" promise is contractual). Surface that interaction
    // inline so the user does not silently wonder why the badges stay
    // green when their CLI is out of date.
    const updateCheckSetting = new Setting(scriptCard)
      .setName(t('settingsDetails.terminal.checkAiLauncherUpdates'))
      .setDesc(t('settingsDetails.terminal.checkAiLauncherUpdatesDesc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.context.plugin.settings.checkAiLauncherUpdates === true)
          .onChange((value) => {
            this.context.plugin.settings.checkAiLauncherUpdates = value;
            void this.context.plugin.saveSettings().then(() => {
              if (value) {
                void this.context.plugin.refreshAiLauncherStatusFromSettings();
              }
            });
          });
      });

    // Inline hint that appears underneath the toggle row when offline
    // mode is active. We render it after the Setting so it sits in the
    // same visual block but is easy to show/hide based on offline state.
    const offlineHintEl = scriptCard.createDiv({
      cls: 'setting-item-description ai-launcher-offline-hint',
    });
    offlineHintEl.setText(t('settingsDetails.terminal.aiLauncherOfflineHint'));

    const refreshOfflineHintVisibility = (): void => {
      const offline = this.context.plugin.settings.serverConnection?.offlineMode === true;
      updateCheckSetting.settingEl.toggleClass('is-offline-suppressed', offline);
      offlineHintEl.toggleClass('is-hidden', !offline);
    };
    refreshOfflineHintVisibility();
    this.refreshOfflineHint = refreshOfflineHintVisibility;
  }

  private async refreshLauncherStatuses(button: HTMLButtonElement): Promise<void> {
    if (this.disposed || button.disabled) return;
    button.disabled = true;
    button.textContent = t('settingsDetails.terminal.aiLauncherInstallationRefreshing');
    try {
      // Snapshot subscriptions repaint existing rows as each fresh probe finishes.
      await this.context.plugin.refreshAiLauncherStatusFromSettings({ force: true });
    } finally {
      button.disabled = false;
      button.textContent = t('settingsDetails.terminal.aiLauncherInstallationRefresh');
    }
  }

  private renderPresetScriptsList(listEl: HTMLElement): void {
    // A pending save or modal result may arrive after the settings tab closes.
    if (this.disposed || !listEl.isConnected) return;
    this.disposeLauncherSnapshotSubscriptions();
    listEl.empty();

    const scripts = this.context.plugin.settings.presetScripts ?? [];

    if (scripts.length === 0) {
      listEl.createDiv({
        cls: 'preset-scripts-empty',
        text: t('settingsDetails.terminal.presetScriptsEmpty')
      });
      return;
    }

    // Partition entries into AI launcher buckets vs. user-defined workflows.
    // Each bucket renders the same row layout but the AI buckets get a
    // category header and a readiness badge so the settings UI mirrors the
    // grouping used by the status bar menu.
    const partition = partitionLaunchers(scripts);

    const indexById = new Map(scripts.map((script, index) => [script.id, index]));
    const dragState: DragState = { row: null, index: null };

    if (partition.codingAgent.length > 0) {
      this.renderPresetScriptsCategoryHeader(listEl, 'coding-agent');
      for (const script of partition.codingAgent) {
        const index = indexById.get(script.id) ?? 0;
        this.renderPresetScriptRow(listEl, script, index, dragState);
      }
    }

    if (partition.regular.length > 0) {
      if (partition.codingAgent.length > 0) {
        this.renderPresetScriptsCategoryHeader(listEl, 'workflow');
      }
      for (const script of partition.regular) {
        const index = indexById.get(script.id) ?? 0;
        this.renderPresetScriptRow(listEl, script, index, dragState);
      }
    }
  }

  /**
   * Render one preset script row. Shared between the AI launcher buckets
   * and the regular workflow bucket so the visual layout stays consistent.
   */
  private renderPresetScriptRow(
    listEl: HTMLElement,
    script: PresetScript,
    index: number,
    dragState: DragState,
  ): void {
    const scripts = this.context.plugin.settings.presetScripts ?? [];
    const row = listEl.createDiv({ cls: 'preset-script-row' });
    row.setAttribute('draggable', 'true');
    row.dataset.index = String(index);

    const isBuiltIn = this.builtInPresetIds.has(script.id);
    const launcherEntry = getAiLauncherEntry(script.id);

    const dragHandle = row.createDiv({ cls: 'preset-script-drag-handle' });
    setIcon(dragHandle, 'grip-vertical');

    const toggleWrap = row.createDiv({ cls: 'preset-script-toggle' });
    row.toggleClass('is-disabled', !script.showInStatusBar);
    const toggle = new ToggleComponent(toggleWrap);
    toggle.setValue(script.showInStatusBar);
    toggle.toggleEl.setAttribute('aria-label', t('settingsDetails.terminal.presetScriptShowInStatusBar'));
    toggle.onChange((value) => {
      script.showInStatusBar = value;
      row.toggleClass('is-disabled', !value);
      void this.context.plugin.saveSettings();
    });

    const iconEl = row.createDiv({ cls: 'preset-script-icon' });
    renderPresetScriptIcon(iconEl, script.icon || 'terminal');

    const contentEl = row.createDiv({ cls: 'preset-script-content' });
    const nameRowEl = contentEl.createDiv({ cls: 'preset-script-name-row' });
    let launcherRow: LauncherRowElements | undefined;
    nameRowEl.createDiv({
      cls: 'preset-script-name',
      text: script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed')
    });
    if (launcherEntry?.detectCommand) {
      const badge = nameRowEl.createDiv({
        cls: 'preset-scripts-menu-status-badge is-checking',
        text: t('settingsDetails.terminal.aiLauncherStatusChecking'),
      });
      const versionEl = nameRowEl.createDiv({
        cls: 'preset-scripts-menu-version is-hidden',
      });
      const installationsButton = nameRowEl.createEl('button', {
        cls: 'termy-launcher-installations-button is-installation-warning is-hidden',
        text: t('settingsDetails.terminal.aiLauncherVersionConflict'),
      });
      installationsButton.addEventListener('click', (event) => {
        event.stopPropagation();
        this.context.plugin.openAiLauncherInstallationsModalForPreset(script);
      });
      launcherRow = { badge, versionEl, installationsButton };
    }
    contentEl.createDiv({
      cls: 'preset-script-command',
      text: this.getPresetScriptCommandPreview(script)
    });

    const actionsEl = row.createDiv({ cls: 'preset-script-actions' });

    // "Update now" affordance for AI launcher rows. Hidden by default
    // and revealed by the snapshot resolver below when the row's CLI
    // has an update available AND the catalog defines an upgrade
    // command for the current platform. Mirrors the same button in
    // the status bar menu so both surfaces feel consistent.
    if (launcherEntry?.detectCommand && launcherRow) {
      const updateBtn = actionsEl.createEl('button', {
        cls: 'clickable-icon preset-script-launcher-update is-hidden',
      });
      setIcon(updateBtn, 'download');
      updateBtn.setAttribute('aria-label', t('settingsDetails.terminal.aiLauncherUpdateAriaLabel'));
      updateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.context.plugin.openAiLauncherUpgradeModalForPreset(script);
      });
      launcherRow.updateButton = updateBtn;
      this.attachLauncherSnapshotInfo(launcherRow, launcherEntry);
    }

    const editBtn = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(editBtn, 'pencil');
    editBtn.setAttribute('aria-label', t('modals.presetScript.titleEdit'));
    editBtn.addEventListener('click', () => {
      this.openPresetScriptModal(this.clonePresetScript(script), false, listEl);
    });

    if (isBuiltIn) {
      const resetBtn = actionsEl.createEl('button', { cls: 'clickable-icon preset-script-reset' });
      setIcon(resetBtn, 'reset');
      resetBtn.setAttribute('aria-label', t('common.reset'));
      resetBtn.addEventListener('click', () => {
        const scriptName = script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed');
        void this.confirmPresetScriptReset(scriptName).then((confirmed) => {
          if (!confirmed) return;
          void this.resetBuiltInPresetScript(listEl, script.id);
        });
      });
    } else {
      const deleteBtn = actionsEl.createEl('button', { cls: 'clickable-icon preset-script-delete' });
      setIcon(deleteBtn, 'trash');
      deleteBtn.setAttribute('aria-label', t('common.delete'));
      deleteBtn.addEventListener('click', () => {
        const scriptName = script.name?.trim() || t('settingsDetails.terminal.presetScriptsUnnamed');
        void this.confirmPresetScriptDelete(scriptName).then((confirmed) => {
          if (!confirmed) return;

          this.context.plugin.settings.presetScripts = scripts.filter(item => item.id !== script.id);
          void this.context.plugin.saveSettings().then(() => {
            this.renderPresetScriptsList(listEl);
          });
        });
      });
    }

    row.addEventListener('dragstart', (e) => {
      dragState.row = row;
      dragState.index = index;
      row.addClass('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
      }
    });

    row.addEventListener('dragend', () => {
      if (dragState.row) {
        dragState.row.removeClass('is-dragging');
      }
      dragState.row = null;
      dragState.index = null;
      listEl.querySelectorAll('.preset-script-row').forEach(el => {
        (el as HTMLElement).removeClass('drag-over-above');
        (el as HTMLElement).removeClass('drag-over-below');
      });
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragState.index === null || dragState.index === index) return;
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      listEl.querySelectorAll('.preset-script-row').forEach(el => {
        (el as HTMLElement).removeClass('drag-over-above');
        (el as HTMLElement).removeClass('drag-over-below');
      });
      if (e.clientY < midY) {
        row.addClass('drag-over-above');
      } else {
        row.addClass('drag-over-below');
      }
    });

    row.addEventListener('dragleave', () => {
      row.removeClass('drag-over-above');
      row.removeClass('drag-over-below');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.removeClass('drag-over-above');
      row.removeClass('drag-over-below');
      if (dragState.index === null || dragState.index === index) return;

      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      let targetIndex = index;
      const draggedIndex = dragState.index;
      if (e.clientY >= midY && draggedIndex < index) {
        targetIndex = index;
      } else if (e.clientY >= midY && draggedIndex > index) {
        targetIndex = index + 1;
      } else if (e.clientY < midY && draggedIndex < index) {
        targetIndex = index - 1;
      } else {
        targetIndex = index;
      }

      void this.movePresetScript(listEl, draggedIndex, targetIndex);
    });
  }

  private renderPresetScriptsCategoryHeader(
    listEl: HTMLElement,
    category: AiLauncherCategory | 'workflow',
  ): void {
    let title: string;
    let description: string;
    if (category === 'coding-agent') {
      title = t('settingsDetails.terminal.aiLauncherCategoryCodingAgent');
      description = t('settingsDetails.terminal.aiLauncherCategoryCodingAgentDesc');
    } else {
      title = t('settingsDetails.terminal.aiLauncherCategoryWorkflow');
      description = t('settingsDetails.terminal.aiLauncherCategoryWorkflowDesc');
    }

    const header = listEl.createDiv({ cls: 'preset-scripts-list-section-header' });
    header.dataset.category = category;
    header.createDiv({ cls: 'preset-scripts-list-section-title', text: title });
    header.createDiv({ cls: 'preset-scripts-list-section-desc', text: description });
  }

  /**
   * Probe the underlying CLI and update the badge in place. Mirrors the
   * behaviour used by the status bar menu so users see the same readiness
   * label and version info everywhere Termy lists their AI launchers.
   *
   * Reads the cached snapshot from the plugin first so the row paints
   * synchronously when a probe has already resolved, then refreshes in
   * the background to catch installs/upgrades made since the last open,
   * and finally subscribes to the plugin's snapshot stream so subsequent
   * refreshes (e.g. after the user toggles offline mode) propagate
   * without requiring the settings page to be reopened.
   */
  private attachLauncherSnapshotInfo(
    elements: LauncherRowElements,
    entry: AiLauncherCatalogEntry,
  ): void {
    const cached = this.context.plugin.getAiLauncherSnapshot(entry.presetId);
    if (cached) {
      this.applyLauncherSnapshotToRow(elements, entry, cached);
    }

    // Subscribe so future probe results (forced refresh after offline
    // mode flips, registry revalidation, etc.) repaint this row in
    // place. The unsubscribe is captured into the array tearDown
    // walks at the next render().
    const unsubscribe = this.context.plugin.onAiLauncherSnapshotsChanged(
      (presetId, snapshot) => {
        if (presetId !== entry.presetId) return;
        this.applyLauncherSnapshotToRow(elements, entry, snapshot);
      },
    );
    this.launcherSnapshotUnsubscribers.push(unsubscribe);

    if (!entry.detectCommand) return;

    // Force-refresh: clear the version probe cache so the settings page
    // always shows the freshest local version. Without this, a stale
    // null from a previous probe (e.g. Obsidian started before the CLI
    // was installed) would persist for up to 60 seconds and the row
    // would show no version even though the CLI is now on PATH.
    clearCommandVersionCache(entry.detectCommand);
    void this.context.plugin.refreshAiLauncherSnapshot(entry);
  }

  /**
   * Apply a snapshot to the badge + version DOM pair created by
   * {@link renderPresetScriptRow}. Centralised so the cached and the
   * refreshed code paths render identically.
   */
  private applyLauncherSnapshotToRow(
    elements: LauncherRowElements,
    entry: AiLauncherCatalogEntry,
    snapshot: AiLauncherStatusSnapshot,
  ): void {
    const { badge, versionEl, installationsButton, updateButton } = elements;
    const status = readinessToBadge(snapshot.readiness);
    const hasConflict = snapshot.installationIssue === 'version-conflict';
    installationsButton.toggleClass('is-hidden', !hasConflict);
    if (hasConflict) installationsButton.setAttribute('title', getLauncherInstallationTooltip(snapshot));
    badge.classList.remove(
      'is-checking',
      'is-ready',
      'is-not-installed',
      'is-update-available',
    );
    switch (status) {
      case 'ready':
        badge.classList.add('is-ready');
        badge.textContent = t('settingsDetails.terminal.aiLauncherStatusReady');
        break;
      case 'not-installed':
        badge.classList.add('is-not-installed');
        badge.textContent = t('settingsDetails.terminal.aiLauncherStatusNotInstalled');
        break;
      case 'update-available':
        badge.classList.add('is-update-available');
        badge.textContent = t('settingsDetails.terminal.aiLauncherStatusUpdateAvailable');
        break;
      case 'checking':
      default:
        badge.classList.add('is-checking');
        badge.textContent = t('settingsDetails.terminal.aiLauncherStatusChecking');
        break;
    }

    versionEl.classList.remove('is-update-available');
    const local = snapshot.local;
    if (!local) {
      versionEl.textContent = '';
      versionEl.classList.add('is-hidden');
    } else {
      versionEl.classList.remove('is-hidden');
      if (snapshot.readiness === 'update-available' && snapshot.latest) {
        versionEl.classList.add('is-update-available');
        versionEl.textContent = `v${local} → v${snapshot.latest}`;
      } else {
        versionEl.textContent = `v${local}`;
      }
    }

    const showUpdate =
      snapshot.readiness === 'update-available'
      && getUpgradeCommandForPlatform(entry) !== null;
    updateButton?.classList.toggle('is-hidden', !showUpdate);
  }

  private openPresetScriptModal(script: PresetScript, isNew: boolean, listEl: HTMLElement): void {
    const modal = new PresetScriptModal(this.context.app, script, (updatedScript) => {
      const scripts = this.context.plugin.settings.presetScripts ?? [];
      const index = scripts.findIndex(item => item.id === updatedScript.id);

      if (index >= 0) {
        scripts[index] = updatedScript;
      } else {
        scripts.push(updatedScript);
      }

      this.context.plugin.settings.presetScripts = scripts;
      void this.context.plugin.saveSettings().then(() => {
        this.renderPresetScriptsList(listEl);
      });
    }, isNew);

    modal.open();
  }

  private async movePresetScript(listEl: HTMLElement, from: number, to: number): Promise<void> {
    const scripts = this.context.plugin.settings.presetScripts ?? [];
    if (from < 0 || from >= scripts.length || to < 0 || to >= scripts.length) {
      return;
    }
    const updated = [...scripts];
    const [item] = updated.splice(from, 1);
    updated.splice(to, 0, item);
    this.context.plugin.settings.presetScripts = updated;
    await this.context.plugin.saveSettings();
    this.renderPresetScriptsList(listEl);
  }

  private createPresetScriptId(): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `preset-${Date.now()}-${random}`;
  }

  private createPresetActionId(): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `action-${Date.now()}-${random}`;
  }

  private getDefaultBuiltInPresetScript(scriptId: string): PresetScript | null {
    const script = DEFAULT_PRESET_SCRIPTS.find((item) => item.id === scriptId);
    return script ? this.clonePresetScript(script) : null;
  }

  private clonePresetScript(script: PresetScript): PresetScript {
    const actions = Array.isArray(script.actions)
      ? script.actions.map((action) => ({ ...action }))
      : [];
    return {
      ...script,
      actions,
    };
  }

  private async resetBuiltInPresetScript(listEl: HTMLElement, scriptId: string): Promise<void> {
    const defaultScript = this.getDefaultBuiltInPresetScript(scriptId);
    if (!defaultScript) {
      return;
    }

    const scripts = this.context.plugin.settings.presetScripts ?? [];
    const index = scripts.findIndex((script) => script.id === scriptId);
    if (index < 0) {
      return;
    }

    const updatedScripts = [...scripts];
    updatedScripts[index] = defaultScript;
    this.context.plugin.settings.presetScripts = updatedScripts;
    await this.context.plugin.saveSettings();
    this.renderPresetScriptsList(listEl);
  }

  private getPresetScriptCommandPreview(script: PresetScript): string {
    const actions = Array.isArray(script.actions) ? script.actions : [];
    const enabledActions = actions.filter((action) => action.enabled !== false);
    if (actions.length === 0) {
      return t('settingsDetails.terminal.presetScriptsEmptyCommand');
    }

    if (enabledActions.length === 0) {
      return t('settingsDetails.terminal.presetScriptsNoEnabledActions');
    }

    const first = enabledActions[0];
    const prefix = first.type === 'obsidian-command'
      ? 'Obsidian'
      : first.type === 'open-external'
        ? 'URL'
        : 'Terminal';
    const normalized = first.value.trim().replace(/\r?\n/g, ' \\n ');
    const suffix = enabledActions.length > 1 ? ` (+${enabledActions.length - 1})` : '';
    const preview = `${prefix}: ${normalized}${suffix}`;
    if (!normalized) {
      return t('settingsDetails.terminal.presetScriptsEmptyCommand');
    }
    return preview.length > 160 ? `${preview.slice(0, 157)}...` : preview;
  }

  private disposeLauncherSnapshotSubscriptions(): void {
    for (const unsubscribe of this.launcherSnapshotUnsubscribers) {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    }
    this.launcherSnapshotUnsubscribers = [];
  }

  private confirmPresetScriptDelete(scriptName: string): Promise<boolean> {
    return confirmAction(
      this.context.app,
      t('settingsDetails.terminal.presetScriptsDeleteConfirm', { name: scriptName })
    );
  }

  private confirmPresetScriptReset(scriptName: string): Promise<boolean> {
    return confirmAction(
      this.context.app,
      t('settingsDetails.terminal.presetScriptsResetConfirm', { name: scriptName })
    );
  }

}
