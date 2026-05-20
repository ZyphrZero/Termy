/**
 * Renders a Lobehub brand SVG into an HTMLElement.
 *
 * Used by the Agent panel's provider tabs (Claude Code / OpenCode)
 * to surface the actual brand marks instead of generic Lucide icons.
 * The renderer in `presetScriptIcons.ts` does the same job for the
 * preset-script feature, but it is tightly bound to the
 * `preset-script-*` CSS class system. Splitting this helper out
 * keeps the panel free of those styles while still using the same
 * underlying SVG catalog.
 *
 * Returns `true` when the lobehub key resolved and the icon was
 * inserted, `false` otherwise so callers can fall back to a Lucide
 * id via Obsidian's `setIcon`.
 */

import { setIcon } from 'obsidian';

import { getLobeIconAsset } from '../terminal/lobeIconAssets';

/**
 * Counter scoped to this module so two simultaneous renders of the
 * same brand do not collide on `<defs>` ids inside the SVG (the
 * lobehub gradients use stable ids like `lobe-icons-codex-_R_0_`).
 */
let agentBrandInstanceCounter = 0;

export function renderAgentBrandIcon(el: HTMLElement, lobeIconKey: string, fallbackLucideIcon: string): void {
  el.empty();
  const asset = getLobeIconAsset(lobeIconKey);
  if (!asset) {
    setIcon(el, fallbackLucideIcon);
    return;
  }
  const markup = asset.color ?? asset.mono;
  const svg = parseSvgMarkup(scopeLobeIconMarkup(markup, asset.key));
  if (!svg) {
    setIcon(el, fallbackLucideIcon);
    return;
  }
  svg.setAttribute('aria-hidden', 'true');
  el.addClass('termy-agent-brand-icon');
  el.setAttr('data-icon', asset.key);
  el.appendChild(svg);
}

function parseSvgMarkup(markup: string): SVGSVGElement | null {
  const trimmed = markup.trim();
  if (!trimmed) return null;
  const parsed = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root.instanceOf(SVGSVGElement)) {
    return null;
  }
  return activeDocument.importNode(root, true);
}

function scopeLobeIconMarkup(markup: string, iconKey: string): string {
  if (!markup.includes('id=')) return markup;
  agentBrandInstanceCounter += 1;
  const suffix = `${iconKey}-${agentBrandInstanceCounter}`;
  return markup.replace(/lobe-icons-([A-Za-z0-9_-]+)/g, `lobe-icons-$1-${suffix}`);
}
