/**
 * I18n service
 * Manages language resources and provides translation functions
 */

import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { ru } from './locales/ru';
import type { TranslationKeys, SupportedLocale } from './types';

class I18nService {
  private currentLocale: SupportedLocale = 'en';
  private resources: Record<SupportedLocale, TranslationKeys> = {
    'en': en,
    'zh-CN': zhCN,
    'ja': ja,
    'ko': ko,
    'ru': ru
  };

  /**
   * Initialize the i18n service and detect the current language
   */
  initialize(): void {
    this.currentLocale = this.detectLocale();
  }

  /**
   * Detect Obsidian's current language setting
   * Read the 'language' key from localStorage
   */
  private detectLocale(): SupportedLocale {
    const lang = window.localStorage.getItem('language');
    // zh, zh-CN, and zh-TW all use Chinese
    if (lang && (lang === 'zh' || lang.startsWith('zh-'))) {
      return 'zh-CN';
    }
    if (lang && this.isSupportedLocale(lang)) {
      return lang;
    }

    if (lang && lang.includes('-')) {
      const baseLang = lang.split('-')[0];
      if (this.isSupportedLocale(baseLang)) {
        return baseLang;
      }
    }

    return 'en';
  }

  private isSupportedLocale(locale: string): locale is SupportedLocale {
    return Object.prototype.hasOwnProperty.call(this.resources, locale);
  }

  /**
   * Get translated text
   * @param key Translation key (supports dot-separated nested keys, such as 'settings.tabs.terminal')
   * @param params Interpolation parameters used to replace {{key}} placeholders in the template
   * @returns The translated text, or the original key if not found
   */
  t(key: string, params?: Record<string, string | number>): string {
    const value = this.getNestedValue(this.resources[this.currentLocale], key)
      ?? this.getNestedValue(this.resources['en'], key)
      ?? key;
    
    return params ? this.interpolate(value, params) : value;
  }

  /**
   * Get a value from a nested object
   * @param obj Object
   * @param path Dot-separated path
   * @returns The value or undefined
   */
  private getNestedValue(obj: unknown, path: string): string | undefined {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return typeof current === 'string' ? current : undefined;
  }

  /**
   * Interpolate placeholders
   * @param template Template string
   * @param params Parameter object
   * @returns The interpolated string
   */
  private interpolate(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(params[key] ?? `{{${key}}}`);
    });
  }

  /**
   * Set the current language
   * @param locale The language to set
   */
  setLocale(locale: SupportedLocale): void {
    this.currentLocale = locale;
  }

  /**
   * Get the current language
   */
  getLocale(): SupportedLocale {
    return this.currentLocale;
  }
}

// Export the singleton instance
export const i18n = new I18nService();

// Convenience function for quickly retrieving translations
export const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
