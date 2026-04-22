export function escapeChangelogRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeChangelogSection(section: string): string {
  return section
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');
}

type ChangelogSectionMatch = {
  heading: string;
  markdown: string;
};

export type ChangelogSectionResolution = {
  requestedVersion: string;
  resolvedVersion: string;
  markdown: string;
  exactMatch: boolean;
};

function getChangelogLines(changelogContent: string): string[] {
  return changelogContent.split(/\r?\n/);
}

function extractSectionAfterHeading(lines: string[], headingIndex: number): string {
  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^## \[/.test(lines[index]) || /^---\s*$/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return normalizeChangelogSection(lines.slice(headingIndex + 1, endIndex).join('\n'));
}

function findVersionSection(changelogContent: string, version: string): ChangelogSectionMatch | null {
  const normalizedVersion = String(version || '').trim();
  if (!normalizedVersion) {
    return null;
  }

  const lines = getChangelogLines(changelogContent);
  const headingPattern = new RegExp(`^## \\[${escapeChangelogRegExp(normalizedVersion)}\\](?:\\s*-\\s*.+)?\\s*$`);
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) {
    return null;
  }

  const markdown = extractSectionAfterHeading(lines, startIndex);
  if (!markdown) {
    throw new Error(`CHANGELOG section for version ${normalizedVersion} is empty`);
  }

  return {
    heading: normalizedVersion,
    markdown,
  };
}

function findUnreleasedSection(changelogContent: string): ChangelogSectionMatch | null {
  const lines = getChangelogLines(changelogContent);
  const startIndex = lines.findIndex((line) => /^## \[Unreleased\]\s*$/i.test(line));
  if (startIndex === -1) {
    return null;
  }

  const markdown = extractSectionAfterHeading(lines, startIndex);
  if (!markdown) {
    return null;
  }

  return {
    heading: 'Unreleased',
    markdown,
  };
}

function findLatestReleasedSection(changelogContent: string): ChangelogSectionMatch | null {
  const lines = getChangelogLines(changelogContent);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^## \[([^\]]+)\](?:\s*-.*)?$/);
    if (!match) {
      continue;
    }

    const heading = match[1].trim();
    if (!heading || heading.toLowerCase() === 'unreleased') {
      continue;
    }

    const markdown = extractSectionAfterHeading(lines, index);
    if (!markdown) {
      continue;
    }

    return {
      heading,
      markdown,
    };
  }

  return null;
}

export function extractChangelogSection(changelogContent: string, version: string): string {
  const normalizedVersion = String(version || '').trim();
  if (!normalizedVersion) {
    throw new Error('Version is required to extract changelog notes');
  }

  const match = findVersionSection(changelogContent, normalizedVersion);
  if (!match) {
    throw new Error(`Could not find CHANGELOG section for version ${normalizedVersion}`);
  }

  return match.markdown;
}

export function resolveChangelogSection(
  changelogContent: string,
  version: string
): ChangelogSectionResolution {
  const normalizedVersion = String(version || '').trim();
  if (!normalizedVersion) {
    throw new Error('Version is required to resolve changelog notes');
  }

  const exactMatch = findVersionSection(changelogContent, normalizedVersion);
  if (exactMatch) {
    return {
      requestedVersion: normalizedVersion,
      resolvedVersion: exactMatch.heading,
      markdown: exactMatch.markdown,
      exactMatch: true,
    };
  }

  const unreleasedMatch = findUnreleasedSection(changelogContent);
  if (unreleasedMatch) {
    return {
      requestedVersion: normalizedVersion,
      resolvedVersion: unreleasedMatch.heading,
      markdown: unreleasedMatch.markdown,
      exactMatch: false,
    };
  }

  const latestMatch = findLatestReleasedSection(changelogContent);
  if (latestMatch) {
    return {
      requestedVersion: normalizedVersion,
      resolvedVersion: latestMatch.heading,
      markdown: latestMatch.markdown,
      exactMatch: false,
    };
  }

  throw new Error('Could not find any usable CHANGELOG section');
}
