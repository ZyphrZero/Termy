/**
 * Preset script icon utilities
 */

import { setIcon } from 'obsidian';
import type { SimpleIcon } from 'simple-icons';
import {
  siAnthropic,
  siCloudflare,
  siClaude,
  siDocker,
  siFirebase,
  siGit,
  siGithub,
  siGitlab,
  siGo,
  siGoogle,
  siJavascript,
  siKubernetes,
  siLinux,
  siMongodb,
  siMysql,
  siNodedotjs,
  siNpm,
  siOpenai,
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

const SIMPLE_ICON_MAP: Record<string, SimpleIcon> = {
  openai: siOpenai,
  openaiapi: siOpenai,
  claude: siClaude,
  anthropic: siAnthropic,
  google: siGoogle,
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

const OPENCODE_ICON_PATHS = {
  light: [
    { fill: '#CFCECD', d: 'M180 240H60V120H180V240Z' },
    { fill: '#211E1E', d: 'M180 60H60V240H180V60ZM240 300H0V0H240V300Z' },
  ],
  dark: [
    { fill: '#4B4646', d: 'M180 240H60V120H180V240Z' },
    { fill: '#F1ECEC', d: 'M180 60H60V240H180V60ZM240 300H0V0H240V300Z' },
  ],
} as const;

const SIMPLE_ICON_ORDER = [
  'opencode',
  'openai',
  'claude',
  'anthropic',
  'google',
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
  ...SIMPLE_ICON_ORDER,
  ...DEFAULT_ICON_OPTIONS.filter((iconName) => iconName !== 'terminal'),
];

const emojiRegex = /\p{Extended_Pictographic}/u;

function isEmojiIcon(iconName: string): boolean {
  return emojiRegex.test(iconName);
}

function isOpenCodeIcon(iconName: string): boolean {
  return iconName.toLowerCase() === 'opencode';
}

export function isCustomPresetScriptIcon(iconName: string): boolean {
  const lookup = iconName.toLowerCase();
  return isOpenCodeIcon(lookup) || lookup in SIMPLE_ICON_MAP;
}

function createOpenCodeSvg(variant: keyof typeof OPENCODE_ICON_PATHS): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 240 300');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('preset-script-theme-svg', `preset-script-theme-svg-${variant}`);

  for (const { d, fill } of OPENCODE_ICON_PATHS[variant]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', fill);
    path.setAttribute('d', d);
    svg.appendChild(path);
  }

  return svg;
}

export function renderPresetScriptIcon(el: HTMLElement, iconName: string): void {
  const rawInput = (iconName ?? '').trim();
  const raw = rawInput || 'terminal';
  const lookup = raw.toLowerCase();
  el.empty();

  el.removeClass('preset-script-custom-icon');
  el.removeClass('preset-script-emoji-icon');
  el.removeClass('preset-script-themed-icon');
  el.removeAttribute('data-icon');
  el.style.removeProperty('--preset-script-icon-color');

  if (rawInput && isEmojiIcon(rawInput)) {
    el.addClass('preset-script-emoji-icon');
    el.textContent = rawInput;
    return;
  }

  if (isOpenCodeIcon(lookup)) {
    el.addClass('preset-script-custom-icon');
    el.addClass('preset-script-themed-icon');
    el.setAttr('data-icon', lookup);
    el.appendChild(createOpenCodeSvg('light'));
    el.appendChild(createOpenCodeSvg('dark'));
    return;
  }

  if (isCustomPresetScriptIcon(raw)) {
    const icon = SIMPLE_ICON_MAP[lookup];
    el.addClass('preset-script-custom-icon');
    el.setAttr('data-icon', lookup);
    if (icon.hex) {
      el.style.setProperty('--preset-script-icon-color', `#${icon.hex}`);
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
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
