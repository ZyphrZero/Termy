/**
 * Node.js / npm readiness probing for npm-backed AI launchers.
 *
 * The probe stays intentionally local and version-manager-agnostic:
 *
 *   - It resolves executables from the environment Termy actually
 *     sees, which is the inherited Obsidian PATH plus the enriched
 *     login-shell PATH harvested by {@link enrichedShellEnv}. This
 *     covers users on fnm, nvm, asdf, mise, volta, scoop, brew, or
 *     anything else without Termy needing per-tool knowledge.
 *   - It asks each tool for its version via `--version` and surfaces
 *     the resolved paths so the install modal can explain what Termy
 *     detected.
 *   - Termy never recommends a specific version manager. The runtime
 *     snapshot only reports Node.js and npm readiness; choosing how
 *     to install Node.js belongs to the user.
 */

import { runProbeCommand } from './childProcessUtils.ts';
import { extractVersionString } from './commandVersionProbe.ts';
import type { CommandAvailability } from './commandAvailability.ts';
import { getCachedEnrichedShellPath } from './enrichedShellEnv.ts';
import { getPathEnvKey } from './envHelpers.ts';

export interface RuntimeCommandInfo {
  command: string;
  availability: CommandAvailability;
  version: string | null;
  path: string | null;
}

export interface NodeRuntimeSnapshot {
  node: RuntimeCommandInfo;
  npm: RuntimeCommandInfo;
  /** User configured Node.js executable path, when provided. */
  customNodePath: string | null;
}

/**
 * Outcome of a runtime probe, as far as the install modal is
 * concerned. The modal renders one of two cards:
 *
 *   - 'npm-ready': Termy can already see npm; install command is
 *     `npm install -g <package>`.
 *   - 'node-missing': Termy cannot see Node.js / npm. The modal
 *     points the user at the Node.js download page and explains how
 *     to make Termy pick the install up afterwards.
 *   - 'unknown': probes were inconclusive (sandbox, slow profile);
 *     the modal falls back to the catalog's default install command.
 */
export type NodeRuntimeRecommendation =
  | 'npm-ready'
  | 'node-missing'
  | 'unknown';

export interface NodeRuntimeDetectionOptions {
  customNodePath?: string | null;
}

export interface NodeRuntimeEnvironment {
  PATH?: string;
}

interface CacheEntry {
  result: NodeRuntimeSnapshot;
  expiresAt: number;
}

const CACHE_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_000;
const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download';

let cache: CacheEntry | null = null;
let cacheKey: string | null = null;

export function clearNodeRuntimeCache(): void {
  cache = null;
  cacheKey = null;
}

export async function detectNodeRuntime(
  options: NodeRuntimeDetectionOptions = {},
): Promise<NodeRuntimeSnapshot> {
  const customNodePath = normalizeCustomNodePath(options.customNodePath);
  const nextCacheKey = customNodePath ?? '<auto>';
  if (cache && cacheKey === nextCacheKey && cache.expiresAt > Date.now()) {
    return cache.result;
  }

  const node = customNodePath
    ? await probeBinary(customNodePath, 'node')
    : await probeBinary('node', 'node');
  const npm = customNodePath
    ? await probeNpmForCustomNodePath(customNodePath)
    : await probeBinary('npm', 'npm');

  const result: NodeRuntimeSnapshot = { node, npm, customNodePath };
  cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  cacheKey = nextCacheKey;
  return result;
}

export function getNodeRuntimeRecommendation(
  snapshot: NodeRuntimeSnapshot | null | undefined,
): NodeRuntimeRecommendation {
  if (!snapshot) return 'unknown';
  if (snapshot.npm.availability === 'ready') return 'npm-ready';
  if (
    snapshot.node.availability === 'not-installed'
    && snapshot.npm.availability === 'not-installed'
  ) {
    return 'node-missing';
  }
  return 'unknown';
}

export function buildNpmPackageInstallCommand(
  packageName: string,
  snapshot?: NodeRuntimeSnapshot | null,
): string {
  const npmPath = snapshot?.npm.path;
  const npmCommand = npmPath ? quoteShellCommand(npmPath) : 'npm';
  return `${npmCommand} install -g ${packageName}`;
}

export function getNodeDownloadUrl(): string {
  return NODE_DOWNLOAD_URL;
}

export function createEmptyRuntimeCommandInfo(command: string): RuntimeCommandInfo {
  return {
    command,
    availability: 'unknown',
    version: null,
    path: null,
  };
}

export function getNpmCandidatePathsForNodePath(nodePath: string): string[] {
  const trimmed = nodePath.trim();
  if (!trimmed) return [];
  const normalized = trimmed.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex < 0) return [];

  const dir = trimmed.slice(0, slashIndex);
  if (!dir) return [];

  if (process.platform === 'win32') {
    return [`${dir}\\npm.cmd`, `${dir}\\npm.exe`, `${dir}\\npm`];
  }
  return [`${dir}/npm`];
}

/**
 * Build the additional environment variables Termy injects into newly
 * spawned terminal sessions.
 *
 * The result PATH is the union of:
 *   1. The custom Node.js / npm directories, when the user pinned a
 *      Node.js executable in settings.
 *   2. The enriched login-shell PATH harvested at plugin load. This
 *      covers any version manager (fnm, nvm, asdf, mise, volta, …)
 *      or manual install — Termy treats them all the same.
 *   3. The existing inherited PATH (from `process.env.PATH`).
 *
 * Duplicates are removed so the same directory never appears twice.
 * The system PATH is never modified.
 */
export function buildNodeRuntimeEnvironment(
  snapshot: NodeRuntimeSnapshot | null | undefined,
  baseEnv: Record<string, string | undefined> = process.env,
): NodeRuntimeEnvironment {
  const nodePath = snapshot?.node.path;
  const npmPath = snapshot?.npm.path;
  const customNodePath = snapshot?.customNodePath;
  const enrichedPath = customNodePath ? null : getCachedEnrichedShellPath();

  if (!customNodePath && !enrichedPath) return {};
  if (customNodePath && !nodePath) return {};

  const dirs: string[] = [];
  if (customNodePath && nodePath) {
    const nodeDir = getParentDirectory(nodePath);
    if (nodeDir) dirs.push(nodeDir);
    if (npmPath) {
      const npmDir = getParentDirectory(npmPath);
      if (npmDir) dirs.push(npmDir);
    }
  }

  const pathKey = getPathEnvKey(baseEnv);
  const existingPath = baseEnv[pathKey] ?? '';
  const delimiter = process.platform === 'win32' ? ';' : ':';

  const parts = [...dirs];
  if (!customNodePath && enrichedPath) parts.push(enrichedPath);
  parts.push(existingPath);

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const segment of part.split(delimiter)) {
      const trimmed = segment.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }

  if (merged.length === 0) return {};
  return { PATH: merged.join(delimiter) };
}

/**
 * Single-path probe for a runtime binary. Accepts either a bare
 * command name (resolved against PATH + the enriched login-shell
 * PATH) or an absolute path. Returns a fully populated
 * {@link RuntimeCommandInfo}.
 */
async function probeBinary(
  binary: string,
  commandName: string,
): Promise<RuntimeCommandInfo> {
  const result = await runProbeCommand({
    command: binary,
    args: ['--version'],
    timeoutMs: PROBE_TIMEOUT_MS,
  });

  if (!result) {
    return {
      command: commandName,
      availability: 'unknown',
      version: null,
      path: null,
    };
  }

  if (result.code !== 0) {
    return {
      command: commandName,
      availability: 'not-installed',
      version: null,
      path: null,
    };
  }

  const merged = (result.stdout || result.stderr).trim();
  const version = merged ? extractVersionString(merged) : null;
  const resolvedPath = isAbsolutePath(binary)
    ? binary
    : await resolvePathFor(binary);

  return {
    command: commandName,
    availability: 'ready',
    version,
    path: resolvedPath,
  };
}

async function probeNpmForCustomNodePath(nodePath: string): Promise<RuntimeCommandInfo> {
  for (const npmPath of getNpmCandidatePathsForNodePath(nodePath)) {
    const info = await probeBinary(npmPath, 'npm');
    if (info.availability === 'ready') return info;
  }
  return {
    command: 'npm',
    availability: 'not-installed',
    version: null,
    path: null,
  };
}

/**
 * Resolve a bare command to an absolute path so the settings card
 * can show users where Termy is actually picking up the binary.
 * Best-effort; returns null when the resolver fails.
 */
async function resolvePathFor(command: string): Promise<string | null> {
  const resolver = process.platform === 'win32' ? 'where' : 'which';
  const result = await runProbeCommand({
    command: resolver,
    args: [command],
    timeoutMs: 1_000,
    useWindowsShell: false,
  });
  if (!result || result.code !== 0) return null;

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;
}

function isAbsolutePath(value: string): boolean {
  if (process.platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
  }
  return value.startsWith('/');
}

function quoteShellCommand(command: string): string {
  if (/^[A-Za-z0-9._/@:+\\-]+$/.test(command)) return command;
  if (process.platform === 'win32') {
    return `"${command.replace(/"/g, '\\"')}"`;
  }
  return `'${command.replace(/'/g, "'\\''")}'`;
}

function getParentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex < 0) return null;
  return path.slice(0, slashIndex);
}

function normalizeCustomNodePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
