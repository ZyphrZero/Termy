import * as assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalApiHandle } from './terminalApiHandle.ts';

function createFixture() {
  let closed = false;
  let connected = true;
  let title = 'Project A';
  let focuses = 0;
  let closes = 0;
  const writes: string[] = [];
  const terminal = {
    id: 'terminal-example',
    getTitle: () => title,
    setTitle: (value: string) => { title = value; },
    write: (data: string) => { writes.push(data); },
    isAlive: () => connected,
    focus: () => { focuses += 1; },
  };
  const controls = {
    isClosed: () => closed,
    focus: () => Promise.resolve(),
    close: () => { closes += 1; closed = true; return Promise.resolve(); },
  };
  return {
    handle: createTerminalApiHandle(terminal, controls), controls, writes,
    disconnect: () => { connected = false; },
    unload: () => { closed = true; },
    getFocuses: () => focuses,
    getCloses: () => closes,
  };
}

test('terminal handle forwards titles and raw input without submitting extra commands', async () => {
  const fixture = createFixture();
  assert.equal(fixture.handle.id, 'terminal-example');
  assert.ok(Object.isFrozen(fixture.handle));
  fixture.handle.setTitle('Project B');
  assert.equal(fixture.handle.getTitle(), 'Project B');
  fixture.handle.write('echo example\r');
  assert.deepEqual(fixture.writes, ['echo example\r']);
  await fixture.handle.focus();
  assert.equal(fixture.getFocuses(), 1);
});

test('terminal handle rejects input after disconnect instead of silently losing it', () => {
  const fixture = createFixture();
  fixture.disconnect();
  assert.throws(() => fixture.handle.write('input'), /disconnected/);
  assert.deepEqual(fixture.writes, []);
});

test('terminal handle closes once even when callers close it concurrently', async () => {
  const fixture = createFixture();
  await Promise.all([fixture.handle.close(), fixture.handle.close()]);
  await fixture.handle.close();
  assert.equal(fixture.getCloses(), 1);
  assert.equal(fixture.handle.isClosed, true);
  assert.throws(() => fixture.handle.getTitle(), /closed/);
  assert.throws(() => fixture.handle.setTitle('Closed'), /closed/);
  assert.throws(() => fixture.handle.write('input'), /closed/);
  await assert.rejects(fixture.handle.focus(), /closed/);
});

test('terminal handle becomes invalid on plugin unload', async () => {
  const fixture = createFixture();
  fixture.unload();
  assert.equal(fixture.handle.isClosed, true);
  await assert.rejects(fixture.handle.focus(), /closed/);
  await fixture.handle.close();
  assert.equal(fixture.getCloses(), 0);
});

test('focus failure propagates and does not focus the terminal', async () => {
  const fixture = createFixture();
  fixture.controls.focus = () => Promise.reject(new Error('View moved away'));
  await assert.rejects(fixture.handle.focus(), /View moved away/);
  assert.equal(fixture.getFocuses(), 0);
});

test('terminal closing while being revealed prevents focus after the await', async () => {
  const fixture = createFixture();
  fixture.controls.focus = () => { fixture.unload(); return Promise.resolve(); };
  await assert.rejects(fixture.handle.focus(), /closed/);
  assert.equal(fixture.getFocuses(), 0);
});
