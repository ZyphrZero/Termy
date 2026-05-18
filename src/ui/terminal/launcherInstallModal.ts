/**
 * Modal shown when a user clicks an AI launcher whose underlying CLI is not
 * installed, or when the user explicitly opens the install dialog from a
 * launcher that has an update available.
 *
 * The modal:
 *
 *   1. Tells the user which command was probed and where Termy looked.
 *   2. Surfaces the local + latest versions when known, including a clear
 *      "X → Y" hint when an update is available.
 *   3. Provides the upstream's recommended one-liner install command for
 *      the current platform, copy-paste friendly.
 *   4. Lets the user open the official docs or attempt the launcher anyway.
 *   5. When Node.js / npm cannot be detected, points the user at the
 *      official Node.js download page without recommending any specific
 *      version manager. Termy treats fnm, nvm, asdf, mise, volta, and
 *      direct installs identically: once Node.js is reachable from the
 *      user's shell PATH, the launcher install will work.
 *
 * It deliberately does NOT execute the install command itself. The user has
 * to paste it into a shell themselves. This keeps Termy on the right side
 * of Obsidian's "no plugin-driven updates of native dependencies" policy.
 */

import type { App } from 'obsidian';
import { Modal, Notice } from 'obsidian';
import { shell } from 'electron';
import { t } from '../../i18n';
import { getNodeRuntimeRecommendation, type NodeRuntimeSnapshot } from '../../services/terminal/nodeRuntime';

export type LauncherInstallCommandKind = 'launcher' | 'node-missing';

export interface LauncherInstallModalOptions {
  /** Display name shown in the modal header (e.g. "Claude Code"). */
  name: string;
  /** Detected command name (e.g. "claude"). */
  command: string;
  /** External documentation link. Optional. */
  docsUrl?: string;
  /**
   * One-liner install command for the current platform. When provided, the
   * modal shows it as a copy-paste friendly code block. Null when Termy
   * has no command to recommend (e.g. Node.js is missing — in that case
   * the modal points to the Node.js download page instead).
   */
  installCommand?: string | null;
  /** What the install command prepares; changes the card copy. */
  installCommandKind?: LauncherInstallCommandKind;
  /**
   * One-liner upgrade command for the current platform. Shown alongside
   * an "Update now" button when {@link updateAvailable} is true.
   */
  upgradeCommand?: string | null;
  /** Local version reported by `<command> --version`, if known. */
  localVersion?: string | null;
  /** Latest published version reported by the upstream registry, if known. */
  latestVersion?: string | null;
  /**
   * True when local < latest. Drives the modal title and the description
   * tone — "Update Foo" instead of "Foo is not installed".
   */
  updateAvailable?: boolean;
  /** Node.js/npm/fnm readiness for npm-backed launchers. */
  nodeRuntime?: NodeRuntimeSnapshot | null;
  /**
   * Invoked when the user clicks "Run anyway".
   */
  onRunAnyway?: () => void;
  /**
   * Invoked when the user clicks "Update now". Implementations should
   * spawn a Termy terminal and run the upgrade command in it. Only
   * provided when an upgrade command exists for the current platform.
   */
  onRunUpgrade?: () => void;
  /**
   * Invoked when the user clicks "Install now". Implementations should
   * spawn a Termy terminal and run the install command in it. Only
   * provided when an install command exists for the current platform
   * AND the launcher is currently missing — otherwise we keep the
   * primary CTA focused on the upgrade or the docs link.
   */
  onRunInstall?: () => void;
}

export class LauncherInstallModal extends Modal {
  private readonly options: LauncherInstallModalOptions;

  constructor(app: App, options: LauncherInstallModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('termy-launcher-install-modal');
    contentEl.empty();

    const titleEl = contentEl.createDiv({ cls: 'modal-title' });
    titleEl.createDiv({
      cls: 'modal-title-text',
      text: this.options.updateAvailable
        ? t('modals.launcherInstall.titleUpdate', { name: this.options.name })
        : t('modals.launcherInstall.titleNotInstalled', { name: this.options.name }),
    });

    const descEl = contentEl.createEl('p', { cls: 'termy-launcher-install-desc' });
    descEl.setText(this.buildDescription());

    if (this.options.updateAvailable) {
      this.renderVersionDelta(contentEl);
    } else if (this.options.command) {
      // Fall back to the detected-command hint when the launcher is missing
      // entirely. We surface the version row separately when known.
      const detail = contentEl.createDiv({ cls: 'termy-launcher-install-detail' });
      detail.createDiv({
        cls: 'termy-launcher-install-detail-label',
        text: t('modals.launcherInstall.detectedCommand'),
      });
      detail.createEl('code', {
        cls: 'termy-launcher-install-detail-command',
        text: this.options.command,
      });
    }

    if (!this.options.updateAvailable && this.options.nodeRuntime) {
      this.renderRuntimeDiagnostics(contentEl, this.options.nodeRuntime);
    }

    // The card prefers the upgrade command when an update is available
    // AND the catalog supplied one — `claude update`, `brew upgrade …`,
    // or the OpenCode in-place install script. Otherwise we fall back to
    // the install command (also used for the not-installed state).
    const cardCommand = this.options.updateAvailable && this.options.upgradeCommand
      ? this.options.upgradeCommand
      : this.options.installCommand;
    if (cardCommand) {
      this.renderInstallCommand(contentEl, cardCommand);
    } else if (this.options.installCommandKind === 'node-missing') {
      this.renderNodeMissingCard(contentEl);
    }

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    if (this.options.updateAvailable && this.options.onRunUpgrade && this.options.upgradeCommand) {
      // Primary CTA when an upgrade is on offer: run the upgrade command
      // in a fresh Termy terminal. Stays beside the docs link so users
      // who prefer to inspect the change first can still do so.
      const updateBtn = buttonContainer.createEl('button', {
        cls: 'mod-cta',
        text: t('modals.launcherInstall.buttonUpdateNow'),
      });
      updateBtn.addEventListener('click', () => {
        this.close();
        this.options.onRunUpgrade?.();
      });
    } else if (this.options.onRunInstall && this.options.installCommand) {
      // Primary CTA for the not-installed state: run the upstream's
      // install command in a fresh Termy terminal. Symmetric with
      // "Update now", and avoids the previous footgun where Run anyway
      // would just spawn the missing launcher binary itself.
      const installBtn = buttonContainer.createEl('button', {
        cls: 'mod-cta',
        text: t('modals.launcherInstall.buttonInstallNow'),
      });
      installBtn.addEventListener('click', () => {
        this.close();
        this.options.onRunInstall?.();
      });
    }

    if (this.options.docsUrl) {
      const docsBtn = buttonContainer.createEl('button', {
        cls:
          (this.options.updateAvailable && this.options.onRunUpgrade)
          || (this.options.onRunInstall && this.options.installCommand)
            ? ''
            : 'mod-cta',
        text: t('modals.launcherInstall.buttonOpenDocs'),
      });
      docsBtn.addEventListener('click', () => {
        const url = this.options.docsUrl;
        if (url) {
          void shell.openExternal(url);
        }
        this.close();
      });
    }

    if (this.options.onRunAnyway) {
      const retryBtn = buttonContainer.createEl('button', {
        cls: 'mod-warning',
        text: this.options.updateAvailable
          ? t('modals.launcherInstall.buttonRunCurrentVersion')
          : t('modals.launcherInstall.buttonRunAnyway'),
      });
      retryBtn.addEventListener('click', () => {
        this.close();
        this.options.onRunAnyway?.();
      });
    }

    const cancelBtn = buttonContainer.createEl('button', {
      cls: 'mod-cancel',
      text: t('modals.launcherInstall.buttonClose'),
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private buildDescription(): string {
    if (this.options.updateAvailable) {
      const local = this.options.localVersion ?? '?';
      const latest = this.options.latestVersion ?? '?';
      return t('modals.launcherInstall.descriptionUpdate', {
        name: this.options.name,
        local,
        latest,
      });
    }
    return t('modals.launcherInstall.descriptionNotInstalled', {
      command: this.options.command || this.options.name,
    });
  }

  private renderVersionDelta(contentEl: HTMLElement): void {
    const detail = contentEl.createDiv({ cls: 'termy-launcher-install-detail' });
    detail.createDiv({
      cls: 'termy-launcher-install-detail-label',
      text: t('modals.launcherInstall.versionLabel'),
    });
    const local = this.options.localVersion ?? '?';
    const latest = this.options.latestVersion ?? '?';
    detail.createEl('code', {
      cls: 'termy-launcher-install-detail-command',
      text: `${local} → ${latest}`,
    });
  }

  /**
   * Render the install command card with a copy-to-clipboard button. The
   * command itself is shown as an unselectable-but-readable <code> block
   * so users can also drag-select if the Copy button fails for any reason.
   */
  private renderInstallCommand(contentEl: HTMLElement, command: string): void {
    const showingUpgrade = this.options.updateAvailable === true && this.options.upgradeCommand === command;
    const card = contentEl.createDiv({ cls: 'termy-launcher-install-card' });
    card.createDiv({
      cls: 'termy-launcher-install-card-title',
      text: showingUpgrade
        ? t('modals.launcherInstall.cardTitleUpgradeOneClick')
        : this.options.updateAvailable
          ? t('modals.launcherInstall.cardTitleUpgrade')
          : t('modals.launcherInstall.cardTitleInstall'),
    });
    card.createEl('p', {
      cls: 'termy-launcher-install-card-desc',
      text: showingUpgrade
        ? t('modals.launcherInstall.cardDescUpgradeOneClick')
        : this.options.updateAvailable
          ? t('modals.launcherInstall.cardDescUpgrade')
          : t('modals.launcherInstall.cardDescInstall'),
    });

    const commandRow = card.createDiv({ cls: 'termy-launcher-install-command-row' });
    const commandEl = commandRow.createEl('code', {
      cls: 'termy-launcher-install-command',
      text: command,
    });

    const copyBtn = commandRow.createEl('button', {
      cls: 'termy-launcher-install-command-copy',
      text: t('modals.launcherInstall.buttonCopy'),
    });
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(command)
        .then(() => {
          new Notice(t('notices.presetScript.launcherCopied'), 2000);
        })
        .catch(() => {
          // Fallback: select the command text so the user can copy manually.
          const range = activeDocument.createRange();
          range.selectNodeContents(commandEl);
          const selection = activeDocument.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        });
    });
  }

  /**
   * Card shown when Termy could not find Node.js or npm. Points the
   * user at the Node.js download page without endorsing any specific
   * version manager. Once Node.js is reachable from the user's shell
   * PATH, the standard install command card will take over on the
   * next visit.
   */
  private renderNodeMissingCard(contentEl: HTMLElement): void {
    const card = contentEl.createDiv({ cls: 'termy-launcher-install-card' });
    card.createDiv({
      cls: 'termy-launcher-install-card-title',
      text: t('modals.launcherInstall.cardTitleInstallNode'),
    });
    card.createEl('p', {
      cls: 'termy-launcher-install-card-desc',
      text: t('modals.launcherInstall.cardDescInstallNode'),
    });
  }

  private renderRuntimeDiagnostics(contentEl: HTMLElement, runtime: NodeRuntimeSnapshot): void {
    const panel = contentEl.createDiv({ cls: 'termy-launcher-runtime-panel' });
    panel.createDiv({
      cls: 'termy-launcher-runtime-title',
      text: t('modals.launcherInstall.runtimeTitle'),
    });
    panel.createEl('p', {
      cls: 'termy-launcher-runtime-desc',
      text: this.getRuntimeDescription(runtime),
    });

    const list = panel.createDiv({ cls: 'termy-launcher-runtime-list' });
    this.renderRuntimeRow(list, t('modals.launcherInstall.runtimeNode'), runtime.node);
    this.renderRuntimeRow(list, t('modals.launcherInstall.runtimeNpm'), runtime.npm);
  }

  private renderRuntimeRow(
    container: HTMLElement,
    label: string,
    command: NodeRuntimeSnapshot['node'],
  ): void {
    const row = container.createDiv({ cls: 'termy-launcher-runtime-row' });
    row.createDiv({ cls: 'termy-launcher-runtime-label', text: label });
    const status = row.createDiv({
      cls: `termy-launcher-runtime-status is-${command.availability}`,
      text: this.getRuntimeStatusLabel(command),
    });
    if (command.path) {
      status.setAttr('title', command.path);
    }
  }

  private getRuntimeDescription(runtime: NodeRuntimeSnapshot): string {
    const recommendation = getNodeRuntimeRecommendation(runtime);
    if (recommendation === 'npm-ready') {
      return t('modals.launcherInstall.runtimeDescNpmReady');
    }
    if (recommendation === 'node-missing') {
      return t('modals.launcherInstall.runtimeDescNodeMissing');
    }
    return t('modals.launcherInstall.runtimeDescUnknown');
  }

  private getRuntimeStatusLabel(command: NodeRuntimeSnapshot['node']): string {
    if (command.availability === 'ready') {
      return command.version
        ? t('modals.launcherInstall.runtimeStatusReadyVersion', { version: command.version })
        : t('modals.launcherInstall.runtimeStatusReady');
    }
    if (command.availability === 'not-installed') {
      return t('modals.launcherInstall.runtimeStatusMissing');
    }
    return t('modals.launcherInstall.runtimeStatusUnknown');
  }
}
