/**
 * BinaryDownloader - binary downloader
 * 
 * Responsibilities:
 * 1. Detect the current platform
 * 2. Download the matching binary from GitHub Releases or Cloudflare R2
 * 3. Verify SHA256
 * 4. Track download progress
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import { debugLog, debugWarn, errorLog } from '@/utils/logger';
import { t } from '@/i18n';
import { resolveBinaryAssetUrls } from './binaryDownloadUrls';
import type { BinaryDownloadConfig } from './binaryDownloadUrls';

/** Download progress callback */
export type DownloadProgressCallback = (progress: DownloadProgress) => void;

/** Download progress info */
export interface DownloadProgress {
  /** Current stage */
  stage: 'checking' | 'downloading' | 'verifying' | 'complete' | 'error';
  /** Progress percentage (0-100) */
  percent: number;
  /** Downloaded bytes */
  downloadedBytes?: number;
  /** Total bytes */
  totalBytes?: number;
  /** Error message */
  error?: string;
}

/** Binary info */
interface BinaryInfo {
  /** Filename */
  filename: string;
  /** Download URL */
  url: string;
  /** SHA256 checksum URL */
  checksumUrl: string;
}

export class BinaryDownloader {
  /** Plugin directory */
  private pluginDir: string;
  
  /** Current plugin version */
  private version: string;
  
  /** Binary download configuration */
  private downloadConfig: BinaryDownloadConfig;
  
  /** Installed version cache (avoids repeated process invocations) */
  private installedVersionCache: string | null | undefined = undefined;
  
  /** Version cache filename */
  private readonly versionCacheFileName = '.termy-server.version.json';

  constructor(pluginDir: string, version: string, downloadConfig: BinaryDownloadConfig) {
    this.pluginDir = pluginDir;
    this.version = version;
    this.downloadConfig = {
      source: downloadConfig.source,
    };
  }

  getDownloadConfig(): BinaryDownloadConfig {
    return { ...this.downloadConfig };
  }

  /**
   * Check whether the binary exists and the version matches
   * @param skipVersionCheck Whether to skip version checks (used in debug mode)
   */
  binaryExists(skipVersionCheck = false): boolean {
    const binaryPath = this.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return false;
    }
    
    // If version checks are skipped, return true as long as the file exists
    if (skipVersionCheck) {
      return true;
    }
    
    // Check whether the version matches
    const installedVersion = this.getInstalledVersion();
    return installedVersion === this.version;
  }
  
  /**
   * Check whether an update is needed (the file exists but the version does not match)
   * @param skipVersionCheck Whether to skip version checks (used in debug mode)
   */
  needsUpdate(skipVersionCheck = false): boolean {
    const binaryPath = this.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return false; // The file does not exist, so it needs to be downloaded rather than updated
    }
    
    // If version checks are skipped, assume no update is needed
    if (skipVersionCheck) {
      return false;
    }
    
    const installedVersion = this.getInstalledVersion();
    return installedVersion !== this.version;
  }
  
  /**
   * Get the installed binary version
   * @param skipExecution Whether to skip executing the binary (used in debug mode)
   */
  private getInstalledVersion(skipExecution = false): string | null {
    try {
      const binaryPath = this.getBinaryPath();
      if (!fs.existsSync(binaryPath)) {
        this.installedVersionCache = null;
        return null;
      }

      if (this.installedVersionCache !== undefined) {
        return this.installedVersionCache;
      }
      
      const cachedVersion = this.readCachedVersion(binaryPath);
      if (cachedVersion) {
        this.installedVersionCache = cachedVersion;
        return cachedVersion;
      }
      
      // If execution is skipped, try to infer the version from file metadata
      if (skipExecution) {
        debugLog('[BinaryDownloader] 跳过版本检测，使用预期版本:', this.version);
        this.installedVersionCache = this.version;
        this.writeCachedVersion(binaryPath, this.version);
        return this.version;
      }
      
      const result = spawnSync(binaryPath, ['--version'], {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 2000,
      });

      if (result.error || result.status !== 0) {
        debugWarn('[BinaryDownloader] 获取二进制版本失败:', result.error ?? result.stderr);
        debugWarn('[BinaryDownloader] 提示: 如果在离线环境或遇到权限问题，请开启调试模式跳过版本检测');
        this.installedVersionCache = null;
        return null;
      }

      const rawVersion = (result.stdout || '').trim();
      if (!rawVersion) {
        this.installedVersionCache = null;
        return null;
      }

      const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;
      const normalizedVersion = version || null;
      this.installedVersionCache = normalizedVersion;
      if (normalizedVersion) {
        this.writeCachedVersion(binaryPath, normalizedVersion);
      }
      return normalizedVersion;
    } catch (error) {
      debugWarn('[BinaryDownloader] 获取二进制版本异常:', error);
    }
    
    this.installedVersionCache = null;
    return null;
  }

  /**
   * Get the binary path
   */
  getBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    const filename = `termy-server-${platform}-${arch}${ext}`;
    
    return path.join(this.pluginDir, 'binaries', filename);
  }

  /**
   * Download the binary
   */
  async download(onProgress?: DownloadProgressCallback): Promise<void> {
    const notify = (progress: DownloadProgress) => {
      onProgress?.(progress);
    };

    const binaryPath = this.getBinaryPath();
    const tempPath = this.getTempBinaryPath(binaryPath);

    try {
      debugLog('[BinaryDownloader] 准备下载二进制:', {
        version: this.version,
        source: this.downloadConfig.source,
        binaryPath,
        tempPath,
      });
      notify({ stage: 'checking', percent: 0 });
      
      // Get binary info
      const binaryInfo = this.getBinaryInfo();

      // Ensure the directory exists
      const binariesDir = path.join(this.pluginDir, 'binaries');
      if (!fs.existsSync(binariesDir)) {
        fs.mkdirSync(binariesDir, { recursive: true });
      }

      notify({ stage: 'downloading', percent: 10 });
      
      // Download the binary
      this.safeUnlink(tempPath);
      
      try {
        await this.downloadFile(binaryInfo.url, tempPath, (percent, downloadedBytes, totalBytes) => {
          // The download stage accounts for 10% - 80%
          notify({
            stage: 'downloading',
            percent: 10 + percent * 0.7,
            downloadedBytes,
            totalBytes,
          });
        });
      } catch (downloadError) {
        // If the download fails, provide detailed error information
        const errorMsg = downloadError instanceof Error ? downloadError.message : String(downloadError);
        debugWarn('[BinaryDownloader] 下载失败:', errorMsg);
        
        if (errorMsg.includes('404') && this.downloadConfig.source === 'github-release') {
          debugLog('[BinaryDownloader] 指定版本不存在，尝试下载 GitHub latest...');
          const latestBinaryInfo = this.getBinaryInfo('latest');

          await this.downloadFile(latestBinaryInfo.url, tempPath, (percent, downloadedBytes, totalBytes) => {
            notify({
              stage: 'downloading',
              percent: 10 + percent * 0.7,
              downloadedBytes,
              totalBytes,
            });
          });

          binaryInfo.checksumUrl = latestBinaryInfo.checksumUrl;
        } else {
          throw downloadError;
        }
      }

      notify({ stage: 'verifying', percent: 85 });
      
      // Download and verify the checksum
      if (binaryInfo.checksumUrl) {
        try {
          debugLog('[BinaryDownloader] 拉取校验和:', binaryInfo.checksumUrl);
          const checksumContent = await this.fetchText(binaryInfo.checksumUrl);
          const expectedHash = checksumContent.split(/\s+/)[0].toLowerCase();
          
          const actualHash = await this.calculateSHA256(tempPath);
          debugLog('[BinaryDownloader] 校验和对比:', {
            expectedHash,
            actualHash,
            file: tempPath,
          });
          
          if (actualHash !== expectedHash) {
            // Delete the corrupted file
            this.safeUnlink(tempPath);
            throw new Error(
              t('notices.checksumMismatch') || 
              `校验和不匹配: 期望 ${expectedHash}, 实际 ${actualHash}`
            );
          }
          
          debugLog('[BinaryDownloader] SHA256 校验通过');
        } catch (checksumError) {
          // If checksum download fails, warn only and do not block usage
          debugWarn('[BinaryDownloader] 校验和验证失败:', checksumError);
        }
      }

      // Set executable permission (Unix)
      if (process.platform !== 'win32') {
        fs.chmodSync(tempPath, 0o755);
      }

      await this.replaceBinary(tempPath, binaryPath);
      this.writeCachedVersion(binaryPath, this.version);
      this.installedVersionCache = this.version;
      
      notify({ stage: 'complete', percent: 100 });
      
      debugLog('[BinaryDownloader] 二进制文件下载完成:', binaryPath);
      
    } catch (error) {
      this.safeUnlink(tempPath);
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[BinaryDownloader] 下载失败:', errorMessage);
      
      notify({ 
        stage: 'error', 
        percent: 0, 
        error: errorMessage 
      });
      
      throw error;
    }
  }

  /**
   * Get binary info
   * Build the download URL for the current version
   */
  private getBinaryInfo(releaseChannel: 'version' | 'latest' = 'version'): BinaryInfo {
    const binaryInfo = resolveBinaryAssetUrls({
      version: this.version,
      source: this.downloadConfig.source,
      releaseChannel,
    });

    debugLog(
      '[BinaryDownloader] 使用二进制下载 URL:',
      binaryInfo.url,
      `(source: ${this.downloadConfig.source}, channel: ${releaseChannel})`
    );

    return binaryInfo;
  }

  /**
   * Download a file
   */
  private async downloadFile(
    url: string, 
    destPath: string,
    onProgress?: (percent: number, downloadedBytes: number, totalBytes: number) => void
  ): Promise<void> {
    debugLog('[BinaryDownloader] 开始下载:', { url, destPath });
    await this.downloadFileWithRedirect(url, destPath, onProgress, 5);
    debugLog('[BinaryDownloader] 文件已保存:', destPath);
  }

  private async downloadFileWithRedirect(
    url: string,
    destPath: string,
    onProgress: ((percent: number, downloadedBytes: number, totalBytes: number) => void) | undefined,
    remainingRedirects: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const request = client.get(
        urlObj,
        {
          headers: {
            'User-Agent': 'obsidian-smart-workflow',
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          const redirectLocation = response.headers.location;

          if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
            response.resume();
            if (remainingRedirects <= 0) {
              reject(new Error('下载失败: 重定向次数过多'));
              return;
            }
            const nextUrl = new URL(redirectLocation, urlObj).toString();
            debugLog('[BinaryDownloader] 跟随重定向:', {
              from: urlObj.toString(),
              to: nextUrl,
              statusCode,
              remainingRedirects,
            });
            resolve(this.downloadFileWithRedirect(nextUrl, destPath, onProgress, remainingRedirects - 1));
            return;
          }

          if (statusCode !== 200) {
            response.resume();
            reject(new Error(`下载失败: HTTP ${statusCode}`));
            return;
          }

          const totalBytes = Number(response.headers['content-length'] || 0);
          debugLog('[BinaryDownloader] 下载响应已开始:', {
            url: urlObj.toString(),
            statusCode,
            totalBytes,
          });
          let downloadedBytes = 0;
          let finished = false;

          const fileStream = fs.createWriteStream(destPath);

          const fail = (error: Error) => {
            if (finished) {
              return;
            }
            finished = true;
            fileStream.destroy();
            fs.unlink(destPath, () => reject(error));
          };

          response.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              const percent = Math.min(100, (downloadedBytes / totalBytes) * 100);
              onProgress?.(percent, downloadedBytes, totalBytes);
            }
          });

          response.on('error', fail);
          fileStream.on('error', fail);

          fileStream.on('finish', () => {
            if (finished) {
              return;
            }
            finished = true;
            onProgress?.(100, downloadedBytes, totalBytes);
            fileStream.close(() => resolve());
          });

          response.pipe(fileStream);
        }
      );

      request.on('error', (error) => reject(error));
    });
  }

  private getVersionCachePath(): string {
    return path.join(this.pluginDir, 'binaries', this.versionCacheFileName);
  }
  
  private readCachedVersion(binaryPath: string): string | null {
    try {
      const cachePath = this.getVersionCachePath();
      if (!fs.existsSync(cachePath)) {
        return null;
      }
      
      const raw = fs.readFileSync(cachePath, 'utf8').trim();
      if (!raw) {
        return null;
      }
      
      const payload = JSON.parse(raw) as { version?: string; size?: number; mtimeMs?: number };
      if (!payload.version || payload.size === undefined || payload.mtimeMs === undefined) {
        return null;
      }
      
      const stats = fs.statSync(binaryPath);
      if (stats.size !== payload.size) {
        return null;
      }
      
      if (Math.abs(stats.mtimeMs - payload.mtimeMs) > 1) {
        return null;
      }
      
      return payload.version;
    } catch (error) {
      debugWarn('[BinaryDownloader] 读取版本缓存失败:', error);
      return null;
    }
  }
  
  private writeCachedVersion(binaryPath: string, version: string): void {
    try {
      const cachePath = this.getVersionCachePath();
      const stats = fs.statSync(binaryPath);
      const payload = {
        version,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
      
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(payload));
    } catch (error) {
      debugWarn('[BinaryDownloader] 写入版本缓存失败:', error);
    }
  }

  private getTempBinaryPath(binaryPath: string): string {
    return `${binaryPath}.download`;
  }

  private async replaceBinary(tempPath: string, destPath: string): Promise<void> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        fs.renameSync(tempPath, destPath);
        return;
      } catch (error) {
        if (this.isFileBusyError(error) && attempt < maxAttempts) {
          await this.delay(200 * attempt);
          continue;
        }
        if (this.isFileBusyError(error)) {
          throw new Error(
            t('notices.binaryInUse') ||
            '二进制文件被占用，请关闭 Obsidian 或结束 termy-server 进程后重试'
          );
        }
        throw error;
      }
    }
  }

  private isFileBusyError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private safeUnlink(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      return;
    }
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      debugWarn('[BinaryDownloader] 清理临时文件失败:', error);
    }
  }

  /**
   * Get text content
   */
  private async fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const request = client.get(
        urlObj,
        {
          headers: {
            'User-Agent': 'obsidian-smart-workflow',
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          const redirectLocation = response.headers.location;

          // Handle redirects
          if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
            response.resume();
            const nextUrl = new URL(redirectLocation, urlObj).toString();
            debugLog('[BinaryDownloader] 文本请求重定向:', {
              from: urlObj.toString(),
              to: nextUrl,
              statusCode,
            });
            resolve(this.fetchText(nextUrl));
            return;
          }

          if (statusCode !== 200) {
            response.resume();
            reject(new Error(`获取文本失败: HTTP ${statusCode}`));
            return;
          }

          let data = '';
          response.on('data', (chunk) => {
            data += chunk.toString();
          });

          response.on('end', () => {
            debugLog('[BinaryDownloader] 文本请求完成:', {
              url: urlObj.toString(),
              length: data.length,
            });
            resolve(data);
          });

          response.on('error', reject);
        }
      );

      request.on('error', reject);
    });
  }

  /**
   * Calculate the file SHA256
   */
  private async calculateSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
