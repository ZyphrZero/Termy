/**
 * Terminal settings type definitions
 * Includes all terminal-related configuration options
 */

import type { VisibilityConfig } from '@/services/visibility';

/** Shell types supported on Windows */
export type WindowsShellType = 'cmd' | 'powershell' | 'pwsh' | 'wsl' | 'gitbash' | 'custom';

/** Shell types supported on Unix platforms (macOS/Linux) */
export type UnixShellType = 'bash' | 'zsh' | 'custom';

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

  // Debug settings
  enableDebugLog: boolean;
}

/**
 * Workflow action type
 */
export type PresetWorkflowActionType = 'terminal-command' | 'obsidian-command' | 'open-external';

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
  /**
   * @deprecated Use actions instead. This field is kept only for legacy configuration migration.
   */
  command: string;
  actions: PresetWorkflowAction[];
  terminalTitle: string;
  showInStatusBar: boolean;
  autoOpenTerminal: boolean;
  runInNewTerminal: boolean;
}

/**
 * Server connection settings
 */
export interface ServerConnectionSettings {
  downloadAcceleratorUrl: string;
  offlineMode: boolean;
  autoRegisterCodexCliMcp: boolean;
}

/**
 * Default server connection settings
 */
export const DEFAULT_SERVER_CONNECTION_SETTINGS: ServerConnectionSettings = {
  downloadAcceleratorUrl: '',
  offlineMode: false,
  autoRegisterCodexCliMcp: true,
};

/**
 * Default preset scripts
 */
export const DEFAULT_PRESET_SCRIPTS: PresetScript[] = [
  {
    id: 'claude-code',
    name: 'Claude Code Open',
    icon: 'claude',
    command: 'claude',
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
    autoOpenTerminal: true,
    runInNewTerminal: false,
  },
  {
    id: 'codex',
    name: 'Codex Open',
    icon: 'openai',
    command: 'codex',
    actions: [
      {
        id: 'action-codex-install',
        type: 'terminal-command',
        value: 'npm install -g @openai/codex oh-my-codex',
        enabled: false,
        note: 'Install Codex CLI & oh-my-codex',
      },
      {
        id: 'action-codex',
        type: 'terminal-command',
        value: 'codex',
        enabled: true,
        note: '',
      },
    ],
    terminalTitle: 'Codex',
    showInStatusBar: true,
    autoOpenTerminal: true,
    runInNewTerminal: false,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini Open',
    icon: 'google',
    command: 'gemini',
    actions: [
      {
        id: 'action-gemini-cli',
        type: 'terminal-command',
        value: 'gemini',
        enabled: true,
        note: '',
      },
    ],
    terminalTitle: 'Gemini CLI',
    showInStatusBar: true,
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
  scrollback: 1000,
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
  enableDebugLog: false,
};

/**
 * Default settings (alias for compatibility)
 */
export const DEFAULT_SETTINGS = DEFAULT_TERMINAL_SETTINGS;
