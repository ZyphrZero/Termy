import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChangelogSection, renderReleaseBody } from './release-notes.js';

const SAMPLE_CHANGELOG = `# Changelog

## [1.3.0] - 2026-04-23

### Added
- Embedded changelog support.

## [1.2.3]

### Fixed
- Previous release.
`;

test('extractChangelogSection returns the requested version notes', () => {
  const section = extractChangelogSection(SAMPLE_CHANGELOG, '1.3.0');

  assert.equal(section, [
    '### Added',
    '- Embedded changelog support.',
  ].join('\n'));
});

test('renderReleaseBody describes the package without requiring CHANGELOG.md as an asset', () => {
  const body = renderReleaseBody({
    version: '1.3.0',
    changelogSection: '### Added\n- Embedded changelog support.',
    repository: 'ZyphrZero/Termy',
  });

  assert.match(body, /Download `termy\.zip` \(includes plugin files and all platform binaries\)/);
  assert.doesNotMatch(body, /includes all platform binaries and `CHANGELOG\.md`/);
});
