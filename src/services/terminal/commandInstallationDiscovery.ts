/** Read-only discovery of launcher executables on PATH and in common install locations. */

import { getPathEnvKey } from './envHelpers.ts';

export interface CommandInstallationCandidate {
  path: string;
  realPath: string;
  isDefault: boolean;
  onPath: boolean;
}

export interface CommandDiscoveryOptions {
  env: Record<string, string | undefined>;
  /** Override common locations for isolated filesystem tests. */
  commonDirectories?: readonly string[];
  cwd?: string;
}

export interface CommandDiscoveryResult {
  candidates: CommandInstallationCandidate[];
  errors: string[];
}

type VersionRoot = { path: string; suffix: string[] };

/** Only directory names are inspected; agent configuration and credentials are never read. */
export async function discoverCommandInstallations(
  command: string,
  options: CommandDiscoveryOptions,
): Promise<CommandDiscoveryResult> {
  const fs = (window.require('fs') as typeof import('fs')).promises;
  const path = window.require('path') as typeof import('path');
  const platform = process.platform;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command)) {
    throw new Error('Launcher discovery requires a command name without arguments or path separators');
  }
  const errors: string[] = [];
  const env = options.env;
  const pathValue = env[getPathEnvKey(env)]
    ?? (platform === 'win32' ? process.env[getPathEnvKey(process.env)] ?? '' : '/usr/bin:/bin');
  const pathDirectories = pathValue.split(path.delimiter)
    .map((directory) => directory.trim().replace(/^"(.*)"$/, '$1'))
    .map((directory) => path.resolve(options.cwd ?? process.cwd(), directory || '.'));
  const commonDirectories: string[] = [];
  if (options.commonDirectories) {
    commonDirectories.push(...options.commonDirectories);
  } else {
    const home = (window.require('os') as typeof import('os')).homedir();
    const locations = getCommonCommandLocations(env, home, platform);
    commonDirectories.push(...locations.directories);
    for (const root of locations.versionRoots) {
      try {
        const entries = await fs.readdir(root.path, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() || entry.isSymbolicLink()) {
            commonDirectories.push(path.join(root.path, entry.name, ...root.suffix));
          }
        }
      } catch (error) {
        recordDiscoveryError(root.path, error, errors);
      }
    }
  }

  const extensions = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((extension) => extension.toLowerCase())
      .filter((extension) => ['.com', '.exe', '.bat', '.cmd'].includes(extension))
    : [''];
  const candidates: CommandInstallationCandidate[] = [];
  const identities = new Map<string, CommandInstallationCandidate>();
  const scannedDirectories = new Set<string>();
  for (const directory of [...pathDirectories, ...commonDirectories]) {
    const directoryKey = normalizeInstallationPath(directory, platform);
    if (scannedDirectories.has(directoryKey)) continue;
    scannedDirectories.add(directoryKey);
    const onPath = pathDirectories.some((item) => normalizeInstallationPath(item, platform) === directoryKey);
    for (const extension of extensions) {
      const executable = path.join(directory, `${command}${extension}`);
      try {
        const stat = await fs.stat(executable);
        if (!stat.isFile()) continue;
        if (platform !== 'win32') {
          await fs.access(executable, (window.require('fs') as typeof import('fs')).constants.X_OK);
        }
        const realPath = await fs.realpath(executable);
        const identity = normalizeInstallationPath(realPath, platform);
        // PATH order selects the first executable. Symlink aliases count as one installation.
        if (identities.has(identity)) continue;
        const candidate = {
          path: executable,
          realPath,
          isDefault: onPath && !candidates.some((item) => item.isDefault),
          onPath,
        };
        identities.set(identity, candidate);
        candidates.push(candidate);
      } catch (error) {
        recordDiscoveryError(executable, error, errors);
      }
    }
  }
  return { candidates, errors };
}

export function normalizeInstallationPath(value: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? value.replace(/\//g, '\\').toLowerCase() : value;
}

export function getCommonCommandLocations(
  env: Record<string, string | undefined>,
  home: string,
  platform: NodeJS.Platform,
): { directories: string[]; versionRoots: VersionRoot[] } {
  const pathModule = window.require('path') as typeof import('path');
  const path = platform === 'win32' ? pathModule.win32 : pathModule.posix;
  const directories = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.opencode', 'bin'),
    path.join(home, '.pi', 'bin'),
    path.join(env.VOLTA_HOME || path.join(home, '.volta'), 'bin'),
  ];
  const versionRoots: VersionRoot[] = [];
  if (platform === 'win32') {
    if (env.APPDATA) directories.push(path.join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA) {
      directories.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
      directories.push(path.join(env.LOCALAPPDATA, 'Volta', 'bin'));
    }
    directories.push(path.join(home, 'scoop', 'shims'), path.join(home, '.hermes', 'venv', 'Scripts'));
    const programFiles = env.ProgramFiles || env.PROGRAMFILES;
    if (programFiles) directories.push(path.join(programFiles, 'nodejs'));
    if (env.NVM_HOME) versionRoots.push({ path: env.NVM_HOME, suffix: [] });
    for (const root of [env.FNM_DIR, env.APPDATA && path.join(env.APPDATA, 'fnm'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'fnm')]) {
      if (root) versionRoots.push({ path: path.join(root, 'node-versions'), suffix: ['installation'] });
    }
  } else {
    directories.push(
      '/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin',
      path.join(home, '.npm-global', 'bin'), path.join(home, '.npm', 'bin'),
      path.join(home, '.hermes', 'venv', 'bin'),
      path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'shims'),
      path.join(env.MISE_DATA_DIR || path.join(home, '.local', 'share', 'mise'), 'shims'),
    );
    versionRoots.push(
      { path: path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node'), suffix: ['bin'] },
      { path: path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'installs', 'nodejs'), suffix: ['bin'] },
      { path: path.join(env.MISE_DATA_DIR || path.join(home, '.local', 'share', 'mise'), 'installs', 'node'), suffix: ['bin'] },
      { path: path.join(env.VOLTA_HOME || path.join(home, '.volta'), 'tools', 'image', 'node'), suffix: ['bin'] },
    );
    for (const root of [env.FNM_DIR, path.join(home, '.local', 'share', 'fnm'), path.join(home, '.fnm')]) {
      if (root) versionRoots.push({ path: path.join(root, 'node-versions'), suffix: ['installation', 'bin'] });
    }
    if (platform === 'darwin') {
      versionRoots.push({ path: path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), suffix: ['installation', 'bin'] });
    }
  }
  const npmPrefix = env.npm_config_prefix || env.NPM_CONFIG_PREFIX;
  if (npmPrefix) directories.push(platform === 'win32' ? npmPrefix : path.join(npmPrefix, 'bin'));
  return { directories, versionRoots };
}

function recordDiscoveryError(location: string, error: unknown, errors: string[]): void {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'unknown';
  if (code === 'ENOENT' || code === 'ENOTDIR') return;
  errors.push(`${location}: ${code}`);
}
