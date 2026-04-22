/**
 * Base settings renderer
 * Provides the shared base class and utility methods for all settings renderers
 */

import type { RendererContext, ISettingsRenderer } from '../types';

/**
 * Conditional section render function type
 */
type ConditionalRenderFn = (container: HTMLElement) => void;

/**
 * Abstract base settings renderer class
 * All concrete settings renderers should extend this class
 */
export abstract class BaseSettingsRenderer implements ISettingsRenderer {
  protected context!: RendererContext;

  /**
   * Render settings content
   * Subclasses must implement this method
   * @param context Renderer context
   */
  abstract render(context: RendererContext): void;

  /**
   * Toggle the visibility of a conditionally rendered section
   * Used for partial DOM updates to avoid losing the scroll position during a full refresh
   * 
   * @param container Parent container element
   * @param sectionId Unique section identifier used to generate the CSS class name
   * @param shouldShow Whether the section should be shown
   * @param renderFn Render function, called only when the section needs to be shown and does not exist yet
   * @param insertAfter Optional reference element that specifies the insertion position
   */
  protected toggleConditionalSection(
    container: HTMLElement,
    sectionId: string,
    shouldShow: boolean,
    renderFn: ConditionalRenderFn,
    insertAfter?: HTMLElement
  ): void {
    // Validate parameters: return silently when container is empty
    if (!container) {
      return;
    }

    const sectionClass = `conditional-section-${sectionId}`;
    const existingSection = container.querySelector<HTMLElement>(`.${sectionClass}`);

    if (shouldShow && !existingSection) {
      // Create a new section
      const sectionEl = container.createDiv({ cls: sectionClass });
      
      // If insertAfter is specified, insert after that element
      if (insertAfter && insertAfter.nextSibling) {
        container.insertBefore(sectionEl, insertAfter.nextSibling);
      } else if (insertAfter && !insertAfter.nextSibling) {
        // insertAfter is the last element, so append directly
        container.appendChild(sectionEl);
      }
      // If insertAfter is not specified, createDiv has already appended the element to the end
      
      // Call the render function to populate the content
      try {
        renderFn(sectionEl);
      } catch (error) {
        // Catch render errors and log them without affecting other settings items
        console.error(`[Settings] Error rendering conditional section "${sectionId}":`, error);
      }
    } else if (!shouldShow && existingSection) {
      // Remove the existing section
      existingSection.remove();
    }
    // Do nothing when the state has not changed (idempotent)
  }

  /**
   * Save settings
   */
  protected async saveSettings(): Promise<void> {
    await this.context.plugin.saveSettings();
  }
}
