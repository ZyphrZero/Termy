/**
 * AI launcher catalog
 *
 * Classifies the built-in workflow launchers into product categories so the
 * status bar menu can group them and surface readiness state. The catalog
 * is purely metadata — actual execution still goes through {@link runPresetScript}.
 *
 * Termy currently only ships "coding agent" launchers (Claude Code, Codex,
 * OpenCode, Hermes). The category type is left as a discriminated union
 * with one arm so it stays explicit at every render site — adding a new
 * product category in the future means widening this type and revisiting
 * every call site, which is exactly the friction we want.
 */

export type AiLauncherCategory = 'coding-agent';

/**
 * Visual readiness state used by the launcher menu.
 *  - 'ready'            → the underlying CLI was found on PATH (or the entry is
 *                         always-available such as a future bundled binary).
 *  - 'not-installed'    → the CLI is missing; the menu shows install guidance.
 *  - 'update-available' → the CLI works locally but the upstream registry
 *                         reports a newer version. Only set when the user
 *                         opted in to update checks.
 *  - 'checking'         → readiness probe is still in flight; transient.
 */
export type AiLauncherStatus = 'ready' | 'not-installed' | 'update-available' | 'checking';

/**
 * Result of partitioning a list of preset scripts by their AI launcher
 * catalog category. Scripts whose id is not in the catalog land in
 * {@link PartitionedLaunchers.regular}.
 */
export interface PartitionedLaunchers<TScript extends { id: string }> {
  codingAgent: TScript[];
  regular: TScript[];
}

/**
 * Where Termy looks up the CLI's latest version. The lookup itself is opt-in
 * and only runs when the user enables `checkAiLauncherUpdates` in settings,
 * because the request goes outbound to npm/GitHub — the README and
 * `AGENTS.md` document this explicitly so the contractual "no extra
 * outbound traffic" promise is preserved by default.
 */
export type LatestVersionRegistry =
  | { kind: 'npm'; package: string }
  | { kind: 'github-release'; repo: string };

/**
 * Catalog entry for a preset script that should be classified as an AI launcher.
 */
export interface AiLauncherCatalogEntry {
  /** Matches the {@link PresetScript.id} so we can reuse the existing workflow runner. */
  presetId: string;
  /** Category bucket used by the status bar menu. */
  category: AiLauncherCategory;
  /** CLI executable to probe with `where` / `which`. */
  detectCommand?: string;
  /** Optional documentation URL surfaced in the install modal. */
  installDocsUrl?: string;
  /**
   * One-liner install commands the user can copy from the install modal.
   * Termy never executes these — the user has to paste them into a shell
   * themselves, which keeps us on the right side of Obsidian's "no
   * plugin-driven updates of native dependencies" policy.
   *
   * Each value is the most ergonomic command for that platform as
   * documented by the upstream project. Leave a platform out if no
   * single command works.
   */
  installCommands?: Partial<Record<NodeJS.Platform, string>>;
  /**
   * One-liner upgrade commands shown when an update is available. Unlike
   * {@link installCommands} these are intended to be run by Termy itself
   * inside a user-visible terminal session — the user clicks "Update now"
   * in the install modal and Termy types the command into a fresh
   * terminal. The upgrade still executes in the user's own shell, so the
   * Obsidian developer policy (no plugin-driven updates) is satisfied:
   * Termy is automating a step the user could type by hand, with full
   * visibility into the output.
   *
   * Leave a platform out if no single command can upgrade the launcher
   * on that platform; the modal then falls back to the install-command
   * card and a docs link.
   */
  upgradeCommands?: Partial<Record<NodeJS.Platform, string>>;
  /**
   * Where to ask for the latest published version of this CLI. Optional
   * because some launchers may ship without a public registry entry.
   */
  versionRegistry?: LatestVersionRegistry;
  /**
   * npm package that can install this launcher. When present, Termy can
   * explain missing Node.js/npm prerequisites and offer an fnm-backed
   * preparation command instead of showing a raw npm command that would fail.
   */
  npmPackage?: string;
}

/**
 * Static catalog. Adding a new built-in launcher means appending an entry here.
 *
 * Termy currently only ships first-party coding agent launchers. When a new
 * product category is introduced, add a new arm to {@link AiLauncherCategory}
 * and update every render site (TypeScript will fail the build until you do).
 */
export const AI_LAUNCHER_CATALOG: readonly AiLauncherCatalogEntry[] = [
  {
    presetId: 'claude-code',
    category: 'coding-agent',
    detectCommand: 'claude',
    installDocsUrl: 'https://docs.anthropic.com/en/docs/claude-code/quickstart',
    installCommands: {
      // Anthropic ships a native installer; no Node.js required.
      // See https://code.claude.com/docs/en/quickstart#step-1-install-claude-code
      darwin: 'curl -fsSL https://claude.ai/install.sh | bash',
      linux: 'curl -fsSL https://claude.ai/install.sh | bash',
      // Default to PowerShell on Windows; the docs URL covers the CMD variant.
      win32: 'irm https://claude.ai/install.ps1 | iex',
    },
    versionRegistry: { kind: 'npm', package: '@anthropic-ai/claude-code' },
    // `claude update` (alias `upgrade`) is the upstream-recommended way
    // to bump the native installer, regardless of how the user installed
    // the binary originally. Same command on every platform.
    upgradeCommands: {
      darwin: 'claude update',
      linux: 'claude update',
      win32: 'claude update',
    },
  },
  {
    presetId: 'codex',
    category: 'coding-agent',
    detectCommand: 'codex',
    installDocsUrl: 'https://github.com/openai/codex',
    installCommands: {
      // OpenAI's two recommended paths from the README; brew avoids
      // pulling in Node when the user has Homebrew.
      darwin: 'brew install --cask codex',
      linux: 'npm install -g @openai/codex',
      win32: 'npm install -g @openai/codex',
    },
    npmPackage: '@openai/codex',
    versionRegistry: { kind: 'npm', package: '@openai/codex' },
    // OpenAI does not ship a `codex update` subcommand yet, so we reuse
    // the install paths with `@latest` for npm and brew's upgrade verb.
    upgradeCommands: {
      darwin: 'brew upgrade --cask codex',
      linux: 'npm install -g @openai/codex@latest',
      win32: 'npm install -g @openai/codex@latest',
    },
  },
  {
    presetId: 'opencode',
    category: 'coding-agent',
    detectCommand: 'opencode',
    installDocsUrl: 'https://opencode.ai/docs',
    installCommands: {
      // OpenCode publishes a single-binary install script for Unix shells.
      darwin: 'curl -fsSL https://opencode.ai/install | bash',
      linux: 'curl -fsSL https://opencode.ai/install | bash',
      // npm works universally on Windows without requiring scoop.
      win32: 'npm install -g opencode-ai',
    },
    npmPackage: 'opencode-ai',
    versionRegistry: { kind: 'github-release', repo: 'anomalyco/opencode' },
    // OpenCode's install script performs in-place upgrades on Unix.
    // On Windows, npm handles the upgrade via @latest.
    upgradeCommands: {
      darwin: 'curl -fsSL https://opencode.ai/install | bash',
      linux: 'curl -fsSL https://opencode.ai/install | bash',
      win32: 'npm install -g opencode-ai@latest',
    },
  },
  {
    presetId: 'hermes',
    category: 'coding-agent',
    detectCommand: 'hermes',
    installDocsUrl: 'https://hermes-agent.nousresearch.com/docs/getting-started/installation',
    installCommands: {
      // Nous Research publishes a one-line installer for each platform.
      // The POSIX script clones into ~/.hermes and adds `hermes` to
      // ~/.local/bin (or /usr/local/bin under root).
      darwin: 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
      linux: 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
      // The native Windows installer is in early beta upstream — see the
      // docs URL for the WSL2 fallback. The PowerShell one-liner is the
      // upstream-recommended starting point.
      win32: 'irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex',
    },
    versionRegistry: { kind: 'github-release', repo: 'NousResearch/hermes-agent' },
    // The install scripts also handle in-place upgrades by re-cloning
    // the repo under their managed prefix, so the upgrade command is
    // identical to the install command on every platform.
    upgradeCommands: {
      darwin: 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
      linux: 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
      win32: 'irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex',
    },
  },
  {
    presetId: 'deepseek-tui',
    category: 'coding-agent',
    // The CLI dispatcher binary is named `deepseek` (not
    // `deepseek-tui` — that is the npm package name and the
    // companion runtime binary). Detect by the dispatcher.
    detectCommand: 'deepseek',
    installDocsUrl: 'https://github.com/Hmbown/DeepSeek-TUI#install',
    installCommands: {
      // Upstream's recommended cross-platform path is the npm wrapper
      // that downloads the matching prebuilt Rust binaries from the
      // GitHub release. It works identically on macOS, Linux, and
      // Windows, which keeps the install modal one-liner across the
      // three desktop platforms Termy supports.
      darwin: 'npm install -g deepseek-tui',
      linux: 'npm install -g deepseek-tui',
      win32: 'npm install -g deepseek-tui',
    },
    npmPackage: 'deepseek-tui',
    versionRegistry: { kind: 'npm', package: 'deepseek-tui' },
    // The dispatcher exposes `deepseek update` for in-place release
    // binary updates regardless of how the user installed initially,
    // matching DeepSeek TUI's documented update path.
    upgradeCommands: {
      darwin: 'deepseek update',
      linux: 'deepseek update',
      win32: 'deepseek update',
    },
  },
];

const CATALOG_INDEX = new Map<string, AiLauncherCatalogEntry>(
  AI_LAUNCHER_CATALOG.map((entry) => [entry.presetId, entry])
);

export function getAiLauncherEntry(presetId: string): AiLauncherCatalogEntry | undefined {
  return CATALOG_INDEX.get(presetId);
}

/**
 * Pick the install command the launcher modal should display, based on the
 * current platform. Returns null when no upstream command is documented for
 * the platform — the modal then falls back to its docs link.
 */
export function getInstallCommandForPlatform(
  entry: AiLauncherCatalogEntry,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const commands = entry.installCommands;
  if (!commands) return null;
  const exact = commands[platform];
  if (typeof exact === 'string' && exact.length > 0) return exact;
  return null;
}

/**
 * Pick the upgrade command the launcher modal should run when the user
 * clicks "Update now". Returns null when no upgrade command is documented
 * for the platform — the modal then falls back to the install command +
 * docs link instead of offering a one-click upgrade.
 */
export function getUpgradeCommandForPlatform(
  entry: AiLauncherCatalogEntry,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const commands = entry.upgradeCommands;
  if (!commands) return null;
  const exact = commands[platform];
  if (typeof exact === 'string' && exact.length > 0) return exact;
  return null;
}

/**
 * Partition a list of preset scripts (or any object exposing an `id`) into
 * the catalog buckets used by the status bar menu and the settings page.
 * Scripts not present in the catalog land in {@link PartitionedLaunchers.regular}.
 *
 * Pure function — kept side-effect free so it can be unit tested in isolation
 * without spawning command detectors.
 */
export function partitionLaunchers<TScript extends { id: string }>(
  scripts: readonly TScript[],
): PartitionedLaunchers<TScript> {
  const codingAgent: TScript[] = [];
  const regular: TScript[] = [];

  for (const script of scripts) {
    const entry = CATALOG_INDEX.get(script.id);
    if (!entry) {
      regular.push(script);
      continue;
    }
    if (entry.category === 'coding-agent') {
      codingAgent.push(script);
    }
  }

  return { codingAgent, regular };
}

/**
 * Map a {@link CommandAvailability}-style result onto the badge status.
 * Centralised so menu and settings page apply the same rule.
 */
export function commandAvailabilityToLauncherStatus(
  availability: 'ready' | 'not-installed' | 'unknown',
): AiLauncherStatus {
  if (availability === 'ready') return 'ready';
  if (availability === 'not-installed') return 'not-installed';
  return 'ready';
}
