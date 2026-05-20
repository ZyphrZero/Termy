/**
 * Spawn-based client for Claude Code's `--output-format stream-json`
 * protocol.
 *
 * Each "turn" spawns a fresh `claude -p --verbose --output-format
 * stream-json --input-format stream-json --include-partial-messages
 * --resume <sid>` child process, feeds the user prompt on stdin, and
 * yields parsed JSON lines from stdout until the process exits.
 *
 * This is the zero-dependency equivalent of `@anthropic-ai/claude-agent-sdk`'s
 * `query()` function — same wire format, no 72 MB native prebuild.
 */

import type { ChildProcess } from 'child_process';
import type { ClaudeNativeMessage } from './claudeCodeTypes.ts';
import { debugLog, errorLog } from '@/utils/logger';

type ChildProcessModule = typeof import('child_process');

export interface ClaudeStreamClientOptions {
  /** Resolved path to the `claude` executable. Defaults to `'claude'` (PATH lookup). */
  command?: string;
  /** Working directory for the child process (vault root). */
  cwd: string;
  /** Session id to resume. Omit for a brand-new session. */
  resumeSessionId?: string;
  /** Permission mode flag. Defaults to `'default'`. */
  permissionMode?: string;
  /** Extra env vars merged onto `process.env`. */
  extraEnv?: Record<string, string>;
}

export interface ClaudeStreamTurn {
  /** Async iterable of parsed JSON lines from stdout. */
  messages: AsyncIterable<ClaudeNativeMessage>;
  /** Send SIGTERM to the child process (cancel the turn). */
  cancel: () => void;
  /** Resolves when the child process exits. Value is the exit code (null = signal). */
  done: Promise<number | null>;
}

/**
 * Start a turn. The caller iterates `messages` to receive streaming
 * events, and awaits `done` to know when the process has exited.
 */
export function startClaudeStreamTurn(
  prompt: string,
  options: ClaudeStreamClientOptions,
): ClaudeStreamTurn {
  const childProcessModule = window.require('child_process') as ChildProcessModule;
  const command = options.command ?? 'claude';

  const args = [
    '-p',
    '--verbose',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
  ];

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  if (options.permissionMode && options.permissionMode !== 'default') {
    args.push('--permission-mode', options.permissionMode);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.extraEnv ?? {}),
    FORCE_COLOR: '0',
  };

  let proc: ChildProcess;
  try {
    proc = childProcessModule.spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    const rejected = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    return {
      messages: (async function* () { /* empty */ })(),
      cancel: () => { /* noop */ },
      done: rejected,
    };
  }

  // Feed the prompt as a stream-json user message on stdin, then
  // close stdin so the CLI knows the input is complete.
  const userMessage = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: prompt },
  });
  proc.stdin?.write(userMessage + '\n');
  proc.stdin?.end();

  const donePromise = new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
    proc.once('error', (error) => {
      errorLog('[ClaudeStreamClient] Process error:', error);
      resolve(null);
    });
  });

  // Collect stderr for diagnostics (not surfaced to the user unless
  // the process fails).
  proc.stderr?.on('data', (chunk: Buffer) => {
    debugLog(`[ClaudeStreamClient] stderr: ${chunk.toString('utf8').trim()}`);
  });

  const messages = parseStdoutLines(proc);

  return {
    messages,
    cancel: () => {
      if (!proc.killed) proc.kill('SIGTERM');
    },
    done: donePromise,
  };
}

/**
 * Async generator that yields parsed JSON objects from the child's
 * stdout, one per newline-delimited line.
 */
async function* parseStdoutLines(proc: ChildProcess): AsyncIterable<ClaudeNativeMessage> {
  if (!proc.stdout) return;

  let buffer = '';
  const { StringDecoder } = window.require('string_decoder') as typeof import('string_decoder');
  const decoder = new StringDecoder('utf8');

  for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
    buffer += decoder.write(chunk);
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      try {
        yield JSON.parse(line) as ClaudeNativeMessage;
      } catch {
        // Malformed line — skip silently.
      }
    }
  }

  // Flush any trailing partial line.
  const remaining = (buffer + decoder.end()).trim();
  if (remaining.length > 0) {
    try {
      yield JSON.parse(remaining) as ClaudeNativeMessage;
    } catch {
      // skip
    }
  }
}
