import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Only Obsidian's UI adapter is replaced; filesystem, HTTP and SHA-256 are real.
const bundle = await build({
  stdin: {
    contents: "export { BinaryDownloader } from './binaryDownloader'; export { ServerManager } from './serverManager';",
    resolveDir: path.dirname(fileURLToPath(import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [{
    name: 'obsidian-test-adapter',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const getLanguage = () => "en"; export class Notice { setMessage() {} hide() {} }',
      }));
    },
  }],
});
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termy-server-test-bundle-'));
const bundlePath = path.join(bundleDir, 'server.mjs');
fs.writeFileSync(bundlePath, bundle.outputFiles[0].text);
test.after(() => fs.rmSync(bundleDir, { recursive: true, force: true }));
const { BinaryDownloader, ServerManager } = await import(pathToFileURL(bundlePath).href) as
  typeof import('./binaryDownloader') & typeof import('./serverManager');

const require = createRequire(import.meta.url);
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { require, setTimeout, clearTimeout },
});
test.after(() => {
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
  else Reflect.deleteProperty(globalThis, 'window');
});

function fixture(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'termy-binary-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const downloader = new BinaryDownloader(directory, '1.4.1', { source: 'cloudflare-r2' });
  const binaryPath = downloader.getBinaryPath();
  const cachePath = path.join(directory, 'binaries', '.termy-server.version.json');
  const install = (version: string, content = 'example binary') => {
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, content);
    const { size, mtimeMs } = fs.statSync(binaryPath);
    fs.writeFileSync(cachePath, JSON.stringify({ version, size, mtimeMs }));
  };
  return { directory, downloader, binaryPath, cachePath, install };
}

async function serve(t: test.TestContext, handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

function useLocalAssets(downloader: InstanceType<typeof BinaryDownloader>, baseUrl: string): void {
  Object.assign(downloader, {
    getBinaryInfo: () => ({ filename: 'example', url: `${baseUrl}/binary`, checksumUrl: `${baseUrl}/checksum` }),
  });
}

test('version detection invalidates cached results after an external binary replacement', t => {
  const { downloader, binaryPath, install } = fixture(t);
  install('1.4.1');
  assert.equal(downloader.binaryExists(), true);
  fs.writeFileSync(binaryPath, 'replacement binary with a different size');
  assert.equal(downloader.binaryExists(), false);
  assert.equal(downloader.needsUpdate(), true);
});

test('local inspection distinguishes missing, ready, outdated and unconfirmed files without writing metadata', t => {
  const { downloader, binaryPath, cachePath, install } = fixture(t);
  assert.deepEqual(downloader.getInstallationStatus(), {
    state: 'missing', installedVersion: null, expectedVersion: '1.4.1',
  });
  install('1.4.1');
  assert.equal(downloader.getInstallationStatus().state, 'ready');
  install('1.3.0');
  assert.equal(downloader.getInstallationStatus().state, 'update-required');
  fs.unlinkSync(cachePath);
  assert.equal(downloader.getInstallationStatus().state, 'unknown-version');
  assert.equal(fs.existsSync(cachePath), false);
  fs.writeFileSync(cachePath, '{invalid');
  assert.equal(downloader.getInstallationStatus().state, 'unknown-version');
  assert.equal(fs.readFileSync(cachePath, 'utf8'), '{invalid');
  fs.unlinkSync(binaryPath);
  assert.equal(downloader.getInstallationStatus().state, 'missing');
});

test('a directory at the binary path reports a detection error instead of downloaded', t => {
  const { downloader, binaryPath } = fixture(t);
  fs.mkdirSync(binaryPath, { recursive: true });
  assert.throws(() => downloader.getInstallationStatus(), /not a file/);
});

for (const checksumFailure of ['mismatch', 'unavailable']) {
  test(`download rejects ${checksumFailure} checksums and preserves the existing binary`, async t => {
    const { downloader, binaryPath, cachePath, install } = fixture(t);
    install('1.3.0', 'old binary');
    const originalCache = fs.readFileSync(cachePath, 'utf8');
    const baseUrl = await serve(t, (request, response) => {
      if (request.url === '/binary') response.end('new binary');
      else if (checksumFailure === 'mismatch') response.end('0'.repeat(64));
      else { response.statusCode = 404; response.end(); }
    });
    useLocalAssets(downloader, baseUrl);
    await assert.rejects(downloader.download(), checksumFailure === 'mismatch' ? /checksum mismatch/i : /HTTP 404/);
    assert.equal(fs.readFileSync(binaryPath, 'utf8'), 'old binary');
    assert.equal(fs.readFileSync(cachePath, 'utf8'), originalCache);
    assert.equal(fs.existsSync(`${binaryPath}.download`), false);
  });
}

test('verified download writes a matching version cache and removal clears only binary artifacts', async t => {
  const { downloader, binaryPath, cachePath } = fixture(t);
  const content = 'verified example binary';
  const checksum = createHash('sha256').update(content).digest('hex');
  const baseUrl = await serve(t, (request, response) => {
    response.end(request.url === '/binary' ? content : `${checksum}  example`);
  });
  useLocalAssets(downloader, baseUrl);
  await downloader.download();
  assert.equal(fs.readFileSync(binaryPath, 'utf8'), content);
  assert.equal(downloader.binaryExists(), true);
  const unrelatedFile = path.join(path.dirname(binaryPath), 'example.txt');
  fs.writeFileSync(unrelatedFile, 'keep');
  fs.writeFileSync(`${binaryPath}.download`, 'temporary');
  await downloader.remove();
  assert.equal(fs.existsSync(binaryPath), false);
  assert.equal(fs.existsSync(cachePath), false);
  assert.equal(fs.existsSync(`${binaryPath}.download`), false);
  assert.equal(fs.readFileSync(unrelatedFile, 'utf8'), 'keep');
  await downloader.remove();
});

test('removal still clears an existing binary when the in-flight update fails', async t => {
  const { directory, downloader, binaryPath, cachePath, install } = fixture(t);
  install('1.3.0');
  const started = Promise.withResolvers<http.ServerResponse>();
  const baseUrl = await serve(t, (_request, response) => started.resolve(response));
  useLocalAssets(downloader, baseUrl);
  const manager = new ServerManager(directory, '1.4.1', { source: 'cloudflare-r2' });
  Object.assign(manager, { binaryDownloader: downloader });
  const update = assert.rejects(manager.ensureBinaryUpdated(), /HTTP 500/);
  const response = await started.promise;
  const removal = manager.removeBinary();
  assert.equal(manager.getBinaryStatus().operation, 'removing');
  await assert.rejects(manager.ensureBinaryUpdated(), /Removing/);
  await assert.rejects(manager.ensureServer(), /Removing/);
  response.statusCode = 500;
  response.end();
  await update;
  await assert.doesNotReject(removal);
  assert.equal(fs.existsSync(binaryPath), false);
  assert.equal(fs.existsSync(cachePath), false);
  assert.equal(manager.getBinaryStatus().operation, 'idle');
  assert.equal(manager.getBinaryStatus().state, 'missing');
});

test('concurrent downloads share progress and the manager remains reusable after removal', async t => {
  const { directory, downloader } = fixture(t);
  const started = Promise.withResolvers<http.ServerResponse>();
  const content = 'verified example binary';
  const checksum = createHash('sha256').update(content).digest('hex');
  let binaryRequests = 0;
  const baseUrl = await serve(t, (request, response) => {
    if (request.url === '/binary') {
      binaryRequests++;
      response.setHeader('Content-Length', Buffer.byteLength(content));
      if (binaryRequests === 1) started.resolve(response);
      else response.end(content);
    } else response.end(checksum);
  });
  useLocalAssets(downloader, baseUrl);
  const manager = new ServerManager(directory, '1.4.1', { source: 'cloudflare-r2' });
  Object.assign(manager, { binaryDownloader: downloader });
  const operations: string[] = [];
  const stages: string[] = [];
  manager.on('binary-status-changed', () => {
    const status = manager.getBinaryStatus();
    operations.push(status.operation);
    if (status.progress) stages.push(status.progress.stage);
  });
  const first = manager.ensureBinaryUpdated();
  const response = await started.promise;
  const second = manager.ensureBinaryUpdated();
  assert.equal(manager.getBinaryStatus().operation, 'downloading');
  response.end(content);
  assert.deepEqual(await Promise.all([first, second]), ['downloaded', 'downloaded']);
  assert.equal(binaryRequests, 1);
  assert.equal(manager.getBinaryStatus().state, 'ready');
  assert.equal(manager.getBinaryStatus().operation, 'idle');
  assert.ok(stages.includes('checking') && stages.includes('downloading') && stages.includes('verifying'));
  await manager.removeBinary();
  assert.ok(operations.includes('removing'));
  assert.equal(manager.getBinaryStatus().state, 'missing');
  assert.equal(await manager.ensureBinaryUpdated(), 'downloaded');
  assert.equal(binaryRequests, 2);
  assert.equal(await manager.ensureBinaryUpdated(), 'already-ready');
  assert.equal(binaryRequests, 2);
});

test('offline mode prevents manual downloads while preserving honest local version status', async t => {
  const { directory, downloader, install } = fixture(t);
  let requests = 0;
  const baseUrl = await serve(t, (_request, response) => { requests++; response.end(); });
  useLocalAssets(downloader, baseUrl);
  const manager = new ServerManager(directory, '1.4.1', { source: 'cloudflare-r2' }, false, true);
  Object.assign(manager, { binaryDownloader: downloader });
  assert.equal(manager.getBinaryStatus().state, 'missing');
  assert.equal(await manager.ensureBinaryUpdated(), 'skipped-offline');
  install('1.3.0');
  assert.equal(manager.getBinaryStatus().state, 'update-required');
  assert.equal(await manager.ensureBinaryUpdated(), 'skipped-offline');
  assert.equal(requests, 0);
  await manager.removeBinary();
  assert.equal(manager.getBinaryStatus().state, 'missing');
});

test('removal during server startup prevents the downloaded binary from being launched', async t => {
  const { directory, downloader, binaryPath } = fixture(t);
  const started = Promise.withResolvers<http.ServerResponse>();
  const content = 'verified example binary';
  const checksum = createHash('sha256').update(content).digest('hex');
  const baseUrl = await serve(t, (request, response) => {
    if (request.url === '/binary') started.resolve(response);
    else response.end(checksum);
  });
  useLocalAssets(downloader, baseUrl);
  const manager = new ServerManager(directory, '1.4.1', { source: 'cloudflare-r2' });
  Object.assign(manager, { binaryDownloader: downloader });
  const startup = assert.rejects(manager.ensureServer(), /Removing/);
  const response = await started.promise;
  const removal = manager.removeBinary();
  response.end(content);
  await startup;
  await removal;
  assert.equal(fs.existsSync(binaryPath), false);
  assert.equal(manager.isServerRunning(), false);
  assert.equal(manager.getBinaryStatus().operation, 'idle');
});
