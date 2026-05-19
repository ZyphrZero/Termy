/**
 * AI/LLM brand icon assets sourced from `@lobehub/icons-static-svg`.
 *
 * The lobehub package ships hundreds of SVG files, so importing it as a
 * whole would bloat `main.js` and force users to download branding for
 * AI products they do not use. We therefore import individual files via
 * esbuild's `.svg` text loader (configured in `esbuild.config.mjs`) and
 * keep the catalog small and explicit.
 *
 * Each entry corresponds to a key the user can type into the preset
 * script icon field (or that ships with a built-in launcher). The
 * `mono` markup follows `currentColor`, while the optional `color`
 * markup carries the official brand palette via inline fills and
 * gradients.
 *
 * License notes:
 *   - `@lobehub/icons-static-svg` is MIT-licensed.
 *   - Brand marks remain trademarks of their respective owners. The
 *     icons are used here to identify the integrations they label,
 *     consistent with nominative-fair-use practice in tool launchers.
 */

import claudeColorMarkup from '@lobehub/icons-static-svg/icons/claude-color.svg';
import claudeMonoMarkup from '@lobehub/icons-static-svg/icons/claude.svg';
import claudeCodeColorMarkup from '@lobehub/icons-static-svg/icons/claudecode-color.svg';
import claudeCodeMonoMarkup from '@lobehub/icons-static-svg/icons/claudecode.svg';
import codexColorMarkup from '@lobehub/icons-static-svg/icons/codex-color.svg';
import codexMonoMarkup from '@lobehub/icons-static-svg/icons/codex.svg';
import deepSeekColorMarkup from '@lobehub/icons-static-svg/icons/deepseek-color.svg';
import deepSeekMonoMarkup from '@lobehub/icons-static-svg/icons/deepseek.svg';
import geminiColorMarkup from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import geminiMonoMarkup from '@lobehub/icons-static-svg/icons/gemini.svg';
import geminiCliColorMarkup from '@lobehub/icons-static-svg/icons/geminicli-color.svg';
import geminiCliMonoMarkup from '@lobehub/icons-static-svg/icons/geminicli.svg';
import hermesAgentMonoMarkup from '@lobehub/icons-static-svg/icons/hermesagent.svg';
import openAiMonoMarkup from '@lobehub/icons-static-svg/icons/openai.svg';
import openCodeMonoMarkup from '@lobehub/icons-static-svg/icons/opencode.svg';

export interface LobeIconAsset {
  /** Lookup key (lowercase). */
  key: string;
  /** Friendly label used for tooltips and aria-label. */
  label: string;
  /** Single-color SVG markup (uses `currentColor`). */
  mono: string;
  /** Optional brand-color SVG markup. */
  color?: string;
  /**
   * When true, the icon should render on a solid light surface even in
   * dark mode. Used for intricate engraving-style brand marks (Hermes
   * Agent) where the fine path detail would otherwise blend into a
   * dark Obsidian theme background.
   */
  solidBackground?: boolean;
}

/**
 * Canonical AI/LLM brand catalog, keyed by lowercase identifier.
 *
 * Aliases (e.g. `hermes`, `claude-code`, `gemini-cli`) are wired up
 * separately by {@link LOBE_ICON_ALIASES} so changes to the canonical
 * list do not need to touch every consumer.
 */
const LOBE_ICONS: readonly LobeIconAsset[] = [
  { key: 'claude', label: 'Claude', mono: claudeMonoMarkup, color: claudeColorMarkup },
  { key: 'claudecode', label: 'Claude Code', mono: claudeCodeMonoMarkup, color: claudeCodeColorMarkup },
  { key: 'codex', label: 'Codex', mono: codexMonoMarkup, color: codexColorMarkup },
  { key: 'deepseek', label: 'DeepSeek', mono: deepSeekMonoMarkup, color: deepSeekColorMarkup },
  { key: 'gemini', label: 'Gemini', mono: geminiMonoMarkup, color: geminiColorMarkup },
  { key: 'geminicli', label: 'Gemini CLI', mono: geminiCliMonoMarkup, color: geminiCliColorMarkup },
  { key: 'hermesagent', label: 'Hermes', mono: hermesAgentMonoMarkup, solidBackground: true },
  { key: 'openai', label: 'OpenAI', mono: openAiMonoMarkup },
  { key: 'opencode', label: 'OpenCode', mono: openCodeMonoMarkup },
];

/**
 * Aliases the user (or built-in preset) can type that resolve to a
 * canonical entry above. Keep these short and lowercase.
 */
const LOBE_ICON_ALIASES: Record<string, string> = {
  // Anthropic family.
  anthropic: 'claude',
  'claude-code': 'claudecode',
  // OpenAI family.
  openaiapi: 'openai',
  // DeepSeek family — the canonical model brand is `deepseek`. Allow
  // hyphenated aliases users might paste from elsewhere.
  'deep-seek': 'deepseek',
  // Google family.
  google: 'gemini',
  'google-gemini': 'gemini',
  'gemini-cli': 'geminicli',
  // Hermes family — `hermes` is the canonical preset id, while
  // lobehub's filename is `hermesagent`. Nous Research's brand mark
  // is identical to Hermes Agent's engraving, so we route it through
  // the same asset rather than shipping a redundant file.
  hermes: 'hermesagent',
  'hermes-agent': 'hermesagent',
  nousresearch: 'hermesagent',
  'nous-research': 'hermesagent',
};

const LOBE_ICON_INDEX = new Map(LOBE_ICONS.map((icon) => [icon.key, icon]));

/**
 * Display order for the icon picker — keeps the most popular AI brands
 * at the top while not exposing every alias as a separate tile.
 */
export const LOBE_ICON_PICKER_ORDER: readonly string[] = [
  'claude',
  'claudecode',
  'codex',
  'openai',
  'gemini',
  'geminicli',
  'opencode',
  'hermes',
  'deepseek',
];

export function resolveLobeIconKey(iconName: string): string | null {
  const lookup = iconName.trim().toLowerCase();
  if (!lookup) return null;
  if (LOBE_ICON_INDEX.has(lookup)) return lookup;
  const aliased = LOBE_ICON_ALIASES[lookup];
  return aliased && LOBE_ICON_INDEX.has(aliased) ? aliased : null;
}

export function getLobeIconAsset(iconName: string): LobeIconAsset | null {
  const key = resolveLobeIconKey(iconName);
  return key ? LOBE_ICON_INDEX.get(key) ?? null : null;
}

export function isLobeIcon(iconName: string): boolean {
  return resolveLobeIconKey(iconName) !== null;
}
