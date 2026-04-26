const BLACK_WHITE_SIMPLE_ICONS = new Set(['openai', 'openaiapi']);

export function isBlackWhiteSimpleIcon(iconName: string): boolean {
  return BLACK_WHITE_SIMPLE_ICONS.has(iconName.toLowerCase());
}

export function resolveSimpleIconColor(iconName: string, iconHex?: string | null): string | null {
  if (isBlackWhiteSimpleIcon(iconName)) {
    return null;
  }
  return iconHex ? `#${iconHex}` : null;
}
