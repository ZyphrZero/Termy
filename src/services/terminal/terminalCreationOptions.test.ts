import * as assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateTerminalOptions } from '../../api.ts';
import { createTerminalLaunchRequest, snapshotTerminalCreationOptions } from './terminalCreationOptions.ts';

const defaults = { shellType: 'custom:/bin/example-shell', shellArgs: ['--login'], cwd: '/example-vault' };

test('public options map to an empty launch spec when defaults should be used', () => {
  assert.deepEqual(createTerminalLaunchRequest({}), { launchSpec: {}, focus: undefined });
});

test('a custom executable receives literal argv and no global shell arguments', () => {
  assert.deepEqual(createTerminalLaunchRequest({ executable: 'tmux' }), {
    launchSpec: { shellType: 'custom:tmux', shellArgs: [] }, focus: undefined,
  });
  const options = snapshotTerminalCreationOptions({
    executable: 'C:\\Program Files\\Example\\session.exe',
    args: ['attach', '项目 A', '', '$(example); & literal'],
    cwd: 'C:\\example-vault\\project-a',
    title: 'Project A',
  });
  assert.deepEqual(createTerminalLaunchRequest(options), {
    launchSpec: {
      shellType: 'custom:C:\\Program Files\\Example\\session.exe',
      shellArgs: ['attach', '项目 A', '', '$(example); & literal'],
      cwd: 'C:\\example-vault\\project-a',
      title: 'Project A',
    },
    focus: undefined,
  });
});

test('explicit empty argv clears configured shell arguments without changing settings', () => {
  assert.deepEqual(createTerminalLaunchRequest({ args: [] }), {
    launchSpec: { shellArgs: [] }, focus: undefined,
  });
  assert.deepEqual(defaults.shellArgs, ['--login']);
});

test('caller mutations do not affect a queued terminal launch', () => {
  const options = { executable: 'tmux', args: ['attach', '-t', 'project-a'], title: 'Project A' };
  const snapshot = snapshotTerminalCreationOptions(options);
  options.args[2] = 'project-b';
  options.title = 'Project B';
  assert.deepEqual(snapshot.args, ['attach', '-t', 'project-a']);
  assert.equal(snapshot.title, 'Project A');
});

test('terminal creation rejects malformed options before launching a process', () => {
  for (const options of [
    null, [], { executable: '' }, { executable: '  ' }, { executable: 'tmux\0' },
    { cwd: '' }, { title: '\0' }, { args: 'attach' }, { args: [2] },
    { args: ['one\0two'] }, { focus: 'false' },
  ]) {
    assert.throws(() => snapshotTerminalCreationOptions(options as unknown as CreateTerminalOptions), TypeError);
  }
  assert.equal(snapshotTerminalCreationOptions({ focus: false }).focus, false);
});
