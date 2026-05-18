/**
 * Node.js / npm / fnm readiness probing for npm-backed AI launchers.
 *
 * The probe stays intentionally local: it resolves executables from the
 * Obsidian process PATH, asks each tool for its version, and surfaces the
 * paths so the install modal can explain what Termy detected.
 */

import { extractVersionString } from './commandVersionProbe.ts';
import { debugWarn } from '../../utils/logger.ts';
import type { CommandAvailability } from './commandAvailability.ts';

export interface RuntimeCommandInfo {
  command: string;
  availability: CommandAvailability;
  version: string | null;
  path: string | null;
}

export interface NodeRuntimeSnapshot {
  node: RuntimeCommandInfo;
  npm: RuntimeCommandInfo;
  fnm: RuntimeCommandInfo;
  /** Output of `fnm current`, when fnm is available. */
  fnmCurrent: string | null;
  /** User configured Node.js executable path, when provided. */
  customNodePath: string | null;
}

export type NodeRuntimeRecommendation =
  | 'npm-ready'
  | 'fnm-ready'
  | 'fnm-missing'
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

interface ChildProcessLike {
  stdout?: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
  stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  kill(): void;
}

interface NodeChildProcess {
  spawn: (
    command: string,
    args: string[],
    options: Record<string, unknown>,
  ) => ChildProcessLike;
}

const CACHE_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_000;
const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download';
const FNM_INSTALL_DOCS_URL = 'https://www.fnmnode.com/guide/install.html';

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
  const nextCacheKey = customNodePath ?? '<path>';
  if (cache && cacheKey === nextCacheKey && cache.expiresAt > Date.now()) {
    return cache.result;
  }

  const [node, fnm] = await Promise.all([
    customNodePath
      ? probeRuntimePath(customNodePath, 'node', ['--version'])
      : probeRuntimeCommand('node', ['--version']),
    probeRuntimeCommand('fnm', ['--version']),
  ]);
  const npm = customNodePath
    ? await probeNpmForCustomNodePath(customNodePath)
    : await probeRuntimeCommand('npm', ['--version']);

  const fnmCurrent = fnm.availability === 'ready'
    ? normalizeProbeOutput(await runCommand('fnm', ['current']))
    : null;

  const result = { node, npm, fnm, fnmCurrent, customNodePath };
  cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  cacheKey = nextCacheKey;
  return result;
}

export function getNodeRuntimeRecommendation(
  snapshot: NodeRuntimeSnapshot | null | undefined,
): NodeRuntimeRecommendation {
  if (!snapshot) return 'unknown';
  if (snapshot.npm.availability === 'ready') return 'npm-ready';
  if (snapshot.fnm.availability === 'ready') return 'fnm-ready';
  if (
    snapshot.node.availability === 'not-installed'
    && snapshot.npm.availability === 'not-installed'
    && snapshot.fnm.availability === 'not-installed'
  ) {
    return 'fnm-missing';
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

export function buildFnmPackageInstallCommand(packageName: string): string {
  return `fnm install --lts --use && npm install -g ${packageName}`;
}

export function getFnmBootstrapCommandForPlatform(
  platform: NodeJS.Platform = process.platform,
): string | null {
  switch (platform) {
    case 'win32':
      return 'winget install Schniz.fnm';
    case 'darwin':
      return 'brew install fnm';
    case 'linux':
      return 'curl -fsSL https://fnm.vercel.app/install | bash';
    default:
      return null;
  }
}

export function getNodeDownloadUrl(): string {
  return NODE_DOWNLOAD_URL;
}

export function getFnmInstallDocsUrl(): string {
  return FNM_INSTALL_DOCS_URL;
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

export function buildNodeRuntimeEnvironment(
  snapshot: NodeRuntimeSnapshot | null | undefined,
  baseEnv: Record<string, string | undefined> = process.env,
): NodeRuntimeEnvironment {
  const nodePath = snapshot?.node.path;
  const npmPath = snapshot?.npm.path;
  const customNodePath = snapshot?.customNodePath;
  if (!customNodePath || !nodePath) {
    return {};
  }

  const dirs = [
    getParentDirectory(nodePath),
    npmPath ? getParentDirectory(npmPath) : null,
  ].filter((value): value is string => value !== null);

  if (dirs.length === 0) return {};

  const pathKey = getPathEnvKey(baseEnv);
  const existingPath = baseEnv[pathKey] ?? '';
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return {
    PATH: [...new Set(dirs), existingPath].filter((part) => part.length > 0).join(delimiter),
  };
}

async function probeRuntimeCommand(
  command: string,
  versionArgs: string[],
): Promise<RuntimeCommandInfo> {
  const resolved = await resolveCommandPath(command);
  if (resolved.availability !== 'ready') {
    return {
      command,
      availability: resolved.availability,
      version: null,
      path: resolved.path,
    };
  }

  const rawVersion = await runCommand(command, versionArgs);
  return {
    command,
    availability: 'ready',
    version: extractVersionString(rawVersion ?? ''),
    path: resolved.path,
  };
}

async function probeRuntimePath(
  path: string,
  commandName: string,
  versionArgs: string[],
): Promise<RuntimeCommandInfo> {
  const rawVersion = await runCommand(path, versionArgs);
  if (rawVersion === null) {
    return {
      command: commandName,
      availability: 'unknown',
      version: null,
      path,
    };
  }

  return {
    command: commandName,
    availability: rawVersion === '' ? 'not-installed' : 'ready',
    version: extractVersionString(rawVersion),
    path,
  };
}

async function probeNpmForCustomNodePath(nodePath: string): Promise<RuntimeCommandInfo> {
  for (const npmPath of getNpmCandidatePathsForNodePath(nodePath)) {
    const info = await probeRuntimePath(npmPath, 'npm', ['--version']);
    if (info.availability === 'ready') {
      return info;
    }
  }

  return {
    command: 'npm',
    availability: 'not-installed',
    version: null,
    path: null,
  };
}

async function resolveCommandPath(command: string): Promise<{
  availability: CommandAvailability;
  path: string | null;
}> {
  const isWindows = process.platform === 'win32';
  const resolver = isWindows ? 'where' : 'which';
  const output = await runCommand(resolver, [command], { direct: true });
  if (output === null) {
    return { availability: 'unknown', path: null };
  }

  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;

  return firstLine
    ? { availability: 'ready', path: firstLine }
    : { availability: 'not-installed', path: null };
}

function loadChildProcess(): NodeChildProcess | null {
  try {
    return window.require('child_process') as NodeChildProcess;
  } catch (error) {
    debugWarn('[nodeRuntime] child_process unavailable:', error);
    return null;
  }
}

function runCommand(
  command: string,
  args: string[],
  options: { direct?: boolean } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const childProcess = loadChildProcess();
    if (!childProcess) {
      resolve(null);
      return;
    }

    let proc: ChildProcessLike;
    try {
      if (process.platform === 'win32' && options.direct !== true) {
        proc = childProcess.spawn('cmd.exe', ['/C', formatWindowsCommand(command, args)], {
          windowsHide: true,
        });
      } else {
        proc = childProcess.spawn(command, args, {
          windowsHide: true,
        });
      }
    } catch (error) {
      debugWarn(`[nodeRuntime] failed to spawn ${command}:`, error);
      resolve(null);
      return;
    }

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = window.setTimeout(() => {
      try {
        proc.kill();
      } catch (error) {
        debugWarn('[nodeRuntime] failed to kill probe process:', error);
      }
      finish(null);
    }, PROBE_TIMEOUT_MS);

    proc.on('error', () => {
      window.clearTimeout(timer);
      finish(null);
    });

    proc.on('exit', (code) => {
      window.clearTimeout(timer);
      if (code !== 0) {
        finish('');
        return;
      }
      finish(normalizeProbeOutput(stdout || stderr) ?? '');
    });
  });
}

function formatWindowsCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteWindowsShellArg).join(' ');
}

function quoteShellCommand(command: string): string {
  if (/^[A-Za-z0-9._/@:+\\-]+$/.test(command)) {
    return command;
  }
  if (process.platform === 'win32') {
    return `"${command.replace(/"/g, '\\"')}"`;
  }
  return `'${command.replace(/'/g, "'\\''")}'`;
}

function quoteWindowsShellArg(arg: string): string {
  if (/^[A-Za-z0-9._/@:-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function getParentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex < 0) return null;
  return path.slice(0, slashIndex);
}

function getPathEnvKey(env: Record<string, string | undefined>): string {
  if (process.platform !== 'win32') return 'PATH';
  const existingKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  return existingKey ?? 'PATH';
}

function normalizeCustomNodePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProbeOutput(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
