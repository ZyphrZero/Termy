/**
 * Lightweight detection for whether an executable is available on the
 * environment Termy actually sees — that is, the inherited Obsidian
 * PATH plus the enriched login-shell PATH harvested by
 * {@link enrichedShellEnv}. This makes version managers like fnm,
 * nvm, asdf, mise, volta and any manual install behave the same way.
 *
 * Used by the workflow launcher menu to render readiness badges:
 *  - 'ready'         → executable resolves on PATH
 *  - 'not-installed' → resolver returned a non-zero status
 *  - 'unknown'       → resolver failed for an unexpected reason
 *
 * Detection only spawns the platform's standard PATH resolver
 * (`where` / `which`). It never executes the target command, never
 * auto-installs anything, and never touches the network — it is
 * purely informational.
 */

import { runProbeCommand } from './childProcessUtils.ts';

export type CommandAvailability = 'ready' | 'not-installed' | 'unknown';

interface CacheEntry {
  result: CommandAvailability;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;
const PROBE_TIMEOUT_MS = 1_500;

const cache = new Map<string, CacheEntry>();

/**
 * Detect whether an executable is reachable from the current PATH.
 * Results are cached for a few seconds so menu re-opens are cheap.
 */
export function detectCommandAvailability(command: string): Promise<CommandAvailability> {
  const trimmed = command.trim();
  if (!trimmed) return Promise.resolve('unknown');

  const cached = cache.get(trimmed);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.result);
  }

  return runDetection(trimmed).then((result) => {
    cache.set(trimmed, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  });
}

/**
 * Clear cached detection results. Exposed primarily for tests and
 * explicit refresh actions (e.g. when the user re-runs an install
 * step).
 */
export function clearCommandAvailabilityCache(command?: string): void {
  if (command) {
    cache.delete(command.trim());
  } else {
    cache.clear();
  }
}

async function runDetection(command: string): Promise<CommandAvailability> {
  const resolver = process.platform === 'win32' ? 'where' : 'which';
  const result = await runProbeCommand({
    command: resolver,
    args: [command],
    timeoutMs: PROBE_TIMEOUT_MS,
    // `where` / `which` resolve PATH themselves; bypassing the
    // cmd.exe wrapper avoids a second layer of escaping.
    useWindowsShell: false,
  });
  if (!result) return 'unknown';
  return result.code === 0 ? 'ready' : 'not-installed';
}
