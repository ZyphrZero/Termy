import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_LAUNCHER_CATALOG,
  commandAvailabilityToLauncherStatus,
  getAiLauncherEntry,
  getInstallCommandForPlatform,
  partitionLaunchers,
} from './aiLauncherCatalog.ts';

interface FakeScript {
  id: string;
}

test('getAiLauncherEntry returns the catalog entry for a known id', () => {
  const entry = getAiLauncherEntry('claude-code');
  assert.ok(entry, 'expected catalog entry for claude-code');
  assert.equal(entry?.category, 'coding-agent');
  assert.equal(entry?.detectCommand, 'claude');
});

test('getAiLauncherEntry returns undefined for an unknown id', () => {
  assert.equal(getAiLauncherEntry('does-not-exist'), undefined);
});

test('partitionLaunchers groups catalog scripts and leaves regular ones in regular bucket', () => {
  const scripts: FakeScript[] = [
    { id: 'claude-code' },
    { id: 'codex' },
    { id: 'opencode' },
    { id: 'hermes' },
    { id: 'deepseek-tui' },
    { id: 'my-custom-workflow' },
  ];

  const partition = partitionLaunchers(scripts);
  assert.deepEqual(
    partition.codingAgent.map((script) => script.id),
    ['claude-code', 'codex', 'opencode', 'hermes', 'deepseek-tui'],
  );
  assert.deepEqual(partition.regular.map((script) => script.id), ['my-custom-workflow']);
});

test('partitionLaunchers preserves the original order within each bucket', () => {
  const scripts: FakeScript[] = [
    { id: 'opencode' },
    { id: 'hermes' },
    { id: 'claude-code' },
    { id: 'deepseek-tui' },
    { id: 'codex' },
  ];
  const partition = partitionLaunchers(scripts);
  assert.deepEqual(
    partition.codingAgent.map((script) => script.id),
    ['opencode', 'hermes', 'claude-code', 'deepseek-tui', 'codex'],
  );
});

test('partitionLaunchers handles an empty input gracefully', () => {
  const partition = partitionLaunchers([] as FakeScript[]);
  assert.deepEqual(partition.codingAgent, []);
  assert.deepEqual(partition.regular, []);
});

test('AI_LAUNCHER_CATALOG only contains coding agent entries today', () => {
  // Termy ships first-party coding agent launchers only. Adding a new
  // product category requires widening AiLauncherCategory and updating
  // every render site, so the explicit assertion is intentional.
  const codingAgentIds = AI_LAUNCHER_CATALOG
    .filter((entry) => entry.category === 'coding-agent')
    .map((entry) => entry.presetId)
    .sort();
  assert.deepEqual(
    codingAgentIds,
    ['claude-code', 'codex', 'deepseek-tui', 'hermes', 'opencode'],
  );
  assert.equal(AI_LAUNCHER_CATALOG.length, 5);
});

test('commandAvailabilityToLauncherStatus maps probe results to badge statuses', () => {
  assert.equal(commandAvailabilityToLauncherStatus('ready'), 'ready');
  assert.equal(commandAvailabilityToLauncherStatus('not-installed'), 'not-installed');
  // 'unknown' is treated permissively so the user is never blocked when the
  // probe could not run (e.g. inside a sandbox without spawn permissions).
  assert.equal(commandAvailabilityToLauncherStatus('unknown'), 'ready');
});


test('getInstallCommandForPlatform returns the macOS command for Claude Code', () => {
  const entry = getAiLauncherEntry('claude-code');
  assert.ok(entry);
  assert.equal(
    getInstallCommandForPlatform(entry, 'darwin'),
    'curl -fsSL https://claude.ai/install.sh | bash',
  );
});

test('getInstallCommandForPlatform returns the Windows command for Claude Code', () => {
  const entry = getAiLauncherEntry('claude-code');
  assert.ok(entry);
  assert.equal(
    getInstallCommandForPlatform(entry, 'win32'),
    'irm https://claude.ai/install.ps1 | iex',
  );
});

test('getInstallCommandForPlatform falls back to null for unsupported platforms', () => {
  const entry = getAiLauncherEntry('claude-code');
  assert.ok(entry);
  // freebsd is a valid NodeJS.Platform but no install command is documented
  // for it. Termy's modal then falls back to its docs link.
  assert.equal(getInstallCommandForPlatform(entry, 'freebsd'), null);
});

test('getInstallCommandForPlatform returns null when no install commands exist', () => {
  const fakeEntry = {
    presetId: 'fake',
    category: 'coding-agent' as const,
  };
  assert.equal(getInstallCommandForPlatform(fakeEntry, 'darwin'), null);
});

test('every catalog entry advertises an install command for the three major desktop platforms', () => {
  // The Install modal's value comes entirely from this — if a future
  // launcher entry forgets a platform we want the test suite to flag it.
  for (const entry of AI_LAUNCHER_CATALOG) {
    assert.ok(entry.installCommands, `${entry.presetId} is missing installCommands`);
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      assert.ok(
        getInstallCommandForPlatform(entry, platform),
        `${entry.presetId} is missing an install command for ${platform}`,
      );
    }
  }
});


test('every catalog entry advertises a version registry source', () => {
  // The update-check feature can only function for entries that tell us
  // where to look. If a future launcher ships without one, fail the test
  // until the author makes a deliberate decision (and updates the README
  // outbound-traffic section accordingly).
  for (const entry of AI_LAUNCHER_CATALOG) {
    assert.ok(
      entry.versionRegistry,
      `${entry.presetId} is missing versionRegistry`,
    );
  }
});

test('version registry sources match the documented endpoints', () => {
  // Canary test against the README/AGENTS.md outbound-traffic disclosure.
  // If a future entry adds a new endpoint shape, we want this test to
  // force a deliberate documentation update.
  const expected = new Map([
    ['claude-code', 'npm:@anthropic-ai/claude-code'],
    ['codex', 'npm:@openai/codex'],
    ['opencode', 'github-release:anomalyco/opencode'],
    ['hermes', 'github-release:NousResearch/hermes-agent'],
    ['deepseek-tui', 'npm:deepseek-tui'],
  ]);
  for (const entry of AI_LAUNCHER_CATALOG) {
    const registry = entry.versionRegistry;
    assert.ok(registry, `${entry.presetId} missing registry`);
    const key = registry.kind === 'npm'
      ? `npm:${registry.package}`
      : `github-release:${registry.repo}`;
    assert.equal(key, expected.get(entry.presetId));
  }
});

test('npm-backed launchers declare the package Termy can prepare through fnm', () => {
  const expected = new Map([
    ['codex', '@openai/codex'],
    ['opencode', 'opencode-ai'],
    ['deepseek-tui', 'deepseek-tui'],
  ]);

  for (const [presetId, packageName] of expected) {
    const entry = getAiLauncherEntry(presetId);
    assert.ok(entry, `${presetId} missing catalog entry`);
    assert.equal(entry.npmPackage, packageName);
  }

  const claude = getAiLauncherEntry('claude-code');
  assert.ok(claude);
  assert.equal(claude.npmPackage, undefined);

  // Hermes ships through a Python/PyPI installer, not npm — no package
  // means Termy will not offer the fnm-backed preparation flow for it.
  const hermes = getAiLauncherEntry('hermes');
  assert.ok(hermes);
  assert.equal(hermes.npmPackage, undefined);
});
