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
