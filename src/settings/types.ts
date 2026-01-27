/**
 * 设置模块类型定义
 */

import type { App } from 'obsidian';
import type TerminalPlugin from '../main';

/**
 * 渲染器上下文接口
 * 传递给设置渲染器的共享依赖和状态
 */
export interface RendererContext {
  /** Obsidian App 实例 */
  app: App;
  /** 插件实例 */
  plugin: TerminalPlugin;
  /** 设置内容容器元素 */
  containerEl: HTMLElement;
  /** 当前展开的区块集合 */
  expandedSections: Set<string>;
}

/**
 * 设置渲染器接口
 */
export interface ISettingsRenderer {
  /**
   * 渲染设置内容
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void;
}
