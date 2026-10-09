import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDshTuiBridgeTerminalEnv,
  buildDshTuiHelloAck,
  buildDshTuiSelectionChanged,
  DSH_TUI_IDE_HELLO_ACK_METHOD,
  DSH_TUI_IDE_PORT_ENV,
  DSH_TUI_IDE_PROTOCOL_VERSION,
  DSH_TUI_IDE_TOKEN_ENV,
  DSH_TUI_SELECTION_METHOD,
  getDshTuiSelectionLineRange,
  normalizeDshTuiPath,
  parseDshTuiHello,
  sameDshTuiSelection,
  workspaceContainsPath,
  type DshTuiSelectionSnapshot,
} from './dshTuiBridgeProtocol.ts';

test('dsh-TUI terminal environment exposes the v2 direct-connect pair', () => {
  assert.deepEqual(buildDshTuiBridgeTerminalEnv(null, null), {});
  assert.deepEqual(buildDshTuiBridgeTerminalEnv(4312, 'token'), {
    [DSH_TUI_IDE_PORT_ENV]: '4312',
    [DSH_TUI_IDE_TOKEN_ENV]: 'token',
  });
});

test('dsh-TUI hello accepts only protocol v2 and a non-empty token', () => {
  assert.deepEqual(parseDshTuiHello({
    method: 'ide/hello',
    params: { token: 'abc', protocolVersion: DSH_TUI_IDE_PROTOCOL_VERSION },
  }), { token: 'abc', protocolVersion: 2 });
  assert.equal(parseDshTuiHello({
    method: 'ide/hello',
    params: { token: 'abc', protocolVersion: 1 },
  }), undefined);
  assert.equal(parseDshTuiHello({
    method: 'ide/hello',
    params: { token: '', protocolVersion: 2 },
  }), undefined);
});

test('dsh-TUI acknowledgement and selection frames match the upstream envelope', () => {
  const ack = JSON.parse(buildDshTuiHelloAck(['/vault'])) as {
    method: string;
    params: { protocolVersion: number; workspaceFolders: string[] };
  };
  assert.equal(ack.method, DSH_TUI_IDE_HELLO_ACK_METHOD);
  assert.deepEqual(ack.params, { protocolVersion: 2, workspaceFolders: ['/vault'] });

  const snapshot: DshTuiSelectionSnapshot = {
    path: '/vault/notes/demo.md',
    startLine: 2,
    endLine: 4,
    isEmpty: false,
    text: 'selected',
  };
  const selection = JSON.parse(buildDshTuiSelectionChanged(snapshot)) as {
    method: string;
    params: DshTuiSelectionSnapshot;
  };
  assert.equal(selection.method, DSH_TUI_SELECTION_METHOD);
  assert.deepEqual(selection.params, snapshot);
});

test('workspace matching uses a path boundary and is case insensitive', () => {
  assert.equal(workspaceContainsPath('/vault/project', '/vault/project/notes/demo.md'), true);
  assert.equal(workspaceContainsPath('/vault/project', '/vault/project-copy/demo.md'), false);
  assert.equal(workspaceContainsPath('C:\\Vault', 'c:\\vault\\Notes\\demo.md', true), true);
});

test('selection paths normalize to the upstream slash form', () => {
  assert.equal(normalizeDshTuiPath('C:\\Vault\\Notes\\demo.md'), 'C:/Vault/Notes/demo.md');
  assert.equal(normalizeDshTuiPath('/vault/notes/demo.md/'), '/vault/notes/demo.md');
});

test('selection line ranges use inclusive end lines', () => {
  assert.deepEqual(getDshTuiSelectionLineRange(2, 5, 0), { startLine: 2, endLine: 4 });
  assert.deepEqual(getDshTuiSelectionLineRange(2, 5, 1), { startLine: 2, endLine: 5 });
  assert.deepEqual(getDshTuiSelectionLineRange(2, 2, 0), { startLine: 2, endLine: 2 });
});

test('sameDshTuiSelection detects text changes even when coordinates stay fixed', () => {
  const first: DshTuiSelectionSnapshot = {
    path: '/vault/demo.md',
    startLine: 1,
    endLine: 1,
    isEmpty: false,
    text: 'old',
  };
  assert.equal(sameDshTuiSelection(first, { ...first }), true);
  assert.equal(sameDshTuiSelection(first, { ...first, text: 'new' }), false);
  assert.equal(sameDshTuiSelection(first, { ...first, isEmpty: true, text: '' }), false);
});
