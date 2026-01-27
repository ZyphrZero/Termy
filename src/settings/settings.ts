/**
 * 终端设置类型定义
 * 包含所有终端相关的配置选项
 */

import type { VisibilityConfig } from '@/services/visibility';

/** Windows 平台支持的 Shell 类型 */
export type WindowsShellType = 'cmd' | 'powershell' | 'wsl' | 'gitbash' | 'custom';

/** Unix 平台（macOS/Linux）支持的 Shell 类型 */
export type UnixShellType = 'bash' | 'zsh' | 'custom';

/** 所有 Shell 类型的联合 */
export type ShellType = WindowsShellType | UnixShellType;

/**
 * 平台特定的 Shell 配置
 */
export interface PlatformShellConfig {
  windows: WindowsShellType;
  darwin: UnixShellType;  // macOS
  linux: UnixShellType;
}

/**
 * 平台特定的自定义 Shell 路径
 */
export interface PlatformCustomShellPaths {
  windows: string;
  darwin: string;
  linux: string;
}

/**
 * 终端设置接口
 */
export interface TerminalSettings {
  // 各平台的默认 Shell 程序类型（独立存储）
  platformShells: PlatformShellConfig;

  // 各平台的自定义 Shell 路径（独立存储）
  platformCustomShellPaths: PlatformCustomShellPaths;

  // 默认启动参数
  shellArgs: string[];

  // 启动目录设置
  autoEnterVaultDirectory: boolean; // 打开终端时自动进入项目目录

  // 新实例行为：替换标签页、新标签页、新窗口、水平/垂直分屏、左侧/右侧标签页或分屏
  newInstanceBehavior: 'replaceTab' | 'newTab' | 'newLeftTab' | 'newLeftSplit' |
    'newRightTab' | 'newRightSplit' | 'newHorizontalSplit' | 'newVerticalSplit' | 'newWindow';

  // 在现有终端附近创建新实例
  createInstanceNearExistingOnes: boolean;

  // 聚焦新实例：创建新终端时是否自动切换到该标签页
  focusNewInstance: boolean;

  // 锁定新实例：新建终端标签页是否默认锁定
  lockNewInstance: boolean;

  // 终端外观设置
  fontSize: number;
  fontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;

  // 主题设置
  useObsidianTheme: boolean;      // 是否使用 Obsidian 主题颜色
  backgroundColor?: string;        // 自定义背景色
  foregroundColor?: string;        // 自定义前景色

  // 背景图片设置
  backgroundImage?: string;        // 背景图片 URL
  backgroundImageOpacity?: number; // 背景图片透明度 (0-1.0)
  backgroundImageSize?: 'cover' | 'contain' | 'auto'; // 背景图片大小
  backgroundImagePosition?: string; // 背景图片位置
  
  // 毛玻璃效果
  enableBlur?: boolean;            // 是否启用毛玻璃效果
  blurAmount?: number;             // 毛玻璃模糊程度 (0-20px)

  // 文本透明度
  textOpacity?: number;            // 文本透明度 (0-1.0)

  // 渲染器类型：Canvas（推荐）、WebGL（高性能）
  // 注意：DOM 渲染器已过时，存在光标定位等问题，不再提供
  preferredRenderer: 'canvas' | 'webgl';

  // 滚动缓冲区大小（行数）
  scrollback: number;

  // 终端面板默认高度（像素）
  defaultHeight: number;

  // 功能可见性设置
  visibility: VisibilityConfig;

  // 调试设置
  enableDebugLog: boolean;
}

/**
 * 默认平台 Shell 配置
 */
export const DEFAULT_PLATFORM_SHELLS: PlatformShellConfig = {
  windows: 'cmd',
  darwin: 'zsh',
  linux: 'bash'
};

/**
 * 默认平台自定义 Shell 路径
 */
export const DEFAULT_PLATFORM_CUSTOM_SHELL_PATHS: PlatformCustomShellPaths = {
  windows: '',
  darwin: '',
  linux: ''
};

/**
 * 获取当前平台的 Shell 类型
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
 * 设置当前平台的 Shell 类型
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
 * 获取当前平台的自定义 Shell 路径
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
 * 设置当前平台的自定义 Shell 路径
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
 * 默认终端设置
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
  defaultHeight: 300,
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
  enableDebugLog: false,
};

/**
 * 默认设置（别名，用于兼容）
 */
export const DEFAULT_SETTINGS = DEFAULT_TERMINAL_SETTINGS;
