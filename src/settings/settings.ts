/**
 * Terminal settings type definitions
 * Includes all terminal-related configuration options
 */

import type { VisibilityConfig } from '@/services/visibility';
import type { AgentConfig } from '@/services/agentStream/agentConfig';
import type { PermissionRule } from './types';

/** Terminal programs that can be launched from the shell selector when installed */
export type TerminalShellType = 'tmux';

/** Shell types supported on Windows */
export type WindowsShellType = 'cmd' | 'powershell' | 'pwsh' | 'wsl' | 'gitbash' | TerminalShellType | 'custom';

/** Shell types supported on Unix platforms (macOS/Linux) */
export type UnixShellType = 'bash' | 'zsh' | TerminalShellType | 'custom';

/** Union of all shell types */
export type ShellType = WindowsShellType | UnixShellType;

/**
 * Platform-specific shell configuration
 */
export interface PlatformShellConfig {
  windows: WindowsShellType;
  darwin: UnixShellType;  // macOS
  linux: UnixShellType;
}

/**
 * Platform-specific custom shell paths
 */
export interface PlatformCustomShellPaths {
  windows: string;
  darwin: string;
  linux: string;
}

/**
 * Termy-owned metadata for the Agent panel's unified thread pool.
 *
 * Provider history files remain read-only. Rename and archive actions
 * are persisted as an overlay keyed by provider + external thread id.
 */
export interface AgentThreadMeta {
  readonly providerId: string;
  readonly threadId: string;
  readonly title?: string;
  readonly archived?: boolean;
  readonly updatedAt?: number;
}

/**
 * Terminal settings interface
 */
export interface TerminalSettings {
  // Default shell program type for each platform (stored separately)
  platformShells: PlatformShellConfig;

  // Custom shell path for each platform (stored separately)
  platformCustomShellPaths: PlatformCustomShellPaths;

  // Default launch arguments
  shellArgs: string[];

  // Startup directory settings
  autoEnterVaultDirectory: boolean; // Automatically enter the project directory when opening a terminal

  // New instance behavior: replace tab, new tab, new window, horizontal/vertical split, or left/right tab or split
  newInstanceBehavior: 'replaceTab' | 'newTab' | 'newLeftTab' | 'newLeftSplit' |
    'newRightTab' | 'newRightSplit' | 'newHorizontalSplit' | 'newVerticalSplit' | 'newWindow';

  // Create new instances near existing terminals
  createInstanceNearExistingOnes: boolean;

  // Focus new instances: whether to automatically switch to the tab when creating a new terminal
  focusNewInstance: boolean;

  // Lock new instances: whether newly created terminal tabs are locked by default
  lockNewInstance: boolean;

  // Terminal appearance settings
  fontSize: number;
  fontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;

  // Theme settings
  useObsidianTheme: boolean;      // Whether to use Obsidian theme colors
  backgroundColor?: string;        // Custom background color
  foregroundColor?: string;        // Custom foreground color

  // Background image settings
  backgroundImage?: string;        // Background image URL
  backgroundImageOpacity?: number; // Background image opacity (0-1.0)
  backgroundImageSize?: 'cover' | 'contain' | 'auto'; // Background image size
  backgroundImagePosition?: string; // Background image position
  
  // Frosted glass effect
  enableBlur?: boolean;            // Whether to enable the frosted glass effect
  blurAmount?: number;             // Frosted glass blur amount (0-20px)

  // Text opacity
  textOpacity?: number;            // Text opacity (0-1.0)

  // Renderer type: Canvas (recommended), WebGL (high performance)
  // Note: The DOM renderer is deprecated and is no longer provided due to issues such as cursor positioning
  preferredRenderer: 'canvas' | 'webgl';

  // Scrollback buffer size (in lines)
  scrollback: number;


  // Feature visibility settings
  visibility: VisibilityConfig;

  // Server connection settings
  serverConnection: ServerConnectionSettings;

  // Preset scripts
  presetScripts: PresetScript[];

  // When true, hide AI launchers whose underlying CLI was not found on PATH.
  // Default false so a fresh install still shows install guidance for every
  // built-in launcher; experienced users can flip this to declutter their menu.
  hideUnavailableAiLaunchers: boolean;

  // When true, Termy queries the npm registry / GitHub Releases API to find
  // out whether a newer version of each AI launcher CLI is available.
  // Default false because it introduces outbound traffic that the README
  // and AGENTS.md disclose only when the user opts in.
  checkAiLauncherUpdates: boolean;

  // Optional absolute path to a Node.js executable used for npm-backed AI
  // launcher diagnostics. When blank, Termy resolves node/npm from PATH.
  customNodePath: string;

  // Latest version whose changelog modal has already been shown
  lastSeenChangelogVersion: string;

  // Debug settings
  enableDebugLog: boolean;

  // ACP (Agent Client Protocol) — multi-agent panel configuration.
  //
  // These fields are populated lazily by the settings defaults helper
  // when a fresh install (or a pre-ACP install) loads its data: any
  // missing/empty value is filled with the built-in defaults via a
  // pure `applyDefaults` pass that never reads or mutates the legacy
  // `presetScripts` array. There is no `settingsSchemaVersion`
  // counter and no `vN -> vN+1` migration helper — absence of an ACP
  // field is the signal that defaults must be supplied.
  //
  // - `agents` — ordered list of ACP-compatible agents shown in the
  //   panel. Editing happens through `SettingsAccessor` which validates
  //   against `validateAgentConfig` and dispatches `AgentDiff` events
  //   to the `AgentManager`.
  // - `permissionRules` — persisted decisions from the permission
  //   modal's `allow_always` / `reject_always` outcomes; matched by
  //   `(agentId, op, pathPrefix)` to short-circuit future prompts.
  // - `permissionApprovalEnabled` — when `true` (default) the
  //   permission queue surfaces a modal for every
  //   `session/request_permission`; when `false` the queue falls back
  //   to auto-approving the first allow-style option for parity with
  //   pre-ACP behavior.
  agents: readonly AgentConfig[];
  permissionRules: readonly PermissionRule[];
  permissionApprovalEnabled: boolean;
  agentThreadMeta: readonly AgentThreadMeta[];
}

/**
 * Workflow action type
 */
export type PresetWorkflowActionType = 'terminal-command' | 'obsidian-command' | 'open-external';

export type BinaryDownloadSource = 'github-release' | 'cloudflare-r2';

/**
 * Workflow action definition
 */
export interface PresetWorkflowAction {
  id: string;
  type: PresetWorkflowActionType;
  value: string;
  enabled: boolean;
  note: string;
}

/**
 * Preset workflow definition
 */
export interface PresetScript {
  id: string;
  /** Source ID of the workflow marketplace template (present only for marketplace imports) */
  sourceTemplateId?: string;
  name: string;
  icon: string;
  actions: PresetWorkflowAction[];
  terminalTitle: string;
  showInStatusBar: boolean;
  showInCommandPalette: boolean;
  autoOpenTerminal: boolean;
  runInNewTerminal: boolean;
}

/**
 * Server connection settings
 */
export interface ServerConnectionSettings {
  binaryDownloadSource: BinaryDownloadSource;
  offlineMode: boolean;
}

/**
 * Default server connection settings
 */
export const DEFAULT_SERVER_CONNECTION_SETTINGS: ServerConnectionSettings = {
  binaryDownloadSource: 'cloudflare-r2',
  offlineMode: false,
};

/**
 * Default preset scripts
 */
export const CODEX_LAUNCH_COMMAND =
  'codex';

export const OPENCODE_LAUNCH_COMMAND =
  'opencode';

export const HERMES_LAUNCH_COMMAND =
  'hermes';

const CONTEXT_AWARE_PRESET_SCRIPT_IDS = new Set(['claude-code', 'codex', 'opencode']);

export function isContextAwarePresetScript(script: Pick<PresetScript, 'id'>): boolean {
  return CONTEXT_AWARE_PRESET_SCRIPT_IDS.has(script.id);
}

export const DEFAULT_PRESET_SCRIPTS: PresetScript[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'claude',
    actions: [
      {
        id: 'action-claude-code',
        type: 'terminal-command',
        value: 'claude',
        enabled: true,
        note: '',
      },
    ],
    terminalTitle: 'Claude Code',
    showInStatusBar: true,
    showInCommandPalette: true,
    autoOpenTerminal: true,
    runInNewTerminal: false,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    icon: 'codex',
    actions: [
      {
        id: 'action-codex',
        type: 'terminal-command',
        value: CODEX_LAUNCH_COMMAND,
        enabled: true,
        note: 'Launch Codex with Obsidian context',
      },
    ],
    terminalTitle: 'Codex',
    showInStatusBar: true,
    showInCommandPalette: true,
    autoOpenTerminal: true,
    runInNewTerminal: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: 'opencode',
    actions: [
      {
        id: 'action-opencode',
        type: 'terminal-command',
        value: OPENCODE_LAUNCH_COMMAND,
        enabled: true,
        note: 'Launch OpenCode with Obsidian context',
      },
    ],
    terminalTitle: 'OpenCode',
    showInStatusBar: true,
    showInCommandPalette: true,
    autoOpenTerminal: true,
    runInNewTerminal: false,
  },
  {
    id: 'hermes',
    name: 'Hermes',
    icon: 'hermes',
    actions: [
      {
        id: 'action-hermes',
        type: 'terminal-command',
        value: HERMES_LAUNCH_COMMAND,
        enabled: true,
        note: 'Launch Hermes Agent in the current vault',
      },
    ],
    terminalTitle: 'Hermes',
    showInStatusBar: true,
    showInCommandPalette: true,
    autoOpenTerminal: true,
    runInNewTerminal: false,
  },
];

/**
 * Default platform shell configuration
 */
export const DEFAULT_PLATFORM_SHELLS: PlatformShellConfig = {
  windows: 'cmd',
  darwin: 'zsh',
  linux: 'bash'
};

/**
 * Default platform custom shell paths
 */
export const DEFAULT_PLATFORM_CUSTOM_SHELL_PATHS: PlatformCustomShellPaths = {
  windows: '',
  darwin: '',
  linux: ''
};

/**
 * Get the shell type for the current platform
 */
export function getCurrentPlatformShell(settings: TerminalSettings): ShellType {
  const platform = process.platform;
  if (platform === 'win32') {
    return settings.platformShells.windows;
  } else if (platform === 'darwin') {
    return settings.platformShells.darwin;
  } else {
    return settings.platformShells.linux;
  }
}

/**
 * Set the shell type for the current platform
 */
export function setCurrentPlatformShell(settings: TerminalSettings, shellType: ShellType): void {
  const platform = process.platform;
  if (platform === 'win32') {
    settings.platformShells.windows = shellType as WindowsShellType;
  } else if (platform === 'darwin') {
    settings.platformShells.darwin = shellType as UnixShellType;
  } else {
    settings.platformShells.linux = shellType as UnixShellType;
  }
}

/**
 * Get the custom shell path for the current platform
 */
export function getCurrentPlatformCustomShellPath(settings: TerminalSettings): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return settings.platformCustomShellPaths.windows;
  } else if (platform === 'darwin') {
    return settings.platformCustomShellPaths.darwin;
  } else {
    return settings.platformCustomShellPaths.linux;
  }
}

/**
 * Set the custom shell path for the current platform
 */
export function setCurrentPlatformCustomShellPath(
  settings: TerminalSettings,
  path: string
): void {
  const platform = process.platform;
  if (platform === 'win32') {
    settings.platformCustomShellPaths.windows = path;
  } else if (platform === 'darwin') {
    settings.platformCustomShellPaths.darwin = path;
  } else {
    settings.platformCustomShellPaths.linux = path;
  }
}

/**
 * Default terminal settings
 */
export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  platformShells: { ...DEFAULT_PLATFORM_SHELLS },
  platformCustomShellPaths: { ...DEFAULT_PLATFORM_CUSTOM_SHELL_PATHS },
  shellArgs: [],
  autoEnterVaultDirectory: true,
  newInstanceBehavior: 'newHorizontalSplit',
  createInstanceNearExistingOnes: true,
  focusNewInstance: true,
  lockNewInstance: false,
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  cursorStyle: 'block',
  cursorBlink: true,
  useObsidianTheme: true,
  preferredRenderer: 'canvas',
  scrollback: 5000,
  backgroundImageOpacity: 0.5,
  backgroundImageSize: 'cover',
  backgroundImagePosition: 'center',
  enableBlur: false,
  blurAmount: 10,
  textOpacity: 1.0,
  visibility: {
    enabled: true,
    showInCommandPalette: true,
    showInRibbon: true,
    showInNewTab: true,
    showInStatusBar: false,
  },
  serverConnection: { ...DEFAULT_SERVER_CONNECTION_SETTINGS },
  presetScripts: [...DEFAULT_PRESET_SCRIPTS],
  hideUnavailableAiLaunchers: false,
  checkAiLauncherUpdates: true,
  customNodePath: '',
  lastSeenChangelogVersion: '',
  enableDebugLog: false,
  // ACP defaults: leave both arrays empty so that the dedicated
  // `applyDefaults` pass (task 2.2) can detect a fresh/pre-ACP install
  // and inject the built-in agent list. `permissionApprovalEnabled`
  // is on by default so users see the permission modal until they
  // opt out explicitly.
  agents: [],
  permissionRules: [],
  permissionApprovalEnabled: true,
  agentThreadMeta: [],
};
