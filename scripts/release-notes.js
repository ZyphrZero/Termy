/**
 * Release Notes Helper
 *
 * Usage:
 *   node scripts/release-notes.js --version 1.3.0
 *   node scripts/release-notes.js --version 1.3.0 --repository ZyphrZero/Termy --output release-body.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');
const DEFAULT_REPOSITORY = 'ZyphrZero/Termy';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeExtractedSection(section) {
  return section
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');
}

export function extractChangelogSection(changelogContent, version) {
  const normalizedVersion = String(version || '').trim();
  if (!normalizedVersion) {
    throw new Error('Version is required to extract changelog notes');
  }

  const lines = changelogContent.split(/\r?\n/);
  const headingPattern = new RegExp(`^## \\[${escapeRegExp(normalizedVersion)}\\](?:\\s*-\\s*.+)?\\s*$`);
  const startIndex = lines.findIndex((line) => headingPattern.test(line));

  if (startIndex === -1) {
    throw new Error(`Could not find CHANGELOG section for version ${normalizedVersion}`);
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^## \[/.test(lines[index]) || /^---\s*$/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  const section = normalizeExtractedSection(lines.slice(startIndex + 1, endIndex).join('\n'));
  if (!section) {
    throw new Error(`CHANGELOG section for version ${normalizedVersion} is empty`);
  }

  return section;
}

export function readChangelogSection(version, changelogPath = DEFAULT_CHANGELOG_PATH) {
  const changelogContent = fs.readFileSync(changelogPath, 'utf8');
  return extractChangelogSection(changelogContent, version);
}

export function renderReleaseBody({ version, changelogSection, repository = DEFAULT_REPOSITORY }) {
  const repoUrl = `https://github.com/${repository}`;

  return [
    `## Changelog`,
    '',
    changelogSection,
    '',
    '## Installation',
    '',
    '### BRAT (Recommended)',
    `1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin`,
    `2. Add this repository: \`${repository}\``,
    '3. BRAT will automatically download the correct binary for your platform',
    '',
    '### Manual Installation',
    '',
    '**Option 1: Complete Package (All Platforms)**',
    '1. Download `termy.zip` (includes plugin files and all platform binaries)',
    '2. Extract to `.obsidian/plugins/` directory',
    '3. Restart Obsidian and enable the plugin',
    '',
    '**Option 2: Platform-Specific (Smaller Download)**',
    '1. Download the three core files: `main.js`, `manifest.json`, `styles.css`',
    '2. Download the binary for your platform:',
    '   - **Windows**: `termy-server-win32-x64.exe`',
    '   - **macOS (Apple Silicon)**: `termy-server-darwin-arm64`',
    '   - **macOS (Intel)**: `termy-server-darwin-x64`',
    '   - **Linux (x64)**: `termy-server-linux-x64`',
    '   - **Linux (ARM64)**: `termy-server-linux-arm64`',
    '3. Create directory: `.obsidian/plugins/termy/binaries/`',
    '4. Place core files in `termy/` and binary in `binaries/`',
    '5. Restart Obsidian and enable the plugin',
    '',
    '## Full Changelog',
    '',
    `See [CHANGELOG.md](${repoUrl}/blob/master/CHANGELOG.md) for the complete history.`,
    '',
    '## Support',
    '',
    `- [Report Issues](${repoUrl}/issues)`,
    '- [Telegram Group](https://t.me/+t6oRqhaw8c1jNzE1)',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    changelogPath: DEFAULT_CHANGELOG_PATH,
    repository: DEFAULT_REPOSITORY,
    output: '',
    version: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    if (arg === '--version' && nextValue) {
      options.version = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--repository' && nextValue) {
      options.repository = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--changelog' && nextValue) {
      options.changelogPath = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--output' && nextValue) {
      options.output = nextValue;
      index += 1;
      continue;
    }
  }

  if (!options.version) {
    throw new Error('Missing required --version argument');
  }

  return options;
}

function isDirectInvocation() {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  return path.resolve(entryPath) === path.resolve(__filename);
}

if (isDirectInvocation()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const changelogSection = readChangelogSection(options.version, options.changelogPath);
    const body = renderReleaseBody({
      version: options.version,
      changelogSection,
      repository: options.repository,
    });

    if (options.output) {
      fs.writeFileSync(options.output, `${body}\n`, 'utf8');
      console.log(`Wrote release notes to ${options.output}`);
    } else {
      process.stdout.write(`${body}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to render release notes: ${message}`);
    process.exit(1);
  }
}
