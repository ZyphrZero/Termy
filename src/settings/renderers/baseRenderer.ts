/**
 * 基础设置渲染器
 * 提供所有设置渲染器的共享基类和工具方法
 */

import type { RendererContext, ISettingsRenderer } from '../types';

/**
 * 条件区域渲染函数类型
 */
type ConditionalRenderFn = (container: HTMLElement) => void;

/**
 * 基础设置渲染器抽象类
 * 所有具体的设置渲染器都应继承此类
 */
export abstract class BaseSettingsRenderer implements ISettingsRenderer {
  protected context!: RendererContext;

  /**
   * 渲染设置内容
   * 子类必须实现此方法
   * @param context 渲染器上下文
   */
  abstract render(context: RendererContext): void;

  /**
   * 切换条件渲染区域的显示/隐藏
   * 用于局部更新 DOM，避免全量刷新导致滚动位置丢失
   * 
   * @param container 父容器元素
   * @param sectionId 区域唯一标识，用于生成 CSS 类名
   * @param shouldShow 是否显示该区域
   * @param renderFn 渲染函数，仅在需要显示且区域不存在时调用
   * @param insertAfter 可选，指定插入位置的参考元素
   */
  protected toggleConditionalSection(
    container: HTMLElement,
    sectionId: string,
    shouldShow: boolean,
    renderFn: ConditionalRenderFn,
    insertAfter?: HTMLElement
  ): void {
    // 参数校验：container 为空时静默返回
    if (!container) {
      return;
    }

    const sectionClass = `conditional-section-${sectionId}`;
    const existingSection = container.querySelector<HTMLElement>(`.${sectionClass}`);

    if (shouldShow && !existingSection) {
      // 创建新区域
      const sectionEl = container.createDiv({ cls: sectionClass });
      
      // 如果指定了 insertAfter，则插入到该元素之后
      if (insertAfter && insertAfter.nextSibling) {
        container.insertBefore(sectionEl, insertAfter.nextSibling);
      } else if (insertAfter && !insertAfter.nextSibling) {
        // insertAfter 是最后一个元素，直接追加
        container.appendChild(sectionEl);
      }
      // 如果没有指定 insertAfter，元素已经被 createDiv 追加到末尾
      
      // 调用渲染函数填充内容
      try {
        renderFn(sectionEl);
      } catch (error) {
        // 捕获渲染错误，记录日志但不影响其他设置项
        console.error(`[Settings] Error rendering conditional section "${sectionId}":`, error);
      }
    } else if (!shouldShow && existingSection) {
      // 移除现有区域
      existingSection.remove();
    }
    // 状态未变化时不执行任何操作（幂等性）
  }

  /**
   * 保存设置
   */
  protected async saveSettings(): Promise<void> {
    await this.context.plugin.saveSettings();
  }
}
