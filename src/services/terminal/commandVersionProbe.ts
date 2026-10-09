/**
 * Local version probe for AI launcher CLIs.
 *
 * Runs `<tool> --version` and extracts the first MAJOR.MINOR.PATCH(-suffix)?
 * token from its output.
 *
 * Each discovered installation is invoked by its absolute executable path.
 * PATH order identifies the default; common install locations expose copies
 * shadowed by PATH or missing from it. Symlinks are deduplicated before probing.
 *
 * Why direct invocation:
 *   - Maximum accuracy. Every launcher's `--version` is the upstream's
 *     own answer for "what version is installed?" — no guessing about
 *     install layouts or manifest field names. Native installers
 *     (Anthropic's standalone Claude binary, OpenCode's scoop /
 *     single-binary), npm packages, and Homebrew casks all surface
 *     the same answer through `--version`, so one code path covers
 *     every install method.
 *   - No agent configuration or credential files are read. Discovery only
 *     checks executable names and installed Node.js version directories;
 *     probes use the fixed `--version` argument and never contact a registry.
 *
 * Spawn details live in {@link childProcessUtils}; the wrapper there
 * routes Windows calls through `cmd.exe` so PATHEXT resolves
 * `.cmd` / `.exe` shims for npm-installed CLIs, and injects the
 * enriched login-shell PATH so installs from any version manager
 * (fnm, nvm, asdf, mise, volta) are visible.
 */

import { runProbeCommand } from './childProcessUtils.ts';
import { discoverCommandInstallations, type CommandDiscoveryOptions, type CommandInstallationCandidate } from './commandInstallationDiscovery.ts';
import { getCachedEnrichedShellPath } from './enrichedShellEnv.ts';
import { getPathEnvKey, withEnrichedPath } from './envHelpers.ts';

export interface CommandInstallation extends CommandInstallationCandidate {
  version: string | null;
  /** A failed probe stays visible instead of being mistaken for an absent installation. */
  error?: string;
}

export interface CommandVersionResult {
  /** Extracted MAJOR.MINOR.PATCH(-suffix)? token, or null when not found. */
  version: string | null;
  /**
   * Absolute path of the first PATH match, including failed version probes.
   */
  resolvedFrom: string | null;
  /** Trimmed `--version` output. Useful for diagnostics in the modal. */
  rawOutput: string | null;
  installations: CommandInstallation[];
  discoveryErrors: string[];
}

interface CacheEntry {
  result: CommandVersionResult;
  expiresAt: number;
  fingerprint: string;
}

/**
 * 60s cache keeps repeated menu opens from re-spawning the CLI every
 * time. Users hit "refresh" in the installation details modal to invalidate
 * eagerly when they know they just upgraded.
 */
const CACHE_TTL_MS = 60_000;
/**
 * Each executable has a 3s timeout. Probes run in the background and
 * failed installations remain listed with an unavailable version.
 */
const PROBE_TIMEOUT_MS = 3_000;
const VERSION_REGEX = /\d+\.\d+\.\d+(-[\w.]+)?/;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, { fingerprint: string; promise: Promise<CommandVersionResult> }>();

/**
 * Probe `<command> --version` and return the extracted version
 * string. Caches results for {@link CACHE_TTL_MS} so a status bar
 * menu can be re-rendered without re-spawning the CLI.
 */
export function probeCommandVersion(
  command: string,
  options: Partial<CommandDiscoveryOptions> = {},
): Promise<CommandVersionResult> {
  const trimmed = command.trim();
  if (!trimmed) {
    return Promise.resolve({ version: null, resolvedFrom: null, rawOutput: null, installations: [], discoveryErrors: [] });
  }

  const env = options.env ?? withEnrichedPath(process.env, getCachedEnrichedShellPath());
  const fingerprint = JSON.stringify([
    env[getPathEnvKey(env)], env.PATHEXT, options.commonDirectories, options.cwd ?? process.cwd(),
    env.APPDATA, env.LOCALAPPDATA, env.ProgramFiles, env.PROGRAMFILES, env.VOLTA_HOME,
    env.FNM_DIR, env.NVM_DIR, env.NVM_HOME, env.ASDF_DATA_DIR, env.MISE_DATA_DIR,
    env.npm_config_prefix, env.NPM_CONFIG_PREFIX,
  ]);
  const cached = cache.get(trimmed);
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.result);
  }
  const pending = inFlight.get(trimmed);
  if (pending?.fingerprint === fingerprint) return pending.promise;
  const promise = runProbe(trimmed, { ...options, env }).then((result) => {
    if (inFlight.get(trimmed)?.promise === promise) {
      cache.set(trimmed, { result, expiresAt: Date.now() + CACHE_TTL_MS, fingerprint });
    }
    return result;
  }).finally(() => {
    if (inFlight.get(trimmed)?.promise === promise) inFlight.delete(trimmed);
  });
  inFlight.set(trimmed, { fingerprint, promise });
  return promise;
}

/**
 * Drop cached probe results. Exposed for explicit refresh actions
 * (e.g. the user just installed the CLI and wants to retry without
 * waiting for the cache TTL to expire).
 */
export function clearCommandVersionCache(command?: string): void {
  if (command) {
    cache.delete(command.trim());
    inFlight.delete(command.trim());
  } else {
    cache.clear();
    inFlight.clear();
  }
}

/**
 * Compare two semver-ish strings. Returns positive when `a > b`,
 * negative when `a < b`, and zero when equal. Pre-release suffixes
 * (`-rc.1` etc.) sort lower than the matching release, but we do
 * not implement full semver pre-release ordering — just enough to
 * surface "an upgrade is available" in the UI.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string): { core: number[]; pre: string | null } => {
    const [core, pre = null] = version.split('-', 2);
    return {
      core: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre,
    };
  };

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < length; i += 1) {
    const li = left.core[i] ?? 0;
    const ri = right.core[i] ?? 0;
    if (li !== ri) return li - ri;
  }

  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/**
 * Extract the first MAJOR.MINOR.PATCH(-suffix)? token from a string.
 */
export function extractVersionString(raw: string): string | null {
  const match = VERSION_REGEX.exec(raw);
  return match ? match[0] : null;
}

async function runProbe(command: string, options: CommandDiscoveryOptions): Promise<CommandVersionResult> {
  const discovery = await discoverCommandInstallations(command, options);
  const installations: CommandInstallation[] = [];
  let next = 0;
  let defaultOutput: string | null = null;
  // Bound process concurrency when several Node.js versions have global copies installed.
  const workers = Array.from({ length: Math.min(3, discovery.candidates.length) }, async () => {
    while (next < discovery.candidates.length) {
      const index = next++;
      const candidate = discovery.candidates[index];
      const result = await runProbeCommand({
        command: candidate.path,
        args: ['--version'],
        timeoutMs: PROBE_TIMEOUT_MS,
        env: options.env,
        useWindowsShell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(candidate.path),
      });
      const output = result ? `${result.stdout}\n${result.stderr}`.trim() : '';
      const version = result?.code === 0 ? extractVersionString(output) : null;
      installations[index] = {
        ...candidate,
        version,
        error: !result ? 'Version probe failed or timed out'
          : result.code !== 0 ? `Version probe exited with code ${result.code ?? 'unknown'}`
            : !version ? 'Version output could not be recognized' : undefined,
      };
      if (candidate.isDefault) defaultOutput = output || null;
    }
  });
  await Promise.all(workers);
  const defaultInstallation = installations.find((item) => item.isDefault);
  return {
    version: defaultInstallation?.version ?? null,
    resolvedFrom: defaultInstallation?.path ?? null,
    rawOutput: defaultOutput,
    installations,
    discoveryErrors: discovery.errors,
  };
}
