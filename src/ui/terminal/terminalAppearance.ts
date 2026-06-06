import type { TerminalInstance } from '../../services/terminal/terminalInstance';
import { clamp, normalizeBackgroundPosition, normalizeBackgroundSize, toCssUrl } from '../../utils/styleUtils';

export interface TerminalAppearanceTarget {
  readonly terminalContainer: HTMLElement;
  readonly viewContainer: HTMLElement;
  readonly terminal: TerminalInstance;
}

export function syncTerminalAppearanceStyles(target: TerminalAppearanceTarget): void {
  const { terminalContainer, viewContainer, terminal } = target;
  const options = terminal.getOptions();
  const canUseBackgroundImage = !!options.backgroundImage
    && !options.useObsidianTheme
    && terminal.getCurrentRenderer() !== 'webgl';

  if (canUseBackgroundImage) {
    terminalContainer.addClass('has-background-image');
    viewContainer.addClass('has-background-image');
    ensureTerminalBackgroundLayer(terminalContainer);
  } else {
    terminalContainer.removeClass('has-background-image');
    viewContainer.removeClass('has-background-image');
    terminalContainer.querySelector('.terminal-background-image')?.remove();
  }

  const backgroundImageOpacity = options.backgroundImageOpacity ?? 0.5;
  const overlayOpacity = canUseBackgroundImage
    ? clamp(1 - backgroundImageOpacity, 0, 1)
    : 0;
  const blurAmount = options.blurAmount ?? 0;
  const blurEnabled = canUseBackgroundImage && !!options.enableBlur && blurAmount > 0;

  applyTerminalAppearanceStyleRule(terminalContainer, viewContainer, {
    backgroundImage: canUseBackgroundImage ? toCssUrl(options.backgroundImage) : 'none',
    overlayOpacity,
    backgroundSize: normalizeBackgroundSize(options.backgroundImageSize),
    backgroundPosition: normalizeBackgroundPosition(options.backgroundImagePosition),
    blur: blurEnabled ? `${blurAmount}px` : '0px',
    scale: blurEnabled ? '1.05' : '1',
    textOpacity: canUseBackgroundImage ? String(options.textOpacity ?? 1.0) : '1',
    backgroundColor: canUseBackgroundImage
      ? 'transparent'
      : terminal.getEffectiveBackgroundColor(),
  });
}

export function clearTerminalAppearanceStyles(
  terminalContainer: HTMLElement | null,
  viewContainer: HTMLElement | null,
): void {
  if (!terminalContainer) return;
  const style = terminalContainer.style;
  style.removeProperty('--terminal-bg-image');
  style.removeProperty('--terminal-bg-overlay-opacity');
  style.removeProperty('--terminal-bg-size');
  style.removeProperty('--terminal-bg-position');
  style.removeProperty('--terminal-bg-blur');
  style.removeProperty('--terminal-bg-scale');
  style.removeProperty('--terminal-text-opacity');
  style.removeProperty('--terminal-bg-color');
  viewContainer?.style.removeProperty('--terminal-bg-color');
}

function ensureTerminalBackgroundLayer(terminalContainer: HTMLElement): void {
  if (terminalContainer.querySelector('.terminal-background-image')) return;

  const bgLayer = terminalContainer.ownerDocument.createElement('div');
  bgLayer.className = 'terminal-background-image';
  terminalContainer.prepend(bgLayer);
}

function applyTerminalAppearanceStyleRule(
  terminalContainer: HTMLElement,
  viewContainer: HTMLElement,
  vars: {
    readonly backgroundImage: string;
    readonly overlayOpacity: number;
    readonly backgroundSize: string;
    readonly backgroundPosition: string;
    readonly blur: string;
    readonly scale: string;
    readonly textOpacity: string;
    readonly backgroundColor: string;
  },
): void {
  const style = terminalContainer.style;
  style.setProperty('--terminal-bg-image', vars.backgroundImage);
  style.setProperty('--terminal-bg-overlay-opacity', String(vars.overlayOpacity));
  style.setProperty('--terminal-bg-size', vars.backgroundSize);
  style.setProperty('--terminal-bg-position', vars.backgroundPosition);
  style.setProperty('--terminal-bg-blur', vars.blur);
  style.setProperty('--terminal-bg-scale', vars.scale);
  style.setProperty('--terminal-text-opacity', vars.textOpacity);
  style.setProperty('--terminal-bg-color', vars.backgroundColor);
  viewContainer.style.setProperty('--terminal-bg-color', vars.backgroundColor);
}
