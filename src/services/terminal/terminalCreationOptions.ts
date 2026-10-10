import type { CreateTerminalOptions } from '../../api';
import type { TerminalLaunchSpec } from './terminalTypes';

function validateString(value: unknown, name: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.includes('\0') || (!allowEmpty && !value.trim())) {
    throw new TypeError(`${name} must be ${allowEmpty ? 'a' : 'a non-empty'} string without NUL characters`);
  }
}

function validateArgs(value: unknown): void {
  if (!Array.isArray(value)) throw new TypeError('args must be an array of strings');
  for (const arg of value) validateString(arg, 'args entries', true);
}

/** Validate and copy before any await, so caller mutations cannot change a queued launch. */
export function snapshotTerminalCreationOptions(options: CreateTerminalOptions): CreateTerminalOptions {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Terminal options must be an object');
  }
  for (const key of ['executable', 'cwd', 'title'] as const) {
    if (options[key] !== undefined) validateString(options[key], key);
  }
  if (options.args !== undefined) {
    validateArgs(options.args);
  }
  if (options.focus !== undefined && typeof options.focus !== 'boolean') {
    throw new TypeError('focus must be a boolean');
  }
  return {
    executable: options.executable,
    args: options.args === undefined ? undefined : [...options.args],
    cwd: options.cwd,
    title: options.title,
    focus: options.focus,
  };
}

export function createTerminalLaunchRequest(options: CreateTerminalOptions): {
  launchSpec: TerminalLaunchSpec;
  focus?: boolean;
} {
  const request = snapshotTerminalCreationOptions(options);
  const launchSpec: TerminalLaunchSpec = {};
  if (request.executable !== undefined) launchSpec.shellType = `custom:${request.executable}`;
  if (request.args !== undefined || request.executable !== undefined) {
    launchSpec.shellArgs = request.args === undefined ? [] : [...request.args];
  }
  if (request.cwd !== undefined) launchSpec.cwd = request.cwd;
  if (request.title !== undefined) launchSpec.title = request.title;
  return { launchSpec, focus: request.focus };
}
