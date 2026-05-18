/**
 * Single shared child-process spawn primitive used by every
 * read-only diagnostic probe in this folder.
 *
 * Termy's three probes (`commandAvailability`, `commandVersionProbe`,
 * `nodeRuntime`) all needed to:
 *   - load `child_process` lazily through `window.require`
 *   - spawn a short-lived diagnostic command
 *   - inject the enriched login-shell PATH so version managers (fnm,
 *     nvm, asdf, mise, volta, …) and any other shell-profile-based
 *     PATH entries are visible
 *   - capture stdout / stderr
 *   - cap the call with a hard timeout
 *   - swallow spawn errors and report "we don't know" up the stack
 *
 * Concentrating that into one function eliminates the duplicated
 * boilerplate, removes the slight behavioural drifts between the
 * three copies, and gives tests one place to stub.
 */

import { debugWarn } from '../../utils/logger.ts';
import { getCachedEnrichedShellPath } from './enrichedShellEnv.ts';
import { withEnrichedPath } from './envHelpers.ts';

export interface RunProbeCommandOptions {
  command: string;
  args: string[];
  /** Hard timeout. Defaults to 3 seconds — long enough for any sane CLI's `--version`. */
  timeoutMs?: number;
  /**
   * On Windows, wrap the call in `cmd.exe /C "<command> <args>"` so
   * PATHEXT resolves `.cmd` / `.exe` shims for npm-installed CLIs.
   * Set false to bypass the wrapper for binaries that handle their
   * own resolution (`where`, `which`) or for shells we want to
   * launch directly (PowerShell, login bash). POSIX always spawns
   * the binary directly, regardless of this flag.
   *
   * Defaults to true — that matches what most callers want.
   */
  useWindowsShell?: boolean;
  /**
   * Override the spawned child's environment. Defaults to
   * `process.env` plus the enriched login-shell PATH (so npm-installed
   * CLIs registered via fnm / nvm / asdf / mise / volta are visible).
   * The enriched-shell-env probe itself passes a minimal env to avoid
   * a chicken-and-egg dependency.
   */
  env?: Record<string, string | undefined>;
}

export interface ProbeCommandResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null when the process did not exit cleanly. */
  code: number | null;
}

interface ChildProcessLike {
  stdout?: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
  stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  kill(): void;
}

interface NodeChildProcess {
  spawn: (
    command: string,
    args: string[],
    options: Record<string, unknown>,
  ) => ChildProcessLike;
}

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Spawn a short-lived diagnostic command and resolve with its
 * stdout / stderr / exit code.
 *
 * Returns `null` when:
 *   - `child_process` is unavailable (sandboxed environment)
 *   - `spawn` itself throws synchronously
 *   - the command times out
 *   - the process emits an `error` event before `exit`
 *
 * Callers that need finer-grained results (a missing binary vs. a
 * binary that exited with a non-zero code) inspect `code` directly.
 */
export function runProbeCommand(
  options: RunProbeCommandOptions,
): Promise<ProbeCommandResult | null> {
  const {
    command,
    args,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    useWindowsShell = true,
    env,
  } = options;

  return new Promise((resolve) => {
    const childProcess = loadChildProcess();
    if (!childProcess) {
      resolve(null);
      return;
    }

    const spawnEnv = env ?? withEnrichedPath(process.env, getCachedEnrichedShellPath());
    let proc: ChildProcessLike;
    try {
      if (process.platform === 'win32' && useWindowsShell) {
        proc = childProcess.spawn(
          'cmd.exe',
          ['/C', formatWindowsCommandLine(command, args)],
          { windowsHide: true, env: spawnEnv },
        );
      } else {
        proc = childProcess.spawn(command, args, {
          windowsHide: true,
          env: spawnEnv,
        });
      }
    } catch (error) {
      debugWarn(`[childProcessUtils] spawn failed for ${command}:`, error);
      resolve(null);
      return;
    }

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    let settled = false;
    const finish = (value: ProbeCommandResult | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = window.setTimeout(() => {
      try {
        proc.kill();
      } catch (error) {
        debugWarn(`[childProcessUtils] failed to kill ${command}:`, error);
      }
      finish(null);
    }, timeoutMs);

    proc.on('error', () => {
      window.clearTimeout(timer);
      finish(null);
    });

    proc.on('exit', (code) => {
      window.clearTimeout(timer);
      finish({ stdout, stderr, code });
    });
  });
}

function formatWindowsCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteWindowsShellArg).join(' ');
}

function quoteWindowsShellArg(arg: string): string {
  if (/^[A-Za-z0-9._/@:-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function loadChildProcess(): NodeChildProcess | null {
  try {
    return window.require('child_process') as NodeChildProcess;
  } catch (error) {
    debugWarn('[childProcessUtils] child_process unavailable:', error);
    return null;
  }
}
