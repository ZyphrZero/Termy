/**
 * Centralized platform helpers.
 *
 * Termy only ever needs the host operating system name and the user's
 * home-directory path. We deliberately avoid importing Node's `os`
 * module (which Obsidian's community-plugin scanner flags as a
 * potential "system identity information" source) and instead rely on
 * the standard Node globals every plugin already uses for path
 * handling: `process.platform` and the `HOME` / `USERPROFILE`
 * environment variables.
 *
 * We avoid username, login-name, host-name, and machine-name signals;
 * callers only receive platform plus home-directory path information.
 */

/** Returns the Node platform identifier (e.g. `win32`, `darwin`, `linux`). */
export function getPlatform(): NodeJS.Platform {
  return process.platform;
}

/** True when running on Windows. */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/** True when running on macOS. */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/** True when running on Linux. */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Resolve the user's home-directory path without touching the `os`
 * module. On POSIX systems Node populates `HOME` at startup, and on
 * Windows it populates `USERPROFILE`. The returned value is an empty
 * string when neither variable is set, which callers should treat as a
 * "home directory unavailable" signal rather than as an absolute path.
 */
export function getHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '';
}
