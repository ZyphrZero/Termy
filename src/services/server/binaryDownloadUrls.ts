import type { BinaryDownloadSource } from '../../settings/settings';

export const GITHUB_RELEASE_REPOSITORY = 'ZyphrZero/Termy';
export const CLOUDFLARE_R2_BASE_URL = 'https://termy.changqiu.xyz';

interface BinaryInfo {
  filename: string;
  url: string;
  checksumUrl: string;
}

export interface BinaryDownloadConfig {
  source: BinaryDownloadSource;
}

export interface ResolveBinaryAssetUrlsOptions extends BinaryDownloadConfig {
  version: string;
  platform?: NodeJS.Platform;
  arch?: string;
  releaseChannel?: 'version' | 'latest';
}

function buildBinaryFilename(platform: string, arch: string): string {
  const ext = platform === 'win32' ? '.exe' : '';
  return `termy-server-${platform}-${arch}${ext}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function resolveBinaryAssetUrls(options: ResolveBinaryAssetUrlsOptions): BinaryInfo {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const filename = buildBinaryFilename(platform, arch);

  if (options.source === 'github-release') {
    const releaseBaseUrl = options.releaseChannel === 'latest'
      ? `https://github.com/${GITHUB_RELEASE_REPOSITORY}/releases/latest/download`
      : `https://github.com/${GITHUB_RELEASE_REPOSITORY}/releases/download/${options.version}`;

    return {
      filename,
      url: `${releaseBaseUrl}/${filename}`,
      checksumUrl: `${releaseBaseUrl}/${filename}.sha256`,
    };
  }

  const r2BaseUrl = normalizeBaseUrl(CLOUDFLARE_R2_BASE_URL);

  return {
    filename,
    url: `${r2BaseUrl}/${options.version}/${filename}`,
    checksumUrl: `${r2BaseUrl}/${options.version}/${filename}.sha256`,
  };
}
