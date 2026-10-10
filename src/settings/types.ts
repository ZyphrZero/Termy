/**
 * Settings module type definitions
 */

import type { App } from 'obsidian';
import type TerminalPlugin from '../main';

/**
 * Renderer context interface
 * Shared dependencies and state passed to settings renderers
 */
export interface RendererContext {
  /** Obsidian App instance */
  app: App;
  /** Plugin instance */
  plugin: TerminalPlugin;
  /** Settings content container element */
  containerEl: HTMLElement;
  /** Set of currently expanded sections */
  expandedSections: Set<string>;
}

export interface ISettingsRenderer {
  render(context: RendererContext): void;
}
