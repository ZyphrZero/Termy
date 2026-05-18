/**
 * Local version probe for AI launcher CLIs.
 *
 * Runs `<tool> --version` and extracts the first MAJOR.MINOR.PATCH(-suffix)?
 * token from its output.
 *
 * Why direct invocation:
 *   - Maximum accuracy. Every launcher's `--version` is the upstream's
 *     own answer for "what version is installed?" — no guessing about
 *     install layouts or manifest field names. Native installers
 *     (Anthropic's standalone Claude binary, OpenCode's scoop /
 *     single-binary), npm packages, and Homebrew casks all surface
 *     the same answer through `--version`, so one code path covers
 *     every install method.
 *   - Minimal system intrusion. We do not walk `~/.claude`,
 *     `~/.opencode`, `%APPDATA%\npm`, or any other user-data
 *     directory looking for a manifest. The probe only invokes the
 *     CLI the user already authorized us to launch via the preset
 *     workflow, with a fixed `--version` argument; it cannot pick up
 *     secrets or read files outside the launcher itself.
 *
 * Spawn details live in {@link childProcessUtils}; the wrapper there
 * routes Windows calls through `cmd.exe` so PATHEXT resolves
 * `.cmd` / `.exe` shims for npm-installed CLIs, and injects the
 * enriched login-shell PATH so installs from any version manager
 * (fnm, nvm, asdf, mise, volta) are visible.
 */

import { runProbeCommand } from './childProcessUtils.ts';

export interface CommandVersionResult {
  /** Extracted MAJOR.MINOR.PATCH(-suffix)? token, or null when not found. */
  version: string | null;
  /**
   * Absolute path of the binary that satisfied the probe, when known.
   * Currently always null because we let `cmd.exe` / PATH do
   * resolution internally; kept on the result shape so callers and
   * the snapshot builder stay source-compatible with the historical
   * fallback-scan implementation.
   */
  resolvedFrom: string | null;
  /** Trimmed `--version` output. Useful for diagnostics in the modal. */
  rawOutput: string | null;
}

interface CacheEntry {
  result: CommandVersionResult;
  expiresAt: number;
}

/**
 * 60s cache keeps repeated menu opens from re-spawning the CLI every
 * time. Users hit "refresh" in the install modal to invalidate
 * eagerly when they know they just upgraded.
 */
const CACHE_TTL_MS = 60_000;
/**
 * 3s timeout. We are blocking the menu render path, so we cap
 * aggressively. Every supported CLI replies within ~200ms in
 * practice; if one hangs we'd rather show the badge with no version
 * than freeze the popup.
 */
const PROBE_TIMEOUT_MS = 3_000;
const VERSION_REGEX = /\d+\.\d+\.\d+(-[\w.]+)?/;

const cache = new Map<string, CacheEntry>();

/**
 * Probe `<command> --version` and return the extracted version
 * string. Caches results for {@link CACHE_TTL_MS} so a status bar
 * menu can be re-rendered without re-spawning the CLI.
 */
export async function probeCommandVersion(command: string): Promise<CommandVersionResult> {
  const trimmed = command.trim();
  if (!trimmed) {
    return { version: null, resolvedFrom: null, rawOutput: null };
  }

  const cached = cache.get(trimmed);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const result = await runProbe(trimmed);
  cache.set(trimmed, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * Drop cached probe results. Exposed for explicit refresh actions
 * (e.g. the user just installed the CLI and wants to retry without
 * waiting for the cache TTL to expire).
 */
export function clearCommandVersionCache(command?: string): void {
  if (command) {
    cache.delete(command.trim());
  } else {
    cache.clear();
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

async function runProbe(command: string): Promise<CommandVersionResult> {
  const result = await runProbeCommand({
    command,
    args: ['--version'],
    timeoutMs: PROBE_TIMEOUT_MS,
  });

  if (!result) {
    return { version: null, resolvedFrom: null, rawOutput: null };
  }

  // Prefer stdout, fall back to stderr — some CLIs emit `--version`
  // on stderr (e.g. older Codex builds).
  const merged = (result.stdout || result.stderr).trim();
  return {
    version: merged ? extractVersionString(merged) : null,
    resolvedFrom: null,
    rawOutput: merged || null,
  };
}
