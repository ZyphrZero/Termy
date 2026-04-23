import { posix as posixPath, win32 as win32Path } from 'node:path';

export type TerminalPlatform = NodeJS.Platform;

function isWindowsPlatform(platform: TerminalPlatform): boolean {
  return platform === 'win32';
}

function getPathModule(platform: TerminalPlatform) {
  return isWindowsPlatform(platform) ? win32Path : posixPath;
}

function normalizeFilesystemPath(
  value: string,
  platform: TerminalPlatform = process.platform
): string {
  let normalized = normalizeTerminalToken(value);
  if (!normalized) {
    return '';
  }

  if (isWindowsPlatform(platform)) {
    normalized = normalized.replace(/^\/(?=[A-Za-z]:[\\/])/, '');
  }

  return getPathModule(platform).normalize(normalized);
}

export function normalizeTerminalToken(value: string): string {
  let normalized = value.trim().replace(/^<|>$/g, '');
  if (
    (normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith('\'') && normalized.endsWith('\''))
  ) {
    normalized = normalized.slice(1, -1);
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Ignore malformed percent-encoding and use the raw token.
  }

  return normalized.trim();
}

export function toPlatformPath(
  value: string,
  platform: TerminalPlatform = process.platform
): string {
  const normalized = normalizeTerminalToken(value);
  if (!normalized) {
    return '';
  }

  return isWindowsPlatform(platform)
    ? normalized.replace(/\//g, '\\')
    : normalized;
}

export function normalizeVaultPath(value: string): string {
  const normalized = normalizeTerminalToken(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!normalized) {
    return '';
  }

  const canonical = posixPath.normalize(normalized);
  return canonical === '.' ? '' : canonical;
}

export function isAbsoluteTerminalPath(
  value: string,
  platform: TerminalPlatform = process.platform
): boolean {
  const normalized = normalizeTerminalToken(value);
  if (!normalized) {
    return false;
  }

  return getPathModule(platform).isAbsolute(normalized);
}

export function normalizeDroppedEntryPath(
  value: string,
  platform: TerminalPlatform = process.platform
): string | null {
  const normalized = normalizeFilesystemPath(value, platform);
  if (!normalized) {
    return null;
  }

  return isAbsoluteTerminalPath(normalized, platform) ? normalized : null;
}

export function normalizeDroppedEntryReference(
  value: string,
  platform: TerminalPlatform = process.platform
): { absolutePath: string | null; vaultPath: string | null } {
  const rawNormalized = normalizeTerminalToken(value);
  const absolutePath = isWindowsPlatform(platform) && /^\/(?![A-Za-z]:[\\/])/.test(rawNormalized)
    ? null
    : normalizeDroppedEntryPath(value, platform);
  if (absolutePath) {
    return {
      absolutePath,
      vaultPath: null,
    };
  }

  const vaultPath = normalizeVaultPath(value);
  return {
    absolutePath: null,
    vaultPath: vaultPath || null,
  };
}

export function normalizeTerminalReferencePath(
  pathLike: string,
  platform: TerminalPlatform = process.platform
): string {
  const normalized = normalizeTerminalToken(pathLike)
    .replace(/^[ab][\\/](?=.+\.[A-Za-z0-9]+$)/, '');

  return isWindowsPlatform(platform)
    ? normalized.replace(/\//g, '\\')
    : normalized.replace(/\\/g, '/');
}

export function fileUriToPlatformPath(
  uri: string,
  platform: TerminalPlatform = process.platform
): string | null {
  const normalizedUri = normalizeTerminalToken(uri);
  if (!normalizedUri.toLowerCase().startsWith('file://')) {
    return null;
  }

  try {
    const url = new URL(normalizedUri);
    if (url.protocol !== 'file:') {
      return null;
    }

    let pathname = decodeURIComponent(url.pathname);

    if (isWindowsPlatform(platform)) {
      if (/^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }

      const platformPath = normalizeFilesystemPath(pathname, platform);
      if (url.host) {
        const normalizedPath = platformPath.startsWith('\\') ? platformPath : `\\${platformPath}`;
        return `\\\\${url.host}${normalizedPath}`;
      }

      return platformPath;
    }

    const localHost = url.hostname.toLowerCase() === 'localhost';
    return normalizeFilesystemPath(localHost || !url.host ? pathname : `//${url.host}${pathname}`, platform);
  } catch {
    return null;
  }
}

export function joinTerminalPaths(
  basePath: string,
  relativePath: string,
  platform: TerminalPlatform = process.platform
): string {
  const pathModule = getPathModule(platform);
  const normalizedBasePath = normalizeTerminalToken(basePath);
  const normalizedRelativePath = normalizeTerminalToken(relativePath);

  if (!normalizedBasePath) {
    return normalizeFilesystemPath(normalizedRelativePath, platform);
  }

  if (!normalizedRelativePath) {
    return normalizeFilesystemPath(normalizedBasePath, platform);
  }

  if (pathModule.isAbsolute(normalizedRelativePath)) {
    return normalizeFilesystemPath(normalizedRelativePath, platform);
  }

  return pathModule.normalize(pathModule.join(normalizedBasePath, normalizedRelativePath));
}

export function collectTerminalReferenceCandidatePaths(
  relativePath: string,
  basePaths: Array<string | null | undefined>,
  platform: TerminalPlatform = process.platform
): string[] {
  const normalizedRelativePath = normalizeTerminalToken(relativePath);
  if (!normalizedRelativePath) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const basePath of basePaths) {
    const normalizedBasePath = normalizeTerminalToken(basePath ?? '');
    if (!normalizedBasePath) {
      continue;
    }

    const candidate = joinTerminalPaths(normalizedBasePath, normalizedRelativePath, platform);
    if (!candidate) {
      continue;
    }

    const key = isWindowsPlatform(platform) ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  return candidates;
}

export function getVaultRelativePathFromAbsolute(
  absolutePath: string,
  vaultBasePath: string,
  platform: TerminalPlatform = process.platform
): string | null {
  const pathModule = getPathModule(platform);
  const normalizedBasePath = normalizeFilesystemPath(vaultBasePath, platform);
  const normalizedAbsolutePath = normalizeFilesystemPath(absolutePath, platform);

  if (!normalizedBasePath || !normalizedAbsolutePath) {
    return null;
  }

  const relativePath = pathModule.relative(normalizedBasePath, normalizedAbsolutePath);
  if (relativePath.startsWith('..') || pathModule.isAbsolute(relativePath)) {
    return null;
  }

  return relativePath.replace(/\\/g, '/');
}
