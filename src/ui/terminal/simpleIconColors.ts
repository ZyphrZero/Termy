/**
 * Simple-icons logo keys that should render as a black silhouette in
 * light themes and a white silhouette in dark themes, instead of using
 * the brand hex color from `simple-icons`.
 *
 * The set is intentionally empty today — the previous AI-brand entries
 * (OpenAI / OpenAI API) now ship through `@lobehub/icons-static-svg`,
 * which uses `currentColor` so the cascade handles theme inversion
 * for free. The helpers stay so future Simple-Icons additions that
 * publish only as a silhouette can opt back in without re-introducing
 * the rendering branch.
 */
const BLACK_WHITE_SIMPLE_ICONS = new Set<string>();

export function isBlackWhiteSimpleIcon(iconName: string): boolean {
  return BLACK_WHITE_SIMPLE_ICONS.has(iconName.toLowerCase());
}

export function resolveSimpleIconColor(iconName: string, iconHex?: string | null): string | null {
  if (isBlackWhiteSimpleIcon(iconName)) {
    return null;
  }
  return iconHex ? `#${iconHex}` : null;
}
