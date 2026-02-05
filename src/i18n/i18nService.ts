/**
 * I18n 服务
 * 负责管理语言资源和提供翻译功能
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
   * 初始化 i18n 服务，检测当前语言
   */
  initialize(): void {
    this.currentLocale = this.detectLocale();
  }

  /**
   * 检测 Obsidian 当前语言设置
   * 从 localStorage 读取 'language' 键
   */
  private detectLocale(): SupportedLocale {
    const lang = window.localStorage.getItem('language');
    // zh, zh-CN, zh-TW 都使用中文
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
   * 获取翻译文本
   * @param key 翻译键（支持点号分隔的嵌套键，如 'settings.tabs.terminal'）
   * @param params 插值参数，用于替换模板中的 {{key}} 占位符
   * @returns 翻译后的文本，如果找不到则返回原始键名
   */
  t(key: string, params?: Record<string, string | number>): string {
    const value = this.getNestedValue(this.resources[this.currentLocale], key)
      ?? this.getNestedValue(this.resources['en'], key)
      ?? key;
    
    return params ? this.interpolate(value, params) : value;
  }

  /**
   * 获取嵌套对象的值
   * @param obj 对象
   * @param path 点号分隔的路径
   * @returns 值或 undefined
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
   * 插值替换
   * @param template 模板字符串
   * @param params 参数对象
   * @returns 替换后的字符串
   */
  private interpolate(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(params[key] ?? `{{${key}}}`);
    });
  }

  /**
   * 设置当前语言
   * @param locale 要设置的语言
   */
  setLocale(locale: SupportedLocale): void {
    this.currentLocale = locale;
  }

  /**
   * 获取当前语言
   */
  getLocale(): SupportedLocale {
    return this.currentLocale;
  }
}

// 导出单例实例
export const i18n = new I18nService();

// 便捷函数，用于快速获取翻译
export const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
