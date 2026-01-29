/**
 * Development Environment Install Script
 * Copy plugin files to Obsidian plugins directory for testing
 * 
 * ⚠️  WARNING: This script will OVERWRITE existing files by default!
 * 
 * Usage:
 *   node scripts/install-dev.js              # Default: force overwrite + build
 *   node scripts/install-dev.js --kill       # Auto-close Obsidian process
 *   node scripts/install-dev.js --no-build   # Skip build step
 *   node scripts/install-dev.js --reset      # Reset saved configuration
 *   node scripts/install-dev.js -i           # Interactive mode (ask before overwrite)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, '.dev-install-config.json');

// Parse command line arguments
const args = process.argv.slice(2);
const INTERACTIVE_MODE = args.includes('-i') || args.includes('--interactive');
const KILL_OBSIDIAN = args.includes('--kill');
const RESET_CONFIG = args.includes('--reset');
const SKIP_BUILD = args.includes('--no-build');

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
  gray: '\x1b[90m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Load saved configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    // Ignore errors
  }
  return {};
}

// Save configuration
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    log(`  ⚠️  Cannot save config: ${e.message}`, 'yellow');
  }
}

// Detect operating system
function getPlatform() {
  const platform = process.platform;
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

// Get Obsidian executable path
function getObsidianPath() {
  const platform = getPlatform();
  if (platform === 'windows') {
    const possiblePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Obsidian', 'Obsidian.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Obsidian', 'Obsidian.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Obsidian', 'Obsidian.exe'),
    ];
    for (const p of possiblePaths) {
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
    log('  ✓ Obsidian process closed', 'green');
    return true;
  } catch (e) {
    return false;
  }
}

// Kill terminal server process
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
    log('  ✓ Termy server process terminated', 'green');
    return true;
  } catch (e) {
    // Process may not exist, ignore error
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
    log('  ✓ Obsidian started', 'green');
    return true;
  } catch (e) {
    log(`  ⚠️  Cannot auto-start Obsidian: ${e.message}`, 'yellow');
    return false;
  }
}

// Copy file with retry
async function copyFileWithRetry(srcPath, destPath, maxRetries = 3, retryDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.copyFileSync(srcPath, destPath);
      return true;
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') {
        if (attempt < maxRetries) {
          log(`  ⚠️  File locked, retrying in ${retryDelay / 1000}s (${attempt}/${maxRetries})...`, 'yellow');
          await sleep(retryDelay);
          continue;
        }
      }
      throw error;
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Create readline interface
let rl = null;
function getReadline() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return rl;
}

function closeReadline() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

function question(query) {
  return new Promise(resolve => getReadline().question(query, resolve));
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

async function main() {
  log('\n📦 Obsidian Terminal Plugin Development Install Tool\n', 'cyan');
  log('   ⚠️  WARNING: Will OVERWRITE existing files by default!', 'yellow');
  log('   Use -i flag for interactive mode\n', 'gray');
  
  if (INTERACTIVE_MODE || KILL_OBSIDIAN || SKIP_BUILD) {
    const modes = [];
    if (INTERACTIVE_MODE) modes.push('Interactive mode');
    if (KILL_OBSIDIAN) modes.push('Auto-close Obsidian');
    if (SKIP_BUILD) modes.push('Skip build');
    log(`   Mode: ${modes.join(' + ')}`, 'gray');
  }

  if (RESET_CONFIG) {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      log('✓ Configuration reset\n', 'green');
    }
    closeReadline();
    process.exit(0);
  }

  const config = loadConfig();

  // 0. Build the plugin
  if (!SKIP_BUILD) {
    log('🔨 Building plugin...', 'cyan');
    try {
      execSync('pnpm build', { cwd: ROOT_DIR, stdio: 'inherit' });
      log('  ✓ Build completed\n', 'green');
    } catch (error) {
      log('\n❌ Build failed', 'red');
      closeReadline();
      process.exit(1);
    }
  }

  // 1. Check required files
  log('🔍 Checking required files...', 'cyan');
  
  const binaryName = getBinaryName();
  const requiredFiles = [
    'main.js',
    'manifest.json',
    `binaries/${binaryName}`
  ];

  const missingFiles = [];
  
  for (const file of requiredFiles) {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
      log(`  ❌ Missing: ${file}`, 'red');
    } else {
      log(`  ✓ ${file}`, 'green');
    }
  }

  if (missingFiles.length > 0) {
    log('\n❌ Missing required files', 'red');
    log('Please run: pnpm build && pnpm build:rust', 'yellow');
    closeReadline();
    process.exit(1);
  }

  log('');

  // 2. Get Obsidian plugins directory
  let pluginsDir = config.pluginsDir;
  
  if (!pluginsDir || !fs.existsSync(pluginsDir)) {
    log('📁 Obsidian plugins directory not configured', 'cyan');
    log('   Example: C:\\Users\\YourName\\Documents\\MyVault\\.obsidian\\plugins', 'gray');
    log('   Example: /Users/YourName/Documents/MyVault/.obsidian/plugins', 'gray');
    log('');
    
    pluginsDir = await question('Enter Obsidian plugins directory path: ');
    pluginsDir = pluginsDir.trim().replace(/['"]/g, '');
    
    if (!fs.existsSync(pluginsDir)) {
      log('\n❌ Directory does not exist', 'red');
      closeReadline();
      process.exit(1);
    }
    
    config.pluginsDir = pluginsDir;
    saveConfig(config);
    log('  ✓ Configuration saved\n', 'green');
  } else {
    log(`📁 Using plugins directory: ${pluginsDir}\n`, 'cyan');
  }

  // 3. Create plugin directory
  const targetDir = path.join(pluginsDir, 'obsidian-termy');
  
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    log(`📁 Created plugin directory: ${targetDir}\n`, 'cyan');
  }

  // 4. Kill Obsidian if requested
  if (KILL_OBSIDIAN) {
    log('🔄 Closing Obsidian...', 'cyan');
    killObsidian();
    await sleep(1000);
    log('');
  }

  // 4.5. Kill server processes to release file locks
  log('🔄 Terminating server processes...', 'cyan');
  killTerminalServer();
  log('');

  // 5. Copy files
  log('📋 Copying files...', 'cyan');

  const coreFiles = ['main.js', 'manifest.json', 'styles.css'];
  for (const file of coreFiles) {
    const srcPath = path.join(ROOT_DIR, file);
    const destPath = path.join(targetDir, file);
    
    // Skip if file doesn't exist
    if (!fs.existsSync(srcPath)) {
      log(`  ❌ ${file}: File not found`, 'red');
      closeReadline();
      process.exit(1);
    }
    
    try {
      await copyFileWithRetry(srcPath, destPath);
      log(`  ✓ ${file}`, 'green');
    } catch (error) {
      log(`  ❌ ${file}: ${error.message}`, 'red');
      closeReadline();
      process.exit(1);
    }
  }

  const binariesDir = path.join(targetDir, 'binaries');
  if (!fs.existsSync(binariesDir)) {
    fs.mkdirSync(binariesDir, { recursive: true });
  }

  const srcBinaryPath = path.join(ROOT_DIR, 'binaries', binaryName);
  const destBinaryPath = path.join(binariesDir, binaryName);
  
  try {
    await copyFileWithRetry(srcBinaryPath, destBinaryPath);
    log(`  ✓ binaries/${binaryName}`, 'green');
  } catch (error) {
    log(`  ❌ binaries/${binaryName}: ${error.message}`, 'red');
    closeReadline();
    process.exit(1);
  }

  // Copy SHA256 file if exists
  const srcChecksumPath = `${srcBinaryPath}.sha256`;
  if (fs.existsSync(srcChecksumPath)) {
    try {
      await copyFileWithRetry(srcChecksumPath, `${destBinaryPath}.sha256`);
      log(`  ✓ binaries/${binaryName}.sha256`, 'green');
    } catch (error) {
      log(`  ⚠️  SHA256 file copy failed (non-critical)`, 'yellow');
    }
  }

  log('');

  // 6. Restart Obsidian if killed
  if (KILL_OBSIDIAN) {
    log('🚀 Starting Obsidian...', 'cyan');
    await sleep(500);
    startObsidian();
    log('');
  }

  // 7. Complete
  log('🎉 Installation complete!', 'green');
  
  if (!KILL_OBSIDIAN) {
    log('\nNext steps:', 'cyan');
    log('  1. Open Obsidian', 'yellow');
    log('  2. Go to Settings → Community plugins', 'yellow');
    log('  3. Disable "Restricted mode" (if enabled)', 'yellow');
    log('  4. Find "Termy" in installed plugins list', 'yellow');
    log('  5. Enable the plugin', 'yellow');
    log('  6. Use Command Palette (Ctrl+P) and type "Termy" to test\n', 'yellow');
  }

  log('💡 Tips:', 'cyan');
  log('  - After code changes, run pnpm build, then reload plugin in Obsidian', 'yellow');
  log('  - Press Ctrl+Shift+I to open developer tools for logs', 'yellow');
  log('  - Quick install: pnpm install:dev:force\n', 'yellow');

  closeReadline();
}

main().catch(error => {
  log(`\n❌ Error: ${error.message}`, 'red');
  closeReadline();
  process.exit(1);
});
