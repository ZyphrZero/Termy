/**
 * Feature visibility manager
 * Centrally manages UI visibility for terminal features
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
   * Register a feature
   */
  registerFeature(config: FeatureRegistrationConfig): void {
    try {
      this._registeredFeatures.set(config.id, {
        config,
        ribbonRegistered: false,
      });

      // Initialize the ribbon icon
      this.updateRibbonVisibility(config.id);
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to register feature ${config.id}:`, error);
    }
  }

  /**
   * Update visibility for the specified feature
   */
  updateVisibility(featureId: 'terminal'): void {
    const registration = this._registeredFeatures.get(featureId);
    if (!registration) return;

    try {
      // Update the ribbon icon
      this.updateRibbonVisibility(featureId);

      // Invoke the custom callback
      const visibility = registration.config.getVisibility();
      registration.config.onVisibilityChange?.(visibility);
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to update visibility for ${featureId}:`, error);
    }
  }

  /**
   * Update visibility for all registered features
   */
  updateAllVisibility(): void {
    for (const featureId of this._registeredFeatures.keys()) {
      this.updateVisibility(featureId);
    }
  }

  /**
   * Get the feature visibility config
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
   * Check whether the feature is visible at the specified UI position
   */
  isVisibleAt(featureId: 'terminal', position: keyof VisibilityConfig): boolean {
    const visibility = this.getVisibility(featureId);
    if (!visibility) return false;

    // When the feature is disabled, it is hidden in every position
    if (!visibility.enabled) return false;

    return visibility[position] === true;
  }

  /**
   * Update ribbon icon visibility
   */
  private updateRibbonVisibility(featureId: 'terminal'): void {
    const registration = this._registeredFeatures.get(featureId);
    if (!registration?.config.ribbon) return;

    try {
      const visibility = registration.config.getVisibility();
      const shouldShow = visibility.enabled && visibility.showInRibbon;

      if (shouldShow && !this._ribbonIcon) {
        // Add the icon
        const { icon, tooltip, callback } = registration.config.ribbon;
        this._ribbonIcon = this._plugin.addRibbonIcon(icon, tooltip, callback);
        registration.ribbonRegistered = true;
      } else if (!shouldShow && this._ribbonIcon) {
        // Remove the icon
        this._ribbonIcon.remove();
        this._ribbonIcon = null;
        registration.ribbonRegistered = false;
      }
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to update ribbon for ${featureId}:`, error);
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this._ribbonIcon) {
      this._ribbonIcon.remove();
      this._ribbonIcon = null;
    }
    this._registeredFeatures.clear();
  }
}
