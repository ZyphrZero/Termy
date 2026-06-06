/**
 * Logging utilities - only output logs in debug mode
 */

let debugMode = false;

/**
 * Set debug mode
 */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

/**
 * Get the current debug mode status
 */
export function isDebugMode(): boolean {
  return debugMode;
}

/**
 * Debug logs - only output in debug mode
 */
export function debugLog(...args: unknown[]): void {
  if (debugMode) {
    console.debug(...args);
  }
}

/**
 * Debug timing logs - only output in debug mode.
 */
export function debugTiming(label: string, startedAt: number, ...args: unknown[]): void {
  debugLog(`${label} +${formatElapsedMs(startedAt)}`, ...args);
}

/**
 * Debug timing logs for slow operations - only output in debug mode.
 */
export function debugTimingIfSlow(
  label: string,
  startedAt: number,
  thresholdMs: number,
  ...args: unknown[]
): void {
  const elapsedMs = performance.now() - startedAt;
  if (elapsedMs >= thresholdMs) {
    debugLog(`${label} +${formatElapsedMsValue(elapsedMs)}`, ...args);
  }
}

/**
 * Debug warnings - only output in debug mode
 */
export function debugWarn(...args: unknown[]): void {
  if (debugMode) {
    console.warn(...args);
  }
}

/**
 * Error logs - always output (error messages are important)
 */
export function errorLog(...args: unknown[]): void {
  console.error(...args);
}

function formatElapsedMs(startedAt: number): string {
  return formatElapsedMsValue(performance.now() - startedAt);
}

function formatElapsedMsValue(elapsedMs: number): string {
  return `${elapsedMs.toFixed(1)}ms`;
}
