/**
 * Combined readiness + version state for an AI launcher row.
 *
 * Termy renders four interesting cases in the status bar menu and the
 * install modal:
 *
 *   - 'unknown'          probe still in flight or failed for non-deterministic
 *                        reasons (sandbox, missing child_process, etc.)
 *   - 'not-installed'    PATH probe came back negative AND the version
 *                        probe failed to find anything either
 *   - 'ready'            CLI is available and either matches the latest
 *                        published version or the user has not opted in
 *                        to the registry check
 *   - 'update-available' CLI is available but the registry reports a
 *                        higher version
 *
 * `local` and `latest` track the actual version strings so the modal can
 * say "1.5.0 → 1.7.2" instead of just "update available".
 */

// `.ts` suffix is required so the `node --experimental-strip-types` test
// runner can resolve the sibling module — it never falls back to extension
// guessing the way esbuild does. Other sibling imports in this folder do
// the same.
import { compareVersions } from './commandVersionProbe.ts';
import type { NodeRuntimeSnapshot } from './nodeRuntime.ts';

export type AiLauncherReadiness =
  | 'unknown'
  | 'not-installed'
  | 'ready'
  | 'update-available';

export interface AiLauncherStatusSnapshot {
  readiness: AiLauncherReadiness;
  /** Local version reported by `<command> --version`. */
  local: string | null;
  /** Latest version reported by the upstream registry, if checked. */
  latest: string | null;
  /** Set when the registry lookup failed; surfaced in the install modal. */
  registryError?: string;
  /** Absolute path the local probe resolved to, if known. */
  resolvedFrom?: string | null;
  /** Node.js/npm/fnm readiness, only populated for npm-backed launchers. */
  nodeRuntime?: NodeRuntimeSnapshot | null;
}

export interface BuildSnapshotInput {
  /**
   * Output of {@link detectCommandAvailability} — bool-equivalent: was the
   * command resolvable on PATH?
   */
  pathAvailable: 'ready' | 'not-installed' | 'unknown';
  /**
   * Output of {@link probeCommandVersion}. Populated regardless of whether
   * the registry check is enabled — the menu still wants to display the
   * local version where it can.
   */
  local: { version: string | null; resolvedFrom: string | null };
  /**
   * Output of {@link fetchLatestVersion}. Pass `null` when the user has
   * not opted in to update checks.
   */
  latest: { version: string | null; error?: string } | null;
  /** Optional Node.js/npm/fnm readiness for npm-backed install guidance. */
  nodeRuntime?: NodeRuntimeSnapshot | null;
}

/**
 * Combine the probe results into a single snapshot the UI can consume.
 *
 * Rules:
 *   - PATH probe wins for 'not-installed' even if a registry lookup
 *     succeeded (we cannot upgrade what isn't installed).
 *   - 'unknown' from the PATH probe falls through so a successful local
 *     version probe upgrades the readiness to 'ready' or
 *     'update-available'. This handles the macOS/launchd case where
 *     the GUI Obsidian process has a sparse PATH but the binary exists.
 */
export function buildAiLauncherStatusSnapshot(
  input: BuildSnapshotInput,
): AiLauncherStatusSnapshot {
  const { pathAvailable, local, latest, nodeRuntime = null } = input;

  if (pathAvailable === 'not-installed' && !local.version) {
    return {
      readiness: 'not-installed',
      local: null,
      latest: latest?.version ?? null,
      registryError: latest?.error,
      nodeRuntime,
    };
  }

  // We treat 'unknown' permissively when the local probe found *something*.
  const haveLocal = local.version !== null;
  if (!haveLocal && pathAvailable === 'unknown') {
    return {
      readiness: 'unknown',
      local: null,
      latest: latest?.version ?? null,
      registryError: latest?.error,
      nodeRuntime,
    };
  }

  if (haveLocal && latest?.version) {
    const cmp = compareVersions(local.version!, latest.version);
    if (cmp < 0) {
      return {
        readiness: 'update-available',
        local: local.version,
        latest: latest.version,
        registryError: latest.error,
        resolvedFrom: local.resolvedFrom,
        nodeRuntime,
      };
    }
  }

  return {
    readiness: 'ready',
    local: local.version,
    latest: latest?.version ?? null,
    registryError: latest?.error,
    resolvedFrom: local.resolvedFrom,
    nodeRuntime,
  };
}

/**
 * Map the readiness state from a snapshot onto the badge enum the menu
 * uses. Centralised so the menu renderer doesn't need to know about the
 * snapshot's internal shape.
 */
export function readinessToBadge(
  readiness: AiLauncherReadiness,
):
  | 'ready'
  | 'not-installed'
  | 'update-available'
  | 'checking' {
  switch (readiness) {
    case 'not-installed': return 'not-installed';
    case 'update-available': return 'update-available';
    case 'unknown': return 'checking';
    case 'ready':
    default: return 'ready';
  }
}
