/**
 * Terminal Server Build Script
 * Auto-detect current platform and build the terminal server binary
 * Binary naming: terminal-server-{platform}-{arch}
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Supported platform configurations
const PLATFORMS = {
  'win32-x64': { 
    target: 'x86_64-pc-windows-msvc',
    ext: '.exe',
    displayName: 'Windows x64'
  },
  'darwin-x64': { 
    target: 'x86_64-apple-darwin',
    ext: '',
    displayName: 'macOS Intel'
  },
  'darwin-arm64': { 
    target: 'aarch64-apple-darwin',
    ext: '',
    displayName: 'macOS Apple Silicon'
  },
  'linux-x64': { 
    target: 'x86_64-unknown-linux-gnu',
    ext: '',
    displayName: 'Linux x64'
  },
  'linux-arm64': { 
    target: 'aarch64-unknown-linux-gnu',
    ext: '',
    displayName: 'Linux ARM64'
  },
};

// Terminal server configuration
const SERVER_CONFIG = {
  name: 'terminal-server',
  displayName: 'Terminal Server',
  binaryPrefix: 'terminal-server'
};

// Reference binary size (for hints only)
const REFERENCE_BINARY_SIZE = 5 * 1024 * 1024;

// Project paths
const RUST_DIR = path.join(__dirname, '..', 'rust-servers');
const BINARIES_DIR = path.join(__dirname, '..', 'binaries');
const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');

/**
 * Get plugin version from manifest.json
 */
function getPluginVersion() {
  try {
    const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(content);
    if (typeof manifest.version === 'string' && manifest.version.trim()) {
      return manifest.version.trim();
    }
  } catch (error) {
    console.warn(`⚠️  Failed to read manifest version: ${error.message}`);
  }
  return null;
}

/**
 * Get current platform identifier
 */
function getCurrentPlatform() {
  return `${process.platform}-${process.arch}`;
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    skipInstall: false,
    help: false,
    clean: false
  };

  for (const arg of args) {
    if (arg === '--skip-install') {
      options.skipInstall = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--clean') {
      options.clean = true;
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log('Terminal Server Build Script');
  console.log('');
  console.log('Usage: node build-rust.js [OPTIONS]');
  console.log('');
  console.log('Options:');
  console.log('  --skip-install       Skip rustup target installation');
  console.log('  --clean              Clean build cache before building');
  console.log('  -h, --help           Show this help message');
  console.log('');
  console.log('Output:');
  console.log('  Binary: binaries/terminal-server-{platform}-{arch}[.exe]');
  console.log('');
  console.log('Examples:');
  console.log('  node build-rust.js              # Build for current platform');
  console.log('  node build-rust.js --clean      # Clean build');
}

/**
 * Build the terminal server
 */
function buildServer(platformName, config, options) {
  const binaryName = `${SERVER_CONFIG.binaryPrefix}-${platformName}${config.ext}`;
  const outputPath = path.join(BINARIES_DIR, binaryName);
  const pluginVersion = getPluginVersion();
  
  console.log(`📦 Building ${SERVER_CONFIG.displayName}...`);
  
  // 1. Clean cache if requested
  if (options.clean) {
    console.log('  🧹 Cleaning build cache...');
    try {
      execSync(
        `cargo clean --release --target ${config.target}`,
        {
          cwd: RUST_DIR,
          stdio: 'pipe',
          encoding: 'utf8'
        }
      );
    } catch (error) {
      console.log('  ⚠️  Cache clean skipped (may be first build)');
    }
  }
  
  // 2. Compile
  console.log('  📦 Compiling...');
  const startTime = Date.now();
  
  try {
    execSync(
      `cargo build --release --target ${config.target}`,
      {
        cwd: RUST_DIR,
        stdio: 'inherit',
        encoding: 'utf8',
        env: {
          ...process.env,
          ...(pluginVersion ? { TERMINAL_SERVER_VERSION: pluginVersion } : {}),
        }
      }
    );
  } catch (error) {
    throw new Error(`Compilation failed: ${error.message}`);
  }
  
  const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  ⏱️  Build time: ${buildTime}s`);
  
  // 3. Find build artifact
  const targetDir = path.join(RUST_DIR, 'target', config.target, 'release');
  const sourceBinary = path.join(targetDir, `${SERVER_CONFIG.name}${config.ext}`);
  
  if (!fs.existsSync(sourceBinary)) {
    throw new Error(`Build artifact not found: ${sourceBinary}`);
  }
  
  // 4. Copy to binaries directory
  console.log('  📋 Copying binary...');
  fs.copyFileSync(sourceBinary, outputPath);
  
  // 5. Verify file size
  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  const sizeKB = (stats.size / 1024).toFixed(0);
  
  console.log(`  📊 File size: ${sizeMB} MB (${sizeKB} KB)`);
  
  if (stats.size > REFERENCE_BINARY_SIZE) {
    console.log(`  💡 Note: File size exceeds 5MB reference, this is expected`);
  }
  
  // 6. Generate SHA256 checksum
  console.log('  🔐 Generating SHA256 checksum...');
  const checksum = generateChecksum(outputPath);
  const checksumPath = `${outputPath}.sha256`;
  fs.writeFileSync(checksumPath, `${checksum}  ${binaryName}\n`);
  console.log(`  ✓ SHA256: ${checksum}`);
  
  return { binaryName, outputPath, checksum, sizeMB };
}

/**
 * Generate SHA256 checksum for a file
 */
function generateChecksum(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

// Main execution
const options = parseArgs();

if (options.help) {
  showHelp();
  process.exit(0);
}

console.log('🦀 Terminal Server Build Script');
console.log('');

// Detect current platform
const currentPlatform = getCurrentPlatform();
const platformConfig = PLATFORMS[currentPlatform];

if (!platformConfig) {
  console.error(`❌ Error: Current platform "${currentPlatform}" is not supported`);
  console.error(`Supported platforms: ${Object.keys(PLATFORMS).join(', ')}`);
  process.exit(1);
}

console.log(`🔍 Current platform: ${platformConfig.displayName} (${currentPlatform})`);
console.log('');

// Check if Rust is installed
try {
  const rustVersion = execSync('cargo --version', { encoding: 'utf8' });
  console.log(`✅ Rust installed: ${rustVersion.trim()}`);
} catch (error) {
  console.error('❌ Error: Cargo not found');
  console.error('Please install Rust first: https://rustup.rs/');
  process.exit(1);
}

// Check Rust source directory
if (!fs.existsSync(RUST_DIR)) {
  console.error(`❌ Error: Rust source directory not found: ${RUST_DIR}`);
  process.exit(1);
}

// Create binaries directory
if (!fs.existsSync(BINARIES_DIR)) {
  fs.mkdirSync(BINARIES_DIR, { recursive: true });
  console.log(`📁 Created binaries directory: ${BINARIES_DIR}`);
}

console.log('');

// Install build target
if (!options.skipInstall) {
  console.log('📦 Installing Rust build target...');
  try {
    console.log(`  - ${platformConfig.target}`);
    execSync(`rustup target add ${platformConfig.target}`, { 
      stdio: 'pipe',
      cwd: RUST_DIR 
    });
  } catch (error) {
    console.warn(`  ⚠️  Cannot install ${platformConfig.target}, may already be installed`);
  }
  console.log('');
}

// Build the terminal server
console.log(`🔨 Building for ${platformConfig.displayName}...`);
console.log('');

try {
  const result = buildServer(currentPlatform, platformConfig, options);
  
  console.log('');
  console.log('📊 Build Summary:');
  console.log(`  ✅ ${SERVER_CONFIG.displayName}`);
  console.log(`     Binary: ${result.binaryName}`);
  console.log(`     Size: ${result.sizeMB} MB`);
  console.log(`     SHA256: ${result.checksum.substring(0, 16)}...`);
  
  console.log('');
  console.log('🎉 Build complete!');
  console.log(`📂 Binary location: ${BINARIES_DIR}`);
} catch (error) {
  console.error('');
  console.error(`❌ Build failed: ${error.message}`);
  process.exit(1);
}
