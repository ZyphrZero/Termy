/**
 * 功能可见性管理器
 * 集中管理终端功能的 UI 可见性
 */

import type { Plugin } from 'obsidian';
import type { FeatureRegistrationConfig, FeatureRegistration, VisibilityConfig } from './types';
import { errorLog } from '@/utils/logger';

export class FeatureVisibilityManager {
  private _plugin: Plugin;
  private _registeredFeatures: Map<'terminal', FeatureRegistration>;
  private _ribbonIcon: HTMLElement | null = null;

  constructor(plugin: Plugin) {
    this._plugin = plugin;
    this._registeredFeatures = new Map();
  }

  /**
   * 注册功能模块
   */
  registerFeature(config: FeatureRegistrationConfig): void {
    try {
      this._registeredFeatures.set(config.id, {
        config,
        ribbonRegistered: false,
      });

      // 初始化 Ribbon 图标
      this.updateRibbonVisibility(config.id);
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to register feature ${config.id}:`, error);
    }
  }

  /**
   * 更新指定功能的可见性
   */
  updateVisibility(featureId: 'terminal'): void {
    const registration = this._registeredFeatures.get(featureId);
    if (!registration) return;

    try {
      // 更新 Ribbon 图标
      this.updateRibbonVisibility(featureId);

      // 调用自定义回调
      const visibility = registration.config.getVisibility();
      registration.config.onVisibilityChange?.(visibility);
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to update visibility for ${featureId}:`, error);
    }
  }

  /**
   * 更新所有已注册功能的可见性
   */
  updateAllVisibility(): void {
    for (const featureId of this._registeredFeatures.keys()) {
      this.updateVisibility(featureId);
    }
  }

  /**
   * 获取功能的可见性配置
   */
  getVisibility(featureId: 'terminal'): VisibilityConfig | null {
    const registration = this._registeredFeatures.get(featureId);
    if (!registration) return null;

    try {
      return registration.config.getVisibility();
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to get visibility for ${featureId}:`, error);
      return null;
    }
  }

  /**
   * 检查功能在指定 UI 位置是否可见
   */
  isVisibleAt(featureId: 'terminal', position: keyof VisibilityConfig): boolean {
    const visibility = this.getVisibility(featureId);
    if (!visibility) return false;

    // 功能未启用时，所有位置都不可见
    if (!visibility.enabled) return false;

    return visibility[position] === true;
  }

  /**
   * 更新 Ribbon 图标可见性
   */
  private updateRibbonVisibility(featureId: 'terminal'): void {
    const registration = this._registeredFeatures.get(featureId);
    if (!registration?.config.ribbon) return;

    try {
      const visibility = registration.config.getVisibility();
      const shouldShow = visibility.enabled && visibility.showInRibbon;

      if (shouldShow && !this._ribbonIcon) {
        // 添加图标
        const { icon, tooltip, callback } = registration.config.ribbon;
        this._ribbonIcon = this._plugin.addRibbonIcon(icon, tooltip, callback);
        registration.ribbonRegistered = true;
      } else if (!shouldShow && this._ribbonIcon) {
        // 移除图标
        this._ribbonIcon.remove();
        this._ribbonIcon = null;
        registration.ribbonRegistered = false;
      }
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to update ribbon for ${featureId}:`, error);
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this._ribbonIcon) {
      this._ribbonIcon.remove();
      this._ribbonIcon = null;
    }
    this._registeredFeatures.clear();
  }
}
