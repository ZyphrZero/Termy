import { Buffer } from 'buffer';

type EnvLike = Record<string, string | undefined>;

export const XTERM_JS_VERSION = '6.0.0';
export const XTVERSION_RESPONSE = `\x1bP>|xterm.js(${XTERM_JS_VERSION})\x1b\\`;
export type ClaudeCodeExtendedKeyboardMode = 'none' | 'modifyOtherKeys';

/**
 * Claude Code has a first-class xterm.js path keyed by TERM_PROGRAM=vscode.
 * Termy embeds xterm.js directly, so declare that capability through the
 * terminal session environment instead of inheriting Obsidian's host shell.
 */
export function buildClaudeCodeTuiEnv(
  parentEnv: EnvLike = process.env,
  userEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: parentEnv.COLORTERM || 'truecolor',
    FORCE_HYPERLINK: parentEnv.FORCE_HYPERLINK || '1',
    TERM_PROGRAM: 'vscode',
    TERM_PROGRAM_VERSION: XTERM_JS_VERSION,
  };

  return {
    ...env,
    ...userEnv,
  };
}

export function decodeOsc52Clipboard(data: string): string | null {
  const separatorIndex = data.indexOf(';');
  if (separatorIndex === -1) {
    return null;
  }

  const selection = data.slice(0, separatorIndex);
  const payload = data.slice(separatorIndex + 1);
  if (payload === '?' || (selection !== '' && !selection.includes('c'))) {
    return null;
  }

  if (!isBase64Payload(payload)) {
    return null;
  }

  try {
    return Buffer.from(payload, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function decodeTmuxPassthroughOsc52Clipboard(data: string): string | null {
  const passthrough = decodeTmuxPassthrough(data);
  if (passthrough === null) {
    return null;
  }

  const osc52 = extractOscPayload(passthrough, 52);
  if (osc52 === null) {
    return null;
  }

  return decodeOsc52Clipboard(osc52);
}

function decodeTmuxPassthrough(data: string): string | null {
  if (!data.startsWith('mux;')) {
    return null;
  }

  return data.slice('mux;'.length).replaceAll('\x1b\x1b', '\x1b');
}

function extractOscPayload(data: string, command: number): string | null {
  const oscStart = data.indexOf(`\x1b]${command};`);
  if (oscStart === -1) {
    return null;
  }

  const oscPayloadStart = oscStart + `\x1b]${command};`.length;
  const bellEnd = data.indexOf('\x07', oscPayloadStart);
  const stEnd = data.indexOf('\x1b\\', oscPayloadStart);
  const endCandidates = [bellEnd, stEnd].filter((index) => index >= 0);
  if (endCandidates.length === 0) {
    return null;
  }

  const oscEnd = Math.min(...endCandidates);
  return data.slice(oscPayloadStart, oscEnd);
}

export interface ExtendedKeyboardEventLike {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export function encodeClaudeCodeExtendedKey(
  event: ExtendedKeyboardEventLike,
  mode: ClaudeCodeExtendedKeyboardMode,
): string | null {
  if (mode !== 'modifyOtherKeys' || event.type !== 'keydown') {
    return null;
  }

  const keyCode = getExtendedKeyCode(event);
  if (keyCode === null || !shouldEncodeExtendedKey(event)) {
    return null;
  }

  return `\x1b[27;${encodeModifier(event)};${keyCode}~`;
}

function shouldEncodeExtendedKey(event: ExtendedKeyboardEventLike): boolean {
  if (event.key === 'Enter') {
    return event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
  }

  if (event.key === 'Tab' || event.key === 'Escape' || event.key === 'Backspace') {
    return event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
  }

  return event.key.length === 1 && (event.ctrlKey || event.altKey || event.metaKey);
}

function getExtendedKeyCode(event: ExtendedKeyboardEventLike): number | null {
  switch (event.key) {
    case 'Enter':
      return 13;
    case 'Tab':
      return 9;
    case 'Escape':
      return 27;
    case 'Backspace':
      return 127;
    case ' ':
    case 'Spacebar':
      return 32;
    default:
      if (event.key.length !== 1) {
        return null;
      }

      return event.key.codePointAt(0) ?? null;
  }
}

function encodeModifier(event: ExtendedKeyboardEventLike): number {
  return 1
    + (event.shiftKey ? 1 : 0)
    + (event.altKey ? 2 : 0)
    + (event.ctrlKey ? 4 : 0)
    + (event.metaKey ? 8 : 0);
}

function isBase64Payload(payload: string): boolean {
  if (payload.length === 0) {
    return true;
  }

  if (payload.length % 4 === 1) {
    return false;
  }

  return /^[A-Za-z0-9+/]*={0,2}$/.test(payload);
}
