/**
 * 日志工具 - 仅在调试模式下输出日志
 */

let debugMode = false;

/**
 * 设置调试模式
 */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

/**
 * 获取调试模式状态
 */
export function isDebugMode(): boolean {
  return debugMode;
}

/**
 * 调试日志 - 仅在调试模式下输出
 */
export function debugLog(...args: unknown[]): void {
  if (debugMode) {
    console.log(...args);
  }
}

/**
 * 调试警告 - 仅在调试模式下输出
 */
export function debugWarn(...args: unknown[]): void {
  if (debugMode) {
    console.warn(...args);
  }
}

/**
 * 错误日志 - 始终输出（错误信息很重要）
 */
export function errorLog(...args: unknown[]): void {
  console.error(...args);
}
