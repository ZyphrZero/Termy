import { posix as posixPath, win32 as win32Path } from 'node:path';

import { normalizeTerminalToken, type TerminalPlatform } from './terminalPathUtils.ts';

type PathModule = Pick<typeof posixPath, 'isAbsolute' | 'normalize' | 'relative' | 'resolve' | 'sep'>;

export interface ClaudeCodePathReferenceOptions {
  cwd?: string | null;
  platform?: TerminalPlatform;
  isDirectory?: (path: string) => boolean;
  pathExists?: (path: string) => boolean;
}

export function formatClaudeCodePathReferences(
  paths: string[],
  options: ClaudeCodePathReferenceOptions = {},
): string {
  const references = paths
    .map((path) => formatClaudeCodePathReference(path, options))
    .filter((reference) => reference.length > 0)
    .join(' ');

  return references ? `${references} ` : '';
}

export function formatClaudeCodePathReference(
  path: string,
  options: ClaudeCodePathReferenceOptions = {},
): string {
  const referencePath = getClaudeCodeReferencePath(path, options);
  if (!referencePath) {
    return '';
  }

  const directoryPath = options.isDirectory?.(path)
    ? ensureTrailingDirectorySlash(referencePath)
    : referencePath;

  return shouldQuoteClaudeCodeReference(directoryPath) && !directoryPath.includes('"')
    ? `@"${directoryPath}"`
    : `@${directoryPath}`;
}

function getClaudeCodeReferencePath(
  path: string,
  options: ClaudeCodePathReferenceOptions,
): string {
  const platform = options.platform ?? process.platform;
  const pathModule = platform === 'win32' ? win32Path : posixPath;
  const normalizedPath = normalizeTerminalToken(path);
  if (!normalizedPath) {
    return '';
  }

  const normalizedCwd = normalizeTerminalToken(options.cwd ?? '');
  const relativePath = getSafeCwdRelativePath(
    normalizedPath,
    normalizedCwd,
    pathModule,
    platform,
    options.pathExists,
  );

  return toClaudeCodePathSeparators(relativePath ?? normalizedPath, platform);
}

function shouldQuoteClaudeCodeReference(path: string): boolean {
  return !isRegularClaudeCodeReferenceSafe(path);
}

function getSafeCwdRelativePath(
  absolutePath: string,
  cwd: string,
  pathModule: PathModule,
  platform: TerminalPlatform,
  pathExists?: (path: string) => boolean,
): string | null {
  if (!cwd || !pathModule.isAbsolute(absolutePath) || !pathModule.isAbsolute(cwd)) {
    return null;
  }

  const normalizedAbsolutePath = pathModule.normalize(absolutePath);
  const normalizedCwd = pathModule.normalize(cwd);
  if (pathExists && !pathExists(normalizedCwd)) {
    return null;
  }

  const relativePath = pathModule.relative(normalizedCwd, normalizedAbsolutePath) || '.';
  if (isOutsideCwdRelativePath(relativePath, pathModule)) {
    return null;
  }

  const roundTripPath = pathModule.resolve(normalizedCwd, relativePath);
  if (!samePlatformPath(roundTripPath, normalizedAbsolutePath, platform)) {
    return null;
  }

  if (pathExists && !pathExists(roundTripPath)) {
    return null;
  }

  return relativePath;
}

function isOutsideCwdRelativePath(
  relativePath: string,
  pathModule: PathModule,
): boolean {
  return relativePath === '..'
    || relativePath.startsWith(`..${pathModule.sep}`)
    || pathModule.isAbsolute(relativePath);
}

function samePlatformPath(left: string, right: string, platform: TerminalPlatform): boolean {
  const leftPath = platform === 'win32' ? left.toLowerCase() : left;
  const rightPath = platform === 'win32' ? right.toLowerCase() : right;
  return leftPath === rightPath;
}

function toClaudeCodePathSeparators(path: string, platform: TerminalPlatform): string {
  return platform === 'win32' ? path.replace(/\\/g, '/') : path;
}

function isRegularClaudeCodeReferenceSafe(path: string): boolean {
  if (/\s/.test(path)) {
    return false;
  }

  const regularAtMentionRegex = /(^|\s)@([^\s]+)\b/g;
  const matches = Array.from(`@${path} `.matchAll(regularAtMentionRegex));
  if (matches.length !== 1) {
    return false;
  }

  const extractedPath = matches[0][2];
  return extractedPath === path || extractedPath === path.replace(/[\\/]$/, '');
}

function ensureTrailingDirectorySlash(path: string): string {
  return /[\\/]$/.test(path) ? path : `${path}/`;
}
