/**
 * 功能可见性类型定义
 */

/**
 * 功能可见性配置接口
 */
export interface VisibilityConfig {
  /** 功能是否启用（主开关） */
  enabled: boolean;
  /** 是否在命令面板中显示 */
  showInCommandPalette: boolean;
  /** 是否在侧边栏显示图标 */
  showInRibbon: boolean;
  /** 是否在新标签页中显示 */
  showInNewTab: boolean;
  /** 是否在状态栏显示 */
  showInStatusBar: boolean;
}

/**
 * 默认可见性配置
 */
export const DEFAULT_VISIBILITY_CONFIG: VisibilityConfig = {
  enabled: true,
  showInCommandPalette: true,
  showInRibbon: true,
  showInNewTab: true,
  showInStatusBar: false,
};

/**
 * Ribbon 图标配置
 */
export interface RibbonConfig {
  /** 图标名称 (Obsidian icon name) */
  icon: string;
  /** 提示文本 */
  tooltip: string;
  /** 点击回调 */
  callback: () => void | Promise<void>;
}

/**
 * 功能注册配置
 */
export interface FeatureRegistrationConfig {
  /** 功能标识符 */
  id: 'terminal';
  /** 获取可见性配置的函数 */
  getVisibility: () => VisibilityConfig;
  /** Ribbon 图标配置（可选） */
  ribbon?: RibbonConfig;
  /** 可见性变更回调（可选） */
  onVisibilityChange?: (visibility: VisibilityConfig) => void;
}

/**
 * 功能注册信息
 */
export interface FeatureRegistration {
  config: FeatureRegistrationConfig;
  ribbonRegistered: boolean;
}
