/**
 * Feature visibility type definitions
 */

/**
 * Feature visibility config interface
 */
export interface VisibilityConfig {
  /** Whether the feature is enabled (master switch) */
  enabled: boolean;
  /** Whether to show in the command palette */
  showInCommandPalette: boolean;
  /** Whether to show an icon in the ribbon */
  showInRibbon: boolean;
  /** Whether to show in new tabs */
  showInNewTab: boolean;
  /** Whether to show in the status bar */
  showInStatusBar: boolean;
}

/**
 * Default visibility config
 */
export const DEFAULT_VISIBILITY_CONFIG: VisibilityConfig = {
  enabled: true,
  showInCommandPalette: true,
  showInRibbon: true,
  showInNewTab: true,
  showInStatusBar: false,
};

/**
 * Ribbon icon config
 */
export interface RibbonConfig {
  /** Icon name (Obsidian icon name) */
  icon: string;
  /** Tooltip text */
  tooltip: string;
  /** Click callback */
  callback: () => void | Promise<void>;
}

/**
 * Feature registration config
 */
export interface FeatureRegistrationConfig {
  /** Feature identifier */
  id: 'terminal';
  /** Function that gets the visibility config */
  getVisibility: () => VisibilityConfig;
  /** Ribbon icon config (optional) */
  ribbon?: RibbonConfig;
  /** Visibility change callback (optional) */
  onVisibilityChange?: (visibility: VisibilityConfig) => void;
}

/**
 * Feature registration info
 */
export interface FeatureRegistration {
  config: FeatureRegistrationConfig;
  ribbonRegistered: boolean;
}
