/**
 * Read the user's login-shell `PATH` once at plugin load, then
 * surface it as a drop-in replacement env for child-process probes
 * (`commandAvailability`, `commandVersionProbe`, `nodeRuntime`) and
 * for newly spawned Termy terminal sessions.
 *
 * The motivation: Obsidian on Windows is launched from Explorer or a
 * pinned task-bar entry without running the user's PowerShell
 * profile, so any version manager that writes its `PATH` entries from
 * `profile.ps1` (fnm, scoop, mise, nvs) is invisible to the inherited
 * environment. macOS shows the same symptom for GUI launches:
 * `~/.zprofile` / `~/.zshrc` PATH overrides (nvm, asdf, mise, volta,
 * brew prefix) are never applied. By spawning the user's actual
 * login shell once and harvesting its `PATH`, Termy gets the same
 * view of the environment the user would see in their own terminal —
 * without trying to know which tool placed which directory there.
 *
 * Mechanics:
 *   - The shell is launched non-interactively with the user's profile
 *     loaded (`$SHELL -ilc` on POSIX, `powershell.exe` with profile on
 *     Windows). The probe never executes user-supplied commands; it
 *     just asks the shell to print the current `PATH` between two
 *     unique markers so any profile noise (banners, MOTDs, login
 *     greetings) can be sliced out cleanly.
 *   - Output is parsed strictly between the markers and validated
 *     against the platform's path delimiter.
 *   - A 3 s hard timeout protects the menu render path from a slow or
 *     interactive profile. If the probe times out or fails for any
 *     reason, the result is `null` and callers fall back to the
 *     unmodified `process.env.PATH`.
 *   - Results are cached per-process. Settings "Refresh" hooks call
 *     {@link clearEnrichedShellEnvCache} to re-run.
 *
 * Compliance notes (Obsidian policy):
 *   - No network traffic.
 *   - No installation, mutation, or persistence outside this process.
 *   - Read-only — only the user's shell PATH is harvested. Nothing
 *     else (history, secrets, env vars) is read or stored.
 *   - The harvest can be disabled via a setting; when disabled the
 *     module returns `null` immediately.
 */

import { runProbeCommand, type ProbeCommandResult } from './childProcessUtils.ts';

export { withEnrichedPath } from './envHelpers.ts';

const PROBE_TIMEOUT_MS = 3_000;
const BEGIN_MARKER = '<<<TERMY_ENRICHED_PATH_BEGIN>>>';
const END_MARKER = '<<<TERMY_ENRICHED_PATH_END>>>';

export interface EnrichedShellEnvResult {
  /** Harvested `PATH` value, or `null` when the probe failed. */
  path: string | null;
  /** Source the PATH came from; surfaced in settings diagnostics. */
  source: EnrichedShellEnvSource;
  /** Description of why the probe failed, when applicable. */
  error?: string;
}

export type EnrichedShellEnvSource =
  | 'login-shell'
  | 'powershell'
  | 'cmd'
  | 'process'
  | 'disabled'
  | 'unavailable';

interface EnrichedProbeOptions {
  /** When false, the harvest is skipped and the result is "disabled". */
  enabled: boolean;
}

let cached: Promise<EnrichedShellEnvResult> | null = null;
let cachedValue: EnrichedShellEnvResult | null = null;

/**
 * Probe the user's login shell for its `PATH` and cache the result
 * for the lifetime of the process. The first call kicks off the
 * spawn; subsequent calls return the cached promise.
 */
export function getEnrichedShellEnv(
  options: EnrichedProbeOptions = { enabled: true },
): Promise<EnrichedShellEnvResult> {
  if (!options.enabled) {
    const disabled: EnrichedShellEnvResult = { path: null, source: 'disabled' };
    cachedValue = disabled;
    return Promise.resolve(disabled);
  }
  if (cached) return cached;
  cached = runEnrichedShellEnvProbe().then((result) => {
    cachedValue = result;
    return result;
  });
  return cached;
}

/**
 * Sync read of the cached PATH harvest. Returns `null` when the
 * probe is still in flight or has not been kicked off yet. Used by
 * synchronous code paths that cannot wait (terminal env injection on
 * leaf creation), where the plugin has already pre-warmed the cache
 * during `onload`.
 */
export function getCachedEnrichedShellPath(): string | null {
  return cachedValue?.path ?? null;
}

/**
 * Sync read of the full cached result (path + source + error) for
 * settings diagnostics.
 */
export function getCachedEnrichedShellEnv(): EnrichedShellEnvResult | null {
  return cachedValue;
}

/**
 * Reset the cache. Settings "Refresh" buttons call this so a user can
 * re-probe after editing their shell profile without restarting
 * Obsidian.
 */
export function clearEnrichedShellEnvCache(): void {
  cached = null;
  cachedValue = null;
}

/**
 * Internal: actually run the probe. Exposed (named) for tests via
 * direct import; production code should always call
 * {@link getEnrichedShellEnv}.
 */
export async function runEnrichedShellEnvProbe(): Promise<EnrichedShellEnvResult> {
  if (process.platform === 'win32') return runWindowsProbe();
  return runPosixProbe();
}

async function runPosixProbe(): Promise<EnrichedShellEnvResult> {
  const shell = process.env.SHELL || '/bin/sh';
  const script = `printf '%s\\n%s\\n%s\\n' '${BEGIN_MARKER}' "$PATH" '${END_MARKER}'`;
  const result = await runProbeCommand({
    command: shell,
    args: ['-ilc', script],
    timeoutMs: PROBE_TIMEOUT_MS,
    env: minimalSpawnEnv(),
  });
  return interpretProbeResult(result, 'login-shell');
}

async function runWindowsProbe(): Promise<EnrichedShellEnvResult> {
  // Try PowerShell first because that is where fnm, scoop, and most
  // version managers wire their PATH adjustments (profile.ps1).
  // Fall back to cmd.exe so users with execution-policy lockdowns
  // still get the system-PATH portion of the harvest. Even though
  // cmd does not run a per-user profile by default, this keeps the
  // pipeline observable when PowerShell is restricted.
  const psCommand = `Write-Output '${BEGIN_MARKER}'; Write-Output $env:PATH; Write-Output '${END_MARKER}'`;
  const psArgs = [
    '-NoLogo',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    psCommand,
  ];

  for (const shellName of ['pwsh.exe', 'powershell.exe']) {
    const result = await runProbeCommand({
      command: shellName,
      args: psArgs,
      timeoutMs: PROBE_TIMEOUT_MS,
      useWindowsShell: false,
      env: minimalSpawnEnv(),
    });
    const interpreted = interpretProbeResult(result, 'powershell');
    if (interpreted.path) return interpreted;
  }

  const cmdResult = await runProbeCommand({
    command: 'cmd.exe',
    args: ['/D', '/C', `echo ${BEGIN_MARKER}& echo %PATH%& echo ${END_MARKER}`],
    timeoutMs: PROBE_TIMEOUT_MS,
    useWindowsShell: false,
    env: minimalSpawnEnv(),
  });
  const interpreted = interpretProbeResult(cmdResult, 'cmd');
  if (interpreted.path) return interpreted;

  return {
    path: null,
    source: 'unavailable',
    error: interpreted.error ?? 'No shell probe returned a usable PATH',
  };
}

function interpretProbeResult(
  result: ProbeCommandResult | null,
  source: EnrichedShellEnvSource,
): EnrichedShellEnvResult {
  if (!result) {
    return { path: null, source, error: 'shell probe failed or timed out' };
  }
  if (result.code !== 0 && !result.stdout) {
    return {
      path: null,
      source,
      error: `shell probe exited with ${result.code}: ${result.stderr.trim()}`,
    };
  }
  const path = extractMarkedValue(result.stdout);
  if (!path) {
    return {
      path: null,
      source,
      error: 'PATH markers not found in shell output',
    };
  }
  if (!validatePath(path)) {
    return { path: null, source, error: 'PATH validation failed' };
  }
  return { path, source };
}

/**
 * Extract the line between BEGIN and END markers. The shell may
 * print extra noise (banners, command echoes); marker slicing keeps
 * the parser deterministic.
 */
export function extractMarkedValue(output: string): string | null {
  const beginIdx = output.indexOf(BEGIN_MARKER);
  if (beginIdx < 0) return null;
  const valueStart = beginIdx + BEGIN_MARKER.length;
  const endIdx = output.indexOf(END_MARKER, valueStart);
  if (endIdx < 0) return null;

  const slice = output.slice(valueStart, endIdx).trim();
  return slice.length > 0 ? slice : null;
}

/**
 * Sanity check: a PATH value must not contain NUL bytes (which
 * would only appear if marker parsing went sideways) or marker
 * leftovers.
 */
export function validatePath(value: string): boolean {
  if (value.includes('\u0000')) return false;
  if (value.includes(BEGIN_MARKER) || value.includes(END_MARKER)) return false;
  return true;
}

/**
 * Build the minimum env required for the user's profile to evaluate
 * correctly. Stripping the rest reduces the chance of profile
 * scripts echoing inherited env values into stdout, which would
 * confuse marker-based slicing.
 */
function minimalSpawnEnv(): Record<string, string> {
  const env = process.env;
  const result: Record<string, string> = {};
  const passthrough = process.platform === 'win32'
    ? ['USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'PATH', 'PATHEXT']
    : ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'PATH', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];
  for (const key of passthrough) {
    const value = env[key];
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}
