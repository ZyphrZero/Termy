import { Buffer } from 'buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClaudeCodeTuiEnv,
  decodeOsc52Clipboard,
  decodeTmuxPassthroughOsc52Clipboard,
  encodeClaudeCodeExtendedKey,
  XTERM_JS_VERSION,
  XTVERSION_RESPONSE,
} from './claudeCodeTuiSupport.ts';

test('buildClaudeCodeTuiEnv declares Termy as an xterm.js host for Claude Code', () => {
  const env = buildClaudeCodeTuiEnv({});

  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.TERM_PROGRAM, 'vscode');
  assert.equal(env.TERM_PROGRAM_VERSION, XTERM_JS_VERSION);
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.FORCE_HYPERLINK, '1');
  assert.equal('LC_TERMINAL' in env, false);
});

test('buildClaudeCodeTuiEnv preserves user overrides', () => {
  const env = buildClaudeCodeTuiEnv(
    {
      COLORTERM: '24bit',
      FORCE_HYPERLINK: '0',
    },
    {
      TERM: 'screen-256color',
      TERM_PROGRAM: 'custom-terminal',
      COLORTERM: 'ansi',
    },
  );

  assert.equal(env.TERM, 'screen-256color');
  assert.equal(env.TERM_PROGRAM, 'custom-terminal');
  assert.equal(env.COLORTERM, 'ansi');
  assert.equal(env.FORCE_HYPERLINK, '0');
});

test('decodeOsc52Clipboard decodes clipboard selection payloads', () => {
  const text = 'hello Claude 世界';
  const payload = Buffer.from(text, 'utf8').toString('base64');

  assert.equal(decodeOsc52Clipboard(`c;${payload}`), text);
  assert.equal(decodeOsc52Clipboard(`;${payload}`), text);
});

test('decodeOsc52Clipboard ignores unsupported selections and queries', () => {
  const payload = Buffer.from('primary selection', 'utf8').toString('base64');

  assert.equal(decodeOsc52Clipboard(`p;${payload}`), null);
  assert.equal(decodeOsc52Clipboard('c;?'), null);
  assert.equal(decodeOsc52Clipboard('c;not valid base64!'), null);
});

test('decodeTmuxPassthroughOsc52Clipboard unwraps tmux DCS passthrough', () => {
  const text = 'copied from tmux';
  const payload = Buffer.from(text, 'utf8').toString('base64');
  const osc52 = `\x1b]52;c;${payload}\x07`;
  const tmuxDcsPayload = `mux;${osc52.replaceAll('\x1b', '\x1b\x1b')}`;

  assert.equal(decodeTmuxPassthroughOsc52Clipboard(tmuxDcsPayload), text);
});

test('encodeClaudeCodeExtendedKey emits modifyOtherKeys sequences', () => {
  assert.equal(
    encodeClaudeCodeExtendedKey({
      type: 'keydown',
      key: 'C',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    }, 'modifyOtherKeys'),
    '\x1b[27;6;67~',
  );
});

test('XTVERSION_RESPONSE reports xterm.js to Claude Code', () => {
  assert.equal(XTVERSION_RESPONSE, `\x1bP>|xterm.js(${XTERM_JS_VERSION})\x1b\\`);
});
