import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChangelogSection, resolveChangelogSection } from './changelog.ts';

const SAMPLE_CHANGELOG = `# Changelog

## [Unreleased]

### Changed
- Pending fix before release.

## [1.3.0]

### Added
- Added new changelog modal.

### Fixed
- Fixed first-open display.

## [1.2.3] - 2026-02-26

### Changed
- Previous release.

---
`;

test('extractChangelogSection returns the matching version body', () => {
  const section = extractChangelogSection(SAMPLE_CHANGELOG, '1.3.0');

  assert.equal(section, [
    '### Added',
    '- Added new changelog modal.',
    '',
    '### Fixed',
    '- Fixed first-open display.',
  ].join('\n'));
});

test('extractChangelogSection accepts dated headings', () => {
  const section = extractChangelogSection(SAMPLE_CHANGELOG, '1.2.3');
  assert.match(section, /### Changed/);
});

test('extractChangelogSection throws when version is missing', () => {
  assert.throws(
    () => extractChangelogSection(SAMPLE_CHANGELOG, '9.9.9'),
    /Could not find CHANGELOG section/,
  );
});

test('resolveChangelogSection prefers exact matches', () => {
  const resolved = resolveChangelogSection(SAMPLE_CHANGELOG, '1.3.0');

  assert.equal(resolved.resolvedVersion, '1.3.0');
  assert.equal(resolved.exactMatch, true);
});

test('resolveChangelogSection falls back to Unreleased when exact version is missing', () => {
  const resolved = resolveChangelogSection(SAMPLE_CHANGELOG, '1.2.4');

  assert.equal(resolved.requestedVersion, '1.2.4');
  assert.equal(resolved.resolvedVersion, 'Unreleased');
  assert.equal(resolved.exactMatch, false);
  assert.match(resolved.markdown, /Pending fix before release/);
});

test('resolveChangelogSection falls back to latest release when Unreleased is absent', () => {
  const changelogWithoutUnreleased = `# Changelog

## [1.3.0]

### Added
- Added new changelog modal.

## [1.2.3] - 2026-02-26

### Changed
- Previous release.

---
`;
  const resolved = resolveChangelogSection(changelogWithoutUnreleased, '1.2.4');

  assert.equal(resolved.resolvedVersion, '1.3.0');
  assert.equal(resolved.exactMatch, false);
});
