/**
 * Upload Termy binary artifacts to Cloudflare R2 with Wrangler CLI.
 *
 * Usage:
 *   node scripts/upload-r2-assets.js
 *   node scripts/upload-r2-assets.js --version 1.3.0 --bucket termy-binaries-apac
 *   node scripts/upload-r2-assets.js --dir binaries --config wrangler.jsonc
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_BUCKET = 'termy-binaries-apac';
const DEFAULT_BINARIES_DIR = path.join(ROOT_DIR, 'binaries');
const DEFAULT_WRANGLER_CONFIG = path.join(ROOT_DIR, 'wrangler.jsonc');
const DEFAULT_WRANGLER_PACKAGE = 'wrangler@4';
const MINIMUM_NODE_MAJOR = 20;

function parseArgs(argv) {
  const options = {
    bucket: DEFAULT_BUCKET,
    config: fs.existsSync(DEFAULT_WRANGLER_CONFIG) ? DEFAULT_WRANGLER_CONFIG : '',
    dir: DEFAULT_BINARIES_DIR,
    version: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    if (arg === '--bucket' && nextValue) {
      options.bucket = nextValue.trim();
      index += 1;
      continue;
    }

    if (arg === '--config' && nextValue) {
      options.config = nextValue.trim();
      index += 1;
      continue;
    }

    if (arg === '--dir' && nextValue) {
      options.dir = nextValue.trim();
      index += 1;
      continue;
    }

    if (arg === '--version' && nextValue) {
      options.version = nextValue.trim();
      index += 1;
      continue;
    }
  }

  return options;
}

export function parseNodeMajorVersion(nodeVersion = process.versions.node) {
  const [majorSegment] = String(nodeVersion).split('.');
  const major = Number.parseInt(majorSegment, 10);
  return Number.isFinite(major) ? major : null;
}

export function assertSupportedNodeVersion(nodeVersion = process.versions.node) {
  const major = parseNodeMajorVersion(nodeVersion);
  if (major !== null && major >= MINIMUM_NODE_MAJOR) {
    return;
  }

  throw new Error(
    `upload-r2-assets requires Node.js v${MINIMUM_NODE_MAJOR}+ because Wrangler no longer supports ${nodeVersion}. ` +
    'Update the runtime or CI setup-node version before uploading to Cloudflare R2.'
  );
}

function getCurrentVersion() {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return String(manifest.version || '').trim();
}

function listArtifacts(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Binary directory not found: ${dirPath}`);
  }

  return fs.readdirSync(dirPath)
    .filter((name) => name.startsWith('termy-server-'))
    .map((name) => path.join(dirPath, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((a, b) => a.localeCompare(b));
}

function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function escapeWindowsArg(arg) {
  const normalized = String(arg);
  if (!/\s/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '""')}"`;
}

function spawnPnpm(args) {
  if (process.platform === 'win32') {
    const commandLine = `${getPnpmCommand()} ${args.map(escapeWindowsArg).join(' ')}`;
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    });
  }

  return spawnSync(getPnpmCommand(), args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });
}

function uploadObject({ bucket, config, filePath, version }) {
  const fileName = path.basename(filePath);
  const objectPath = `${bucket}/${version}/${fileName}`;
  const args = ['dlx', DEFAULT_WRANGLER_PACKAGE, 'r2', 'object', 'put', objectPath, '--file', filePath, '--remote'];

  if (config) {
    args.push('--config', config);
  }

  console.log(`Uploading ${fileName} -> ${objectPath}`);

  const result = spawnPnpm(args);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Failed to upload ${fileName} to R2 (exit code: ${result.status ?? 'unknown'})`);
  }
}

function main() {
  assertSupportedNodeVersion();

  const options = parseArgs(process.argv.slice(2));
  const version = options.version || getCurrentVersion();

  if (!version) {
    throw new Error('Version is required. Provide --version or ensure manifest.json has a version.');
  }

  const artifacts = listArtifacts(path.resolve(ROOT_DIR, options.dir));
  if (artifacts.length === 0) {
    throw new Error(`No Termy binary artifacts found in ${options.dir}`);
  }

  console.log(`Uploading ${artifacts.length} artifact(s) for version ${version} to bucket ${options.bucket}`);

  for (const artifactPath of artifacts) {
    uploadObject({
      bucket: options.bucket,
      config: options.config,
      filePath: artifactPath,
      version,
    });
  }

  console.log('R2 upload complete');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`upload-r2-assets failed: ${message}`);
    process.exit(1);
  }
}
