import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { discoverCommandInstallations, normalizeInstallationPath } from './commandInstallationDiscovery.ts';
import { clearCommandVersionCache, probeCommandVersion } from './commandVersionProbe.ts';
import { getPathEnvKey } from './envHelpers.ts';
import { runProbeCommand } from './childProcessUtils.ts';
import { buildAiLauncherStatusSnapshot } from './aiLauncherStatus.ts';

// Use real filesystem and child processes through the same boundary Obsidian provides.
globalThis.window = {
  require: createRequire(import.meta.url),
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
} as unknown as Window & typeof globalThis;

const command = 'termy-test-agent';

async function fixture(context: { after: (callback: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'termy-agent-installations-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const first = path.join(root, 'first installation');
  const second = path.join(root, 'second installation');
  await Promise.all([mkdir(first), mkdir(second)]);
  return { root, first, second };
}

async function writeAgent(directory: string, version: string, exitCode = 0): Promise<string> {
  const executable = path.join(directory, process.platform === 'win32' ? `${command}.cmd` : command);
  const contents = process.platform === 'win32'
    ? `@echo off\r\necho test-agent ${version}\r\nexit /b ${exitCode}\r\n`
    : `#!/bin/sh\nprintf 'test-agent ${version}\\n'\nexit ${exitCode}\n`;
  await writeFile(executable, contents, { mode: 0o755 });
  return executable;
}

function envWithPath(directories: string[]): Record<string, string | undefined> {
  const env = { ...process.env };
  const pathKey = getPathEnvKey(env);
  env[pathKey] = [...directories, env[pathKey] ?? ''].join(path.delimiter);
  return env;
}

test('discovery preserves PATH precedence and probes each installed version by its full path', async (context) => {
  const { first, second } = await fixture(context);
  const firstPath = await writeAgent(first, '1.0.0');
  const secondPath = await writeAgent(second, '2.0.0');
  const result = await probeCommandVersion(command, { env: envWithPath([first, second]), commonDirectories: [] });

  assert.equal(result.version, '1.0.0');
  assert.equal(result.resolvedFrom, firstPath);
  assert.deepEqual(result.installations.map((item) => [item.path, item.version, item.isDefault]), [
    [firstPath, '1.0.0', true], [secondPath, '2.0.0', false],
  ]);
  assert.deepEqual(result.discoveryErrors, []);
});

test('common-location installations outside PATH do not become the default executable', async (context) => {
  const { first, second } = await fixture(context);
  await writeAgent(second, '2.0.0');
  const result = await probeCommandVersion(command, { env: envWithPath([first]), commonDirectories: [second] });

  assert.equal(result.version, null);
  assert.equal(result.resolvedFrom, null);
  assert.equal(result.installations[0].version, '2.0.0');
  assert.equal(result.installations[0].onPath, false);
  assert.equal(result.installations[0].isDefault, false);
});

test('symlink aliases and repeated PATH entries count as one installation', async (context) => {
  const { root, first } = await fixture(context);
  await writeAgent(first, '1.0.0');
  const alias = path.join(root, 'alias');
  await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await discoverCommandInstallations(command, { env: envWithPath([alias, first, alias]), commonDirectories: [first] });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].isDefault, true);
  assert.deepEqual(result.errors, []);
});

test('changing PATH order invalidates the cached default version', async (context) => {
  const { first, second } = await fixture(context);
  await writeAgent(first, '1.0.0');
  await writeAgent(second, '2.0.0');
  const firstResult = await probeCommandVersion(command, { env: envWithPath([first, second]), commonDirectories: [] });
  const secondResult = await probeCommandVersion(command, { env: envWithPath([second, first]), commonDirectories: [] });
  assert.equal(firstResult.version, '1.0.0');
  assert.equal(secondResult.version, '2.0.0');
});

test('explicit refresh detects an in-place upgrade before the version cache expires', async (context) => {
  const { first } = await fixture(context);
  const executable = await writeAgent(first, '1.0.0');
  const options = { env: envWithPath([first]), commonDirectories: [] };
  const beforeUpgrade = await probeCommandVersion(command, options);
  assert.equal(beforeUpgrade.version, '1.0.0');

  await writeAgent(first, '2.0.0');
  const cached = await probeCommandVersion(command, options);
  assert.equal(cached.version, '1.0.0');

  clearCommandVersionCache(command);
  const refreshed = await probeCommandVersion(command, options);
  assert.equal(refreshed.resolvedFrom, executable);
  assert.equal(refreshed.version, '2.0.0');
  assert.equal(refreshed.installations[0].version, '2.0.0');
});

test('dsh-tui probes compare the executed profile version with the registry version', async (context) => {
  const { first } = await fixture(context);
  const executable = path.join(first, process.platform === 'win32' ? 'dsh-tui.cmd' : 'dsh-tui');
  const contents = process.platform === 'win32'
    ? '@echo off\r\necho @deepseek-harness-tui/dsh-tui 0.10.2 (launcher)\r\necho profile: 0.14.0  /example/profiles/dsh-tui\r\n'
    : '#!/bin/sh\nprintf "@deepseek-harness-tui/dsh-tui 0.10.2 (launcher)\\nprofile: 0.14.0  /example/profiles/dsh-tui\\n"\n';
  await writeFile(executable, contents, { mode: 0o755 });
  context.after(() => clearCommandVersionCache('dsh-tui'));
  const local = await probeCommandVersion('dsh-tui', { env: envWithPath([first]), commonDirectories: [] });
  assert.equal(local.resolvedFrom, executable);
  assert.equal(local.version, '0.14.0');
  assert.equal(local.installations[0].version, '0.14.0');
  const snapshot = buildAiLauncherStatusSnapshot({ pathAvailable: 'ready', local, latest: { version: '0.14.0' } });
  assert.equal(snapshot.readiness, 'ready');
});

test('relative PATH entries are resolved against the discovery working directory', async (context) => {
  const { root, first } = await fixture(context);
  const executable = await writeAgent(first, '1.0.0');
  const env = envWithPath([path.relative(root, first)]);
  const result = await probeCommandVersion(command, { env, cwd: root, commonDirectories: [] });
  assert.equal(result.resolvedFrom, executable);
  assert.equal(result.version, '1.0.0');
});

test('failed version probes remain visible and cannot supply a successful version', async (context) => {
  const { first } = await fixture(context);
  await writeAgent(first, '2.0.0', 1);
  const result = await probeCommandVersion(command, { env: envWithPath([first]), commonDirectories: [] });
  assert.equal(result.version, null);
  assert.equal(result.installations.length, 1);
  assert.match(result.installations[0].error ?? '', /exited with code 1/);
  assert.match(result.rawOutput ?? '', /test-agent 2.0.0/);
});

test('installation paths with spaces, Unicode, and shell metacharacters stay literal', async (context) => {
  const { root } = await fixture(context);
  const directory = path.join(root, '路径示例 & %PATH% !');
  await mkdir(directory);
  const executable = await writeAgent(directory, '3.0.0');
  const result = await probeCommandVersion(command, { env: envWithPath([directory]), commonDirectories: [] });
  assert.equal(result.version, '3.0.0');
  assert.equal(result.resolvedFrom, executable);
});

test('Windows npm PowerShell shims do not create an extra installation', { skip: process.platform !== 'win32' }, async (context) => {
  const { first } = await fixture(context);
  await writeAgent(first, '1.0.0');
  await writeFile(path.join(first, `${command}.ps1`), 'Write-Output "test-agent 1.0.0"');
  const executable = path.join(first, `${command}.exe`);
  await copyFile(process.execPath, executable);
  const result = await probeCommandVersion(command, { env: envWithPath([first]), commonDirectories: [] });
  assert.equal(result.installations.length, 2);
  assert.equal(result.resolvedFrom, executable);
  assert.equal(result.version, process.versions.node);
});

test('bare Windows batch commands preserve their own directory when resolved through PATH', { skip: process.platform !== 'win32' }, async (context) => {
  const { first } = await fixture(context);
  const executable = await writeAgent(first, '1.0.0');
  await writeFile(executable, '@echo off\r\necho %~dp0\r\nexit /b 0\r\n');
  const result = await runProbeCommand({ command, args: ['--version'], env: envWithPath([first]) });
  assert.equal(result?.code, 0);
  assert.equal(result.stdout.trim(), `${first}${path.sep}`);
});

test('Windows path identity is case-insensitive without changing POSIX identity', () => {
  assert.equal(normalizeInstallationPath('C:/Tools/Agent.CMD', 'win32'), normalizeInstallationPath('c:\\tools\\agent.cmd', 'win32'));
  assert.notEqual(normalizeInstallationPath('/opt/Tools/agent', 'linux'), normalizeInstallationPath('/opt/tools/agent', 'linux'));
});

test.after(() => clearCommandVersionCache());
