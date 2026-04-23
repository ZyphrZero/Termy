import assert from 'node:assert/strict';
import test from 'node:test';

import { listObsidianCommandOptions } from './obsidianCommandSearch.ts';

test('listObsidianCommandOptions prefers the static command registry over listCommands()', () => {
  let listCommandsCalled = false;
  const app = {
    commands: {
      listCommands: () => {
        listCommandsCalled = true;
        throw new Error('should not be called when the command registry is present');
      },
      commands: {
        'workspace:save': {
          id: 'workspace:save',
          name: 'Save current file',
        },
        'editor:toggle-bold': {
          id: 'editor:toggle-bold',
          name: 'Toggle bold',
        },
      },
    },
  };

  const options = listObsidianCommandOptions(app as never);

  assert.equal(listCommandsCalled, false);
  assert.deepEqual(options, [
    {
      id: 'workspace:save',
      name: 'Save current file',
      searchableText: 'workspace:save save current file',
    },
    {
      id: 'editor:toggle-bold',
      name: 'Toggle bold',
      searchableText: 'editor:toggle-bold toggle bold',
    },
  ].sort((a, b) => a.name.localeCompare(b.name)));
});

test('listObsidianCommandOptions falls back to listCommands() when the registry is unavailable', () => {
  const app = {
    commands: {
      listCommands: () => [
        {
          id: 'workspace:save',
          name: 'Save current file',
        },
      ],
    },
  };

  const options = listObsidianCommandOptions(app as never);

  assert.deepEqual(options, [
    {
      id: 'workspace:save',
      name: 'Save current file',
      searchableText: 'workspace:save save current file',
    },
  ]);
});
