/** The supported interface exposed as `app.plugins.getPlugin('termy').api`. */
export interface TermyApi {
  readonly version: 1;
  /** Open a new terminal tab and resolve after its PTY and view are ready. */
  createTerminal(options?: CreateTerminalOptions): Promise<TerminalHandle>;
}

export interface CreateTerminalOptions {
  /** Executable name on PATH or an unquoted executable path. Defaults to the configured shell. */
  executable?: string;
  /** Literal argv entries. A custom executable defaults to [], rather than global shell arguments. */
  args?: readonly string[];
  /** Working directory on the host OS. Defaults to Termy's configured working-directory behavior. */
  cwd?: string;
  /** Custom tab title, protected from process title updates. */
  title?: string;
  /** Whether to activate the tab. Defaults to Termy's focus-new-instance setting. */
  focus?: boolean;
}

export interface TerminalHandle {
  readonly id: string;
  /** True after the terminal is closed or Termy is unloaded. */
  readonly isClosed: boolean;
  getTitle(): string;
  setTitle(title: string): void;
  /** Send raw input to the PTY. Include \r to submit a shell command. */
  write(data: string): void;
  /** Reveal and focus the terminal, including after it moves to another window. */
  focus(): Promise<void>;
  /** Close the terminal and its tab. Safe to call more than once. */
  close(): Promise<void>;
}
