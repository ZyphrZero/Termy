/**
 * Development Environment Install Script
 * Copy plugin files to Obsidian plugins directory for testing
 *
 * Usage:
 *   pnpm install:dev <obsidian-vault-path> [OPTIONS]
 *
 * Options:
 *   --kill      Close and restart Obsidian
 *   --no-build  Skip building (already done by pnpm install:dev)
 *   --reset     Reset saved configuration
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, '.dev-install-config.json');

// Parse command line arguments
const args = process.argv.slice(2);
const KILL_OBSIDIAN = args.includes('--kill');
const SKIP_BUILD = args.includes('--no-build');
const RESET_CONFIG = args.includes('--reset');

// Get vault path from first non-flag argument
const VAULT_PATH = args.find(arg => !arg.startsWith('-')) || null;

// Termy server configuration
const SERVER_CONFIG = {
  name: 'termy-server',
  displayName: 'Termy Server'
};

// Color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Load/save configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {}
}

// Detect platform
function getPlatform() {
  const p = process.platform;
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
}

// Get Obsidian executable path
function getObsidianPath() {
  const platform = getPlatform();
  if (platform === 'windows') {
    const paths = [
      path.join(process.env.LOCALAPPDATA || '', 'Obsidian', 'Obsidian.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Obsidian', 'Obsidian.exe'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'macos') {
    return '/Applications/Obsidian.app';
  } else {
    try {
      return execSync('which obsidian 2>/dev/null', { encoding: 'utf-8' }).trim();
    } catch (e) {
      return 'obsidian';
    }
  }
  return null;
}

// Kill Obsidian process
function killObsidian() {
  const platform = getPlatform();
  try {
    if (platform === 'windows') {
      execSync('taskkill /F /IM Obsidian.exe 2>nul', { stdio: 'ignore' });
    } else {
      execSync('pkill -f Obsidian 2>/dev/null || true', { stdio: 'ignore' });
    }
    log('  Closed Obsidian', 'green');
    return true;
  } catch (e) {
    return false;
  }
}

// Kill termy server process
function killTerminalServer() {
  const platform = getPlatform();
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  try {
    if (platform === 'windows') {
      execSync(`taskkill /F /IM termy-server-win32-${arch}.exe 2>nul`, { stdio: 'ignore' });
    } else if (platform === 'macos') {
      execSync('pkill -f termy-server-darwin 2>/dev/null || true', { stdio: 'ignore' });
    } else {
      execSync('pkill -f termy-server-linux 2>/dev/null || true', { stdio: 'ignore' });
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Start Obsidian
function startObsidian() {
  const platform = getPlatform();
  const obsidianPath = getObsidianPath();

  try {
    if (platform === 'windows') {
      if (obsidianPath && fs.existsSync(obsidianPath)) {
        spawn(obsidianPath, [], { detached: true, stdio: 'ignore', shell: true }).unref();
      } else {
        execSync('start obsidian://', { stdio: 'ignore', shell: true });
      }
    } else if (platform === 'macos') {
      execSync('open -a Obsidian', { stdio: 'ignore' });
    } else {
      spawn('obsidian', [], { detached: true, stdio: 'ignore' }).unref();
    }
    log('  Started Obsidian', 'green');
    return true;
  } catch (e) {
    log(`  Failed to start Obsidian: ${e.message}`, 'yellow');
    return false;
  }
}

// Sleep utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Readline interface
let rl = null;
function getReadline() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

function closeReadline() {
  if (rl) { rl.close(); rl = null; }
}

function question(query) {
  return new Promise(resolve => getReadline().question(query, resolve));
}

// Validate Obsidian vault path
function validateObsidianVault(vaultPath) {
  const normalizedPath = vaultPath.trim().replace(/['"]/g, '');

  if (!fs.existsSync(normalizedPath)) {
    return { valid: false, error: 'Directory does not exist' };
  }

  if (!fs.statSync(normalizedPath).isDirectory()) {
    return { valid: false, error: 'Path is not a directory' };
  }

  const obsidianDir = path.join(normalizedPath, '.obsidian');
  if (!fs.existsSync(obsidianDir) || !fs.statSync(obsidianDir).isDirectory()) {
    return { valid: false, error: 'Not an Obsidian vault (missing .obsidian directory)' };
  }

  const pluginsDir = path.join(obsidianDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
  }

  return { valid: true, pluginsDir };
}

// Get binary name for current platform
function getBinaryName() {
  const platform = getPlatform();
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  if (platform === 'windows') {
    return `${SERVER_CONFIG.name}-win32-${arch}.exe`;
  } else if (platform === 'macos') {
    return `${SERVER_CONFIG.name}-darwin-${arch}`;
  } else {
    return `${SERVER_CONFIG.name}-linux-${arch}`;
  }
}

// Copy file with retry
async function copyFileWithRetry(srcPath, destPath, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.copyFileSync(srcPath, destPath);
      return true;
    } catch (error) {
      if ((error.code === 'EBUSY' || error.code === 'EPERM') && attempt < maxRetries) {
        await sleep(1000);
        continue;
      }
      throw error;
    }
  }
  return false;
}

async function main() {
  log('\n[Termy] Development Install\n', 'cyan');

  // Reset config
  if (RESET_CONFIG) {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      log('Configuration reset\n', 'green');
    }
    closeReadline();
    process.exit(0);
  }

  const config = loadConfig();

  // 1. Validate vault path
  let pluginsDir = config.pluginsDir;

  if (VAULT_PATH) {
    log(`Validating: ${VAULT_PATH}`, 'cyan');
    const result = validateObsidianVault(VAULT_PATH);

    if (!result.valid) {
      log(`\nError: ${result.error}`, 'red');
      log('Provide your Obsidian vault path (containing .obsidian folder)\n', 'yellow');
      closeReadline();
      process.exit(1);
    }

    pluginsDir = result.pluginsDir;
    config.vaultPath = VAULT_PATH.trim().replace(/['"]/g, '');
    config.pluginsDir = pluginsDir;
    saveConfig(config);
    log(`  Vault: ${config.vaultPath}`, 'green');
    log(`  Plugins: ${pluginsDir}\n`, 'green');
  } else if (!pluginsDir || !fs.existsSync(pluginsDir)) {
    log('Vault path required', 'cyan');
    const input = await question('Enter Obsidian vault path: ');
    const trimmed = input.trim().replace(/['"]/g, '');

    const result = validateObsidianVault(trimmed);
    if (!result.valid) {
      log(`\nError: ${result.error}`, 'red');
      log('Provide a valid Obsidian vault path\n', 'yellow');
      closeReadline();
      process.exit(1);
    }

    pluginsDir = result.pluginsDir;
    config.vaultPath = trimmed;
    config.pluginsDir = pluginsDir;
    saveConfig(config);
    log(`  Vault: ${trimmed}`, 'green');
    log(`  Plugins: ${pluginsDir}\n`, 'green');
  } else {
    log(`Plugins: ${pluginsDir}`, 'cyan');
    if (config.vaultPath) log(`  Vault: ${config.vaultPath}`, 'gray');
    log('', 'reset');
  }

  // 2. Build
  if (!SKIP_BUILD) {
    log('Building...', 'cyan');
    try {
      execSync('pnpm build', { cwd: ROOT_DIR, stdio: 'inherit' });
    } catch (e) {
      log('\nBuild failed', 'red');
      closeReadline();
      process.exit(1);
    }
    log('Build complete\n', 'green');
  }

  // 3. Check files
  log('Checking files...', 'cyan');
  const binaryName = getBinaryName();
  const requiredFiles = [
    'main.js',
    'manifest.json',
    `binaries/${binaryName}`
  ];

  for (const file of requiredFiles) {
    const exists = fs.existsSync(path.join(ROOT_DIR, file));
    log(`  ${exists ? '✓' : '✗'} ${file}`, exists ? 'green' : 'red');
  }

  if (!requiredFiles.every(f => fs.existsSync(path.join(ROOT_DIR, f)))) {
    log('\nMissing files. Run: pnpm build && pnpm build:rust', 'yellow');
    closeReadline();
    process.exit(1);
  }
  log('');

  // 4. Kill Obsidian
  if (KILL_OBSIDIAN) {
    log('Closing Obsidian...', 'cyan');
    killObsidian();
    killTerminalServer();
    await sleep(1000);
    log('');
  }

  // 5. Copy files
  const targetDir = path.join(pluginsDir, 'termy');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  log('Installing...', 'cyan');

  const coreFiles = ['main.js', 'manifest.json', 'styles.css'];
  for (const file of coreFiles) {
    const src = path.join(ROOT_DIR, file);
    const dest = path.join(targetDir, file);
    await copyFileWithRetry(src, dest);
    log(`  ${file}`, 'green');
  }

  const binariesDir = path.join(targetDir, 'binaries');
  if (!fs.existsSync(binariesDir)) {
    fs.mkdirSync(binariesDir, { recursive: true });
  }

  const srcBinary = path.join(ROOT_DIR, 'binaries', binaryName);
  const destBinary = path.join(binariesDir, binaryName);
  await copyFileWithRetry(srcBinary, destBinary);
  log(`  binaries/${binaryName}`, 'green');

  const staleMcpBinary = path.join(
    binariesDir,
    process.platform === 'win32'
      ? 'termy-context-mcp-server-win32-x64.exe'
      : process.platform === 'darwin'
        ? `termy-context-mcp-server-darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
        : `termy-context-mcp-server-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  );
  if (fs.existsSync(staleMcpBinary)) {
    fs.rmSync(staleMcpBinary, { force: true });
    log(`  removed stale ${path.basename(staleMcpBinary)}`, 'yellow');
  }
  log('');

  // 6. Restart Obsidian
  if (KILL_OBSIDIAN) {
    log('Starting Obsidian...', 'cyan');
    await sleep(500);
    startObsidian();
    log('');
  }

  // Complete
  log('Installation complete!\n', 'green');

  if (!KILL_OBSIDIAN) {
    log('Next steps:', 'cyan');
    log('  1. Open Obsidian', 'yellow');
    log('  2. Settings → Community plugins', 'yellow');
    log('  3. Enable "Termy" plugin', 'yellow');
    log('  4. Ctrl+P → "Termy" to open\n', 'yellow');
  }

  log('Tip: Ctrl+Shift+I for developer console\n', 'gray');
  closeReadline();
}

main().catch(e => {
  log(`\nError: ${e.message}`, 'red');
  closeReadline();
  process.exit(1);
});
