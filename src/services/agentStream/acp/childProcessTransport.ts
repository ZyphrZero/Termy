/**
 * `child_process` based {@link AcpTransport}.
 *
 * Spawns the agent CLI with stdio piped, decodes stderr line-by-line
 * for log routing, and resolves `start()` only after the child has
 * actually been spawned (so a missing executable produces an early
 * error instead of a stalled handshake).
 *
 * Key Windows considerations baked in:
 *
 * - **`spawn` cannot run `.cmd` / `.bat` shims directly without
 *   `shell: true`** — but `shell: true` breaks stdio piping, which
 *   ACP relies on. Instead, we resolve the executable against PATH
 *   ourselves (consulting PATHEXT) and pass the absolute path to
 *   `spawn`. This matches how Termy's other launchers find
 *   npm-installed CLIs while keeping the stdio channel raw.
 *
 * - **All stderr output up to first close is preserved.** When the
 *   agent exits early (missing CLI, bad flag, missing API key), the
 *   close listener gets the captured stderr text appended to the
 *   reason so the user sees a useful error instead of just
 *   `code 1`.
 *
 * Node's `child_process` is only available in the renderer process
 * via `window.require`, mirroring how the rest of Termy reaches
 * Node-only modules.
 */

import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from 'child_process';

import type { AcpTransport } from './acpClient.ts';

type ChildProcessModule = typeof import('child_process');
type FsModule = typeof import('fs');
type PathModule = typeof import('path');

export interface AcpChildProcessTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Maximum stderr bytes preserved for a transport-close diagnostic.
 * Bigger than the typical Node stack trace, smaller than something
 * that would fill up the agent panel header.
 */
const STDERR_DIAGNOSTIC_MAX_BYTES = 8 * 1024;

export class AcpChildProcessTransport implements AcpTransport {
  private readonly options: AcpChildProcessTransportOptions;
  private readonly dataListeners = new Set<(chunk: Buffer) => void>();
  private readonly logListeners = new Set<(text: string) => void>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private stderrBuffer = '';
  /**
   * Recent stderr bytes captured for the close diagnostic. Separate
   * from {@link stderrBuffer} which streams complete lines to log
   * listeners — diagnostics need to keep the unfinished tail too.
   */
  private stderrDiagnostic = '';
  private closed = false;

  constructor(options: AcpChildProcessTransportOptions) {
    this.options = options;
  }

  start(): Promise<void> {
    if (this.child) {
      return Promise.resolve();
    }

    const childProcess = window.require('child_process') as ChildProcessModule;
    const fs = window.require('fs') as FsModule;
    const path = window.require('path') as PathModule;

    const env = { ...process.env, ...(this.options.env ?? {}) };
    const resolvedCommand = resolveExecutableOnPath(
      this.options.command,
      env,
      fs,
      path,
    );
    if (!resolvedCommand) {
      return Promise.reject(
        new Error(
          `Agent executable \`${this.options.command}\` was not found on PATH. ` +
          `Install it (or update the configured command) and try again.`,
        ),
      );
    }

    // Node 20+ refuses to spawn `.cmd`/`.bat` files directly with
    // `shell: false` (CVE-2024-27980). The pragmatic fix is to flip
    // `shell: true` for those: Node then internally invokes
    // `cmd.exe /d /s /c ...` and uses `windowsVerbatimArguments` so
    // *Node* (not us) gets the cmd.exe quoting right. We just have
    // to pre-quote args that contain whitespace, since `shell: true`
    // joins argv with spaces.
    let spawnCommand: string;
    let spawnArgs: string[];
    let useShell = false;
    if (process.platform === 'win32' && isWindowsBatch(resolvedCommand)) {
      spawnCommand = wrapWindowsArg(resolvedCommand);
      spawnArgs = (this.options.args ?? []).map(wrapWindowsArg);
      useShell = true;
    } else {
      spawnCommand = resolvedCommand;
      spawnArgs = this.options.args ?? [];
    }

    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: useShell,
    };

    return new Promise<void>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = childProcess.spawn(spawnCommand, spawnArgs, spawnOptions);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      this.child = child;

      const onSpawnError = (error: Error): void => {
        reject(error);
      };
      child.once('error', onSpawnError);

      // The 'spawn' event fires once the child is launched but
      // before any IO is forwarded, which is exactly when we want to
      // consider start() resolved. Older Electron versions on
      // Windows sometimes skip this event when the binary is
      // missing — in that case the 'error' branch above fires and
      // rejects.
      child.once('spawn', () => {
        child.off('error', onSpawnError);
        child.on('error', (error) => {
          this.emitClose(`agent process error: ${error.message}`);
        });
        resolve();
      });

      child.stdout.on('data', (chunk) => {
        const buffer: Buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as ArrayBufferLike);
        for (const listener of this.dataListeners) {
          listener(buffer);
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        this.captureStderr(text);
      });

      child.on('close', (code, signal) => {
        const trailing = this.stderrBuffer.replace(/\r$/, '').trim();
        if (trailing.length > 0) {
          for (const listener of this.logListeners) {
            listener(trailing);
          }
          this.stderrBuffer = '';
        }
        const baseReason = signal
          ? `agent process killed (${signal})`
          : `agent process exited (code ${code ?? 'null'})`;
        const diagnostic = this.stderrDiagnostic.trim();
        const reason = diagnostic.length > 0
          ? `${baseReason}\n${diagnostic}`
          : baseReason;
        this.emitClose(reason);
      });
    });
  }

  send(frame: Buffer): void {
    if (!this.child || this.closed) {
      return;
    }
    this.child.stdin.write(frame);
  }

  onData(listener: (chunk: Buffer) => void): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onLog(listener: (text: string) => void): () => void {
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
    };
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  stop(): Promise<void> {
    if (!this.child || this.closed) {
      return Promise.resolve();
    }
    const child = this.child;
    return new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* swallow — child may already be dead */
        }
      }, 1500);

      child.once('close', () => {
        window.clearTimeout(timeout);
        resolve();
      });
      try {
        // Politely close stdin and signal the agent to exit.
        child.stdin.end();
        child.kill();
      } catch {
        // If kill throws (already dead), still wait for the close event.
      }
    });
  }

  private captureStderr(text: string): void {
    this.stderrBuffer += text;
    let newlineIndex = this.stderrBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stderrBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.stderrBuffer = this.stderrBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        for (const listener of this.logListeners) {
          listener(line);
        }
      }
      newlineIndex = this.stderrBuffer.indexOf('\n');
    }

    // Append to diagnostic capture, trimming from the front when
    // we exceed the cap so we always keep the *latest* stderr in
    // case the agent prints a short error right before exit.
    this.stderrDiagnostic += text;
    if (this.stderrDiagnostic.length > STDERR_DIAGNOSTIC_MAX_BYTES) {
      this.stderrDiagnostic = this.stderrDiagnostic.slice(
        this.stderrDiagnostic.length - STDERR_DIAGNOSTIC_MAX_BYTES,
      );
    }
  }

  private emitClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) {
      listener(reason);
    }
  }
}

/**
 * Locate `command` on PATH the way a shell would, taking PATHEXT
 * into account on Windows.
 *
 * Returns `null` if the command is not found. If the command is
 * already an absolute or rooted path that exists on disk, it is
 * returned unchanged.
 */
export function resolveExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  fs: FsModule,
  path: PathModule,
): string | null {
  if (!command) return null;

  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return existsAsFile(fs, command) ? command : null;
  }

  const isWindows = process.platform === 'win32';
  const pathEntries = (env.PATH ?? env.Path ?? env.path ?? '')
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);

  const extensionCandidates: string[] = [''];
  if (isWindows) {
    const pathext = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext.length > 0);
    // Prefer the literal extension (`.exe`) before falling back to a
    // parameterless lookup that catches manually-installed binaries
    // without an extension.
    extensionCandidates.unshift(...pathext);
  }

  for (const entry of pathEntries) {
    for (const ext of extensionCandidates) {
      const candidate = path.join(entry, `${command}${ext}`);
      if (existsAsFile(fs, candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function existsAsFile(fs: FsModule, candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

export function isWindowsBatch(executable: string): boolean {
  const lower = executable.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat');
}

/**
 * Wrap a Windows shell argument in double quotes when (and only
 * when) it contains whitespace. With `shell: true` Node joins argv
 * with spaces before handing the line to cmd.exe via
 * `windowsVerbatimArguments`, so any token with whitespace must
 * arrive pre-quoted to survive the join.
 *
 * We deliberately do *not* try to escape embedded `"` or `^&|<>%`
 * here: agent commands are user-controlled config (no untrusted
 * input) and adding escapes would re-introduce the multi-layer
 * quoting bugs we are trying to avoid by switching to `shell: true`
 * in the first place.
 */
export function wrapWindowsArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/\s/.test(arg)) return arg;
  return `"${arg}"`;
}
