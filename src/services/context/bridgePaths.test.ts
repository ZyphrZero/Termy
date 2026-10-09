import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { App } from 'obsidian';
import { resolvePluginDir } from '../../utils/pluginPath.ts';
import { TERMY_CODEX_SKILL_RELATIVE_PATH, TERMY_CONTEXT_PATH_ENV } from './agentContext.ts';

// Obsidian is provided by the host app. Keep Node filesystem and path handling real.
const obsidianModuleUrl = `data:text/javascript,${encodeURIComponent(String.raw`
  export class FileSystemAdapter {
    constructor(basePath) { this.basePath = basePath; }
    getBasePath() { return this.basePath; }
  }
  export class MarkdownView {}
  export function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }
`)}`;
const sourceRoot = new URL('../../', import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'obsidian') {
      return { url: obsidianModuleUrl, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
    }
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.startsWith(sourceRoot.href)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { FileSystemAdapter } = await import(obsidianModuleUrl) as {
  FileSystemAdapter: new (basePath: string) => { getBasePath(): string };
};
const { AgentContextBridge } = await import('./agentContextBridge.ts');
const { IdeBridge } = await import('../ideBridge/ideBridge.ts');
hooks.deregister();

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    require: createRequire(import.meta.url),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  },
});
after(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

function createApp(basePath: string, activeFilePath: string | null = 'notes/demo.md'): App {
  const file = activeFilePath ? { path: activeFilePath } : null;
  return {
    vault: { adapter: new FileSystemAdapter(basePath) },
    workspace: {
      on: () => ({}),
      offref: () => {},
      getActiveFile: () => file,
      getActiveViewOfType: () => null,
      getLeavesOfType: () => file ? [{ view: { file } }] : [],
    },
  } as unknown as App;
}

type IdeBridgePaths = {
  port: number;
  lockfilePath: string;
  writeLockfile(): void;
  getVaultPath(): string | null;
  getWorkspaceFoldersJson(): string;
  captureSelection(): { filePath: string; fileUrl: string } | null;
};

test('agent context and skill stay under the absolute vault root when cwd is the vault', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'termy-bridge-paths-'));
  const vaultRoot = join(tempDir, 'Example Vault');
  mkdirSync(vaultRoot);
  const pluginDir = resolvePluginDir(vaultRoot, '.obsidian', 'termy');
  const bridge = new AgentContextBridge(createApp(vaultRoot), pluginDir);
  const originalCwd = process.cwd();

  try {
    process.chdir(vaultRoot);
    bridge.start();
    const contextPath = join(pluginDir, 'agent-context', 'obsidian-context.json');
    assert.equal(bridge.getContextFilePath(), contextPath);
    assert.equal(bridge.getTerminalEnv()[TERMY_CONTEXT_PATH_ENV], contextPath);
    const snapshot = JSON.parse(readFileSync(contextPath, 'utf8')) as {
      vaultRoot: string;
      workspaceFolders: string[];
      activeFile: { filePath: string; fileUrl: string };
      openFiles: Array<{ filePath: string }>;
    };
    const notePath = join(vaultRoot, 'notes', 'demo.md');
    assert.equal(snapshot.vaultRoot, vaultRoot);
    assert.deepEqual(snapshot.workspaceFolders, [vaultRoot]);
    assert.equal(snapshot.activeFile.filePath, notePath);
    assert.equal(snapshot.activeFile.fileUrl, pathToFileURL(notePath).href);
    assert.deepEqual(snapshot.openFiles.map(file => file.filePath), [notePath]);
    assert.match(readFileSync(join(vaultRoot, TERMY_CODEX_SKILL_RELATIVE_PATH), 'utf8'), /name: termy-obsidian-context/);
    assert.deepEqual(readdirSync(vaultRoot).sort(), ['.agents', '.obsidian']);
  } finally {
    bridge.stop();
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('IDE lockfile, workspace folders, and note references preserve the absolute vault root', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'termy-ide-paths-'));
  const vaultRoot = join(tempDir, 'Example Vault');
  mkdirSync(vaultRoot);
  const bridge = new IdeBridge(createApp(vaultRoot), '1.4.1') as unknown as IdeBridgePaths;
  bridge.port = 4312;
  bridge.lockfilePath = join(tempDir, '4312.lock');
  const originalCwd = process.cwd();

  try {
    process.chdir(vaultRoot);
    bridge.writeLockfile();
    const lockfile = JSON.parse(readFileSync(bridge.lockfilePath, 'utf8')) as { workspaceFolders: string[] };
    assert.deepEqual(lockfile.workspaceFolders, [vaultRoot]);
    const workspace = JSON.parse(bridge.getWorkspaceFoldersJson()) as {
      rootPath: string;
      folders: Array<{ path: string; uri: string }>;
    };
    assert.equal(workspace.rootPath, vaultRoot);
    assert.equal(workspace.folders[0].path, vaultRoot);
    assert.equal(workspace.folders[0].uri, pathToFileURL(vaultRoot).href);
    const notePath = join(vaultRoot, 'notes', 'demo.md');
    assert.equal(bridge.captureSelection()?.filePath, notePath);
    assert.equal(bridge.captureSelection()?.fileUrl, pathToFileURL(notePath).href);
    assert.deepEqual(readdirSync(vaultRoot), []);
  } finally {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('both bridges preserve Unix, Windows drive, and UNC roots from the adapter', () => {
  for (const vaultRoot of ['/home/example/Notes', 'F:\\example-vault', '\\\\server\\share\\Example Vault']) {
    const app = createApp(vaultRoot, null);
    const agentBridge = new AgentContextBridge(app, vaultRoot) as unknown as { getVaultRoot(): string | null };
    const ideBridge = new IdeBridge(app, '1.4.1') as unknown as IdeBridgePaths;
    assert.equal(agentBridge.getVaultRoot(), vaultRoot);
    assert.equal(ideBridge.getVaultPath(), vaultRoot);
    assert.equal(ideBridge.captureSelection()?.filePath, vaultRoot);
  }
});

test('both bridges return no vault root when a filesystem adapter is unavailable', () => {
  const app = createApp('/home/example/Notes', null);
  app.vault.adapter = {} as App['vault']['adapter'];
  const agentBridge = new AgentContextBridge(app, '/home/example/Notes') as unknown as { getVaultRoot(): string | null };
  const ideBridge = new IdeBridge(app, '1.4.1') as unknown as IdeBridgePaths;
  assert.equal(agentBridge.getVaultRoot(), null);
  assert.equal(ideBridge.getVaultPath(), null);
  assert.equal(ideBridge.captureSelection(), null);
});
