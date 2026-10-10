/** Per-instance PTY options after public API defaults have been resolved. */
export interface TerminalLaunchSpec {
  shellType?: string;
  shellArgs?: string[];
  cwd?: string;
  title?: string;
}
