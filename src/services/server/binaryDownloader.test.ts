import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBinaryAssetUrls } from './binaryDownloadUrls.ts';

test('resolveBinaryAssetUrls builds GitHub Release URLs for Unix binaries', () => {
  const urls = resolveBinaryAssetUrls({
    version: '1.3.0',
    platform: 'linux',
    arch: 'x64',
    source: 'github-release',
  });

  assert.equal(
    urls.url,
    'https://github.com/ZyphrZero/Termy/releases/download/1.3.0/termy-server-linux-x64'
  );
  assert.equal(
    urls.checksumUrl,
    'https://github.com/ZyphrZero/Termy/releases/download/1.3.0/termy-server-linux-x64.sha256'
  );
});

test('resolveBinaryAssetUrls builds Cloudflare R2 URLs for Windows binaries', () => {
  const urls = resolveBinaryAssetUrls({
    version: '1.3.0',
    platform: 'win32',
    arch: 'x64',
    source: 'cloudflare-r2',
  });

  assert.equal(
    urls.url,
    'https://termy.changqiu.xyz/1.3.0/termy-server-win32-x64.exe'
  );
  assert.equal(
    urls.checksumUrl,
    'https://termy.changqiu.xyz/1.3.0/termy-server-win32-x64.exe.sha256'
  );
});

test('resolveBinaryAssetUrls builds GitHub latest fallback URLs', () => {
  const urls = resolveBinaryAssetUrls({
    version: '1.3.0',
    platform: 'darwin',
    arch: 'arm64',
    source: 'github-release',
    releaseChannel: 'latest',
  });

  assert.equal(
    urls.url,
    'https://github.com/ZyphrZero/Termy/releases/latest/download/termy-server-darwin-arm64'
  );
  assert.equal(
    urls.checksumUrl,
    'https://github.com/ZyphrZero/Termy/releases/latest/download/termy-server-darwin-arm64.sha256'
  );
});
