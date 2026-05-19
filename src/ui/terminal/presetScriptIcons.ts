/**
 * Preset script icon utilities
 */

import { setIcon } from 'obsidian';
import type { SimpleIcon } from 'simple-icons';
import { isBlackWhiteSimpleIcon, resolveSimpleIconColor } from './simpleIconColors';
import {
  LOBE_ICON_PICKER_ORDER,
  getLobeIconAsset,
  isLobeIcon,
  resolveLobeIconKey,
} from './lobeIconAssets';
import {
  siCloudflare,
  siDocker,
  siFirebase,
  siGit,
  siGithub,
  siGitlab,
  siGo,
  siJavascript,
  siKubernetes,
  siLinux,
  siMongodb,
  siMysql,
  siNodedotjs,
  siNpm,
  siPnpm,
  siPostgresql,
  siPython,
  siReact,
  siRedis,
  siRust,
  siSupabase,
  siTailwindcss,
  siTypescript,
  siUbuntu,
  siVercel,
  siVuedotjs,
  siYarn,
  siNextdotjs,
} from 'simple-icons';

/**
 * Generic developer-tool icons sourced from `simple-icons`. AI / LLM
 * brand logos (Claude, Codex, Gemini, OpenCode, Hermes, …) are served
 * from `@lobehub/icons-static-svg` instead — see {@link lobeIconAssets}.
 *
 * Keeping the two sources separate means we can update AI brand marks
 * (which change frequently) without re-pinning simple-icons, and we
 * avoid the long tail of dev-tool logos that lobehub does not ship.
 */
const SIMPLE_ICON_MAP: Record<string, SimpleIcon> = {
  python: siPython,
  javascript: siJavascript,
  typescript: siTypescript,
  nodejs: siNodedotjs,
  go: siGo,
  rust: siRust,
  react: siReact,
  vue: siVuedotjs,
  nextjs: siNextdotjs,
  tailwindcss: siTailwindcss,
  github: siGithub,
  gitlab: siGitlab,
  git: siGit,
  docker: siDocker,
  kubernetes: siKubernetes,
  postgresql: siPostgresql,
  mysql: siMysql,
  redis: siRedis,
  mongodb: siMongodb,
  supabase: siSupabase,
  firebase: siFirebase,
  vercel: siVercel,
  cloudflare: siCloudflare,
  linux: siLinux,
  ubuntu: siUbuntu,
  npm: siNpm,
  pnpm: siPnpm,
  yarn: siYarn,
};

/**
 * Per-render counter used to scope `<defs>` ids in lobehub SVGs that
 * declare gradients (Gemini, Codex, Claude Code). Without this, two
 * preset rows rendering the same icon at the same time would clash on
 * a duplicate id and the second icon would render with the first
 * icon's gradient.
 */
let lobeIconInstanceCounter = 0;

const SIMPLE_ICON_ORDER = [
  'python',
  'javascript',
  'typescript',
  'nodejs',
  'go',
  'rust',
  'react',
  'vue',
  'nextjs',
  'tailwindcss',
  'github',
  'gitlab',
  'git',
  'docker',
  'kubernetes',
  'postgresql',
  'mysql',
  'redis',
  'mongodb',
  'supabase',
  'firebase',
  'vercel',
  'cloudflare',
  'linux',
  'ubuntu',
  'npm',
  'pnpm',
  'yarn',
] as const;

const DEFAULT_ICON_OPTIONS = [
  // Basics and terminal
  'terminal',
  'terminal-square',
  'command',
  'code',
  'file-code',
  'folder',
  'folder-open',
  'files',
  'search',
  'filter',
  // Execution actions
  'play',
  'pause',
  'square',
  'refresh-cw',
  'rotate-ccw',
  'download',
  'upload',
  // Development and deployment
  'git-branch',
  'git-commit',
  'git-merge',
  'git-pull-request',
  'database',
  'server',
  'hard-drive',
  'package',
  'box',
  // Actions and editing
  'copy',
  'clipboard',
  'scissors',
  'trash',
  'plus',
  'minus',
  // Settings and tools
  'settings',
  'sliders-horizontal',
  'wrench',
  'hammer',
  // Status and alerts
  'check',
  'x',
  'alert-triangle',
  'info',
  'bell',
  'clock',
  'calendar',
  // Security and network
  'shield',
  'lock',
  'unlock',
  'key',
  'globe',
  'link',
  // Common semantic icons
  'sparkles',
  'wand-2',
  'bot',
  'cpu',
  'rocket',
  'zap',
  'activity',
  'bug',
  'test-tube',
  'flask-conical',
  'book-open',
  'lightbulb',
  'list',
];

export const PRESET_SCRIPT_ICON_OPTIONS = [
  'terminal',
  ...LOBE_ICON_PICKER_ORDER,
  ...SIMPLE_ICON_ORDER,
  ...DEFAULT_ICON_OPTIONS.filter((iconName) => iconName !== 'terminal'),
];

const emojiRegex = /\p{Extended_Pictographic}/u;

function isEmojiIcon(iconName: string): boolean {
  return emojiRegex.test(iconName);
}

export function isCustomPresetScriptIcon(iconName: string): boolean {
  const lookup = iconName.toLowerCase();
  return isLobeIcon(lookup) || lookup in SIMPLE_ICON_MAP;
}

/**
 * Parse an inline SVG string into an isolated DOM node ready for
 * insertion. Returns null when parsing fails — callers fall back to
 * the lucide icon path.
 */
function parseSvgMarkup(markup: string): SVGSVGElement | null {
  const trimmed = markup.trim();
  if (!trimmed) return null;
  const parsed = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root.instanceOf(SVGSVGElement)) {
    return null;
  }
  // `importNode` re-binds the element to the active document so it can
  // be inserted without "wrong document" errors.
  return activeDocument.importNode(root, true);
}

/**
 * Lobehub SVGs that declare gradients use ids like
 * `lobe-icons-codex-_R_0_`. Two rows rendering the same icon will
 * collide on those ids; we scope every id with a fresh prefix per
 * render call so each instance owns its own gradient definitions.
 */
function scopeLobeIconMarkup(markup: string, iconKey: string): string {
  if (!markup.includes('id=')) return markup;
  lobeIconInstanceCounter += 1;
  const suffix = `${iconKey}-${lobeIconInstanceCounter}`;
  return markup.replace(/lobe-icons-([A-Za-z0-9_-]+)/g, `lobe-icons-$1-${suffix}`);
}

function renderLobeIcon(el: HTMLElement, iconKey: string): boolean {
  const asset = getLobeIconAsset(iconKey);
  if (!asset) return false;
  const markup = scopeLobeIconMarkup(asset.color ?? asset.mono, asset.key);
  const svg = parseSvgMarkup(markup);
  if (!svg) return false;
  svg.setAttribute('aria-hidden', 'true');
  el.addClass('preset-script-custom-icon');
  el.setAttr('data-icon', asset.key);
  if (asset.solidBackground) {
    // Engraving-style brand marks (Hermes) only read clearly on a
    // light surface. Wrap the SVG in a dedicated chip span so the
    // white surface and dark ink stay the *same* fixed size in every
    // host (icon picker tile, preview button, settings row, status
    // bar menu). Styling the host element directly leaks the chip
    // onto whatever 36×36 button frame it lands in, which made the
    // icon look inconsistent across surfaces.
    const chip = activeDocument.createElement('span');
    chip.className = 'preset-script-solid-bg-chip';
    chip.appendChild(svg);
    el.appendChild(chip);
  } else {
    el.appendChild(svg);
  }
  return true;
}

export function renderPresetScriptIcon(el: HTMLElement, iconName: string): void {
  const rawInput = (iconName ?? '').trim();
  const raw = rawInput || 'terminal';
  const lookup = raw.toLowerCase();
  el.empty();

  el.removeClass('preset-script-custom-icon');
  el.removeClass('preset-script-emoji-icon');
  el.removeClass('preset-script-black-white-icon');
  el.removeAttribute('data-icon');
  el.style.removeProperty('--preset-script-icon-color');

  if (rawInput && isEmojiIcon(rawInput)) {
    el.addClass('preset-script-emoji-icon');
    el.textContent = rawInput;
    return;
  }

  // AI / LLM brand marks — sourced from @lobehub/icons-static-svg.
  // Lobehub takes precedence over simple-icons so brand updates land
  // by bumping the lobehub package alone.
  const lobeKey = resolveLobeIconKey(raw);
  if (lobeKey) {
    if (renderLobeIcon(el, lobeKey)) {
      return;
    }
  }

  if (lookup in SIMPLE_ICON_MAP) {
    const icon = SIMPLE_ICON_MAP[lookup];
    el.addClass('preset-script-custom-icon');
    el.setAttr('data-icon', lookup);
    if (isBlackWhiteSimpleIcon(lookup)) {
      el.addClass('preset-script-black-white-icon');
    }
    const color = resolveSimpleIconColor(lookup, icon.hex);
    if (color) {
      el.style.setProperty('--preset-script-icon-color', color);
    }

    const svg = activeDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');

    const path = activeDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', icon.path);
    svg.appendChild(path);

    el.appendChild(svg);
    return;
  }

  setIcon(el, raw);
}

export function resolveMenuIconName(iconName: string): string {
  const raw = (iconName || 'terminal').trim();
  if (isCustomPresetScriptIcon(raw)) {
    return 'terminal';
  }
  return raw;
}
