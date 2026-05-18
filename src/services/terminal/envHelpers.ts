/**
 * Tiny PATH-merging helpers shared between the enriched-shell-env
 * harvest and the child-process probe primitives. Keeping these in
 * a leaf module avoids an import cycle between
 * {@link enrichedShellEnv} and {@link childProcessUtils} — both
 * sides need PATH-key resolution but neither should depend on the
 * other.
 */

/**
 * Combine a base env (typically `process.env`) with an enriched
 * `PATH`, returning a new object. The original env is not mutated.
 * If `enrichedPath` is null, the base env is returned untouched.
 */
export function withEnrichedPath(
  baseEnv: Record<string, string | undefined>,
  enrichedPath: string | null,
): Record<string, string | undefined> {
  if (!enrichedPath) return baseEnv;
  const pathKey = getPathEnvKey(baseEnv);
  return { ...baseEnv, [pathKey]: enrichedPath };
}

/**
 * Resolve the canonical PATH key for the given env. Windows is
 * case-insensitive about variable names — `Path` and `PATH` refer
 * to the same value — but Node passes the env through verbatim, so
 * we honour whichever case the inherited env used to avoid ending up
 * with both `Path` and `PATH` set on the spawned child.
 */
export function getPathEnvKey(env: Record<string, string | undefined>): string {
  if (process.platform !== 'win32') return 'PATH';
  const existingKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  return existingKey ?? 'PATH';
}
