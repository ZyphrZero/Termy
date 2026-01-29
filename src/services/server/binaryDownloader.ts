/**
 * BinaryDownloader - 二进制文件下载器
 * 
 * 职责:
 * 1. 检测当前平台
 * 2. 从 GitHub Release 下载对应的二进制文件
 * 3. 校验 SHA256
 * 4. 管理下载进度
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import { debugLog, debugWarn, errorLog } from '@/utils/logger';
import { t } from '@/i18n';

/** 下载进度回调 */
export type DownloadProgressCallback = (progress: DownloadProgress) => void;

/** 下载进度信息 */
export interface DownloadProgress {
  /** 当前阶段 */
  stage: 'checking' | 'downloading' | 'verifying' | 'complete' | 'error';
  /** 进度百分比 (0-100) */
  percent: number;
  /** 已下载字节数 */
  downloadedBytes?: number;
  /** 总字节数 */
  totalBytes?: number;
  /** 错误信息 */
  error?: string;
}

/** 二进制信息 */
interface BinaryInfo {
  /** 文件名 */
  filename: string;
  /** 下载 URL */
  url: string;
  /** SHA256 校验和 URL */
  checksumUrl: string;
}



export class BinaryDownloader {
  /** GitHub 仓库 */
  private readonly repo = 'ZyphrZero/Obsidian-Termy';
  
  /** 插件目录 */
  private pluginDir: string;
  
  /** 当前插件版本 */
  private version: string;
  
  /** 下载加速源 */
  private downloadAcceleratorUrl: string;
  
  /** 已安装版本缓存（避免重复进程调用） */
  private installedVersionCache: string | null | undefined = undefined;
  
  /** 版本缓存文件名 */
  private readonly versionCacheFileName = '.termy-server.version.json';

  constructor(pluginDir: string, version: string, downloadAcceleratorUrl: string = '') {
    this.pluginDir = pluginDir;
    this.version = version;
    this.downloadAcceleratorUrl = downloadAcceleratorUrl;
  }

  /**
   * 检查二进制文件是否存在且版本匹配
   * @param skipVersionCheck 是否跳过版本检查（调试模式使用）
   */
  binaryExists(skipVersionCheck = false): boolean {
    const binaryPath = this.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return false;
    }
    
    // 如果跳过版本检查，只要文件存在就返回 true
    if (skipVersionCheck) {
      return true;
    }
    
    // 检查版本是否匹配
    const installedVersion = this.getInstalledVersion();
    return installedVersion === this.version;
  }
  
  /**
   * 检查是否需要更新（文件存在但版本不匹配）
   * @param skipVersionCheck 是否跳过版本检查（调试模式使用）
   */
  needsUpdate(skipVersionCheck = false): boolean {
    const binaryPath = this.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return false; // 文件不存在，需要下载而非更新
    }
    
    // 如果跳过版本检查，认为不需要更新
    if (skipVersionCheck) {
      return false;
    }
    
    const installedVersion = this.getInstalledVersion();
    return installedVersion !== this.version;
  }
  
  /**
   * 获取已安装的二进制版本
   * @param skipExecution 是否跳过执行二进制文件（调试模式使用）
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
      
      // 如果跳过执行，尝试从文件元数据推断版本
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
   * 获取二进制文件路径
   */
  getBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    const filename = `termy-server-${platform}-${arch}${ext}`;
    
    return path.join(this.pluginDir, 'binaries', filename);
  }

  /**
   * 下载二进制文件
   */
  async download(onProgress?: DownloadProgressCallback): Promise<void> {
    const notify = (progress: DownloadProgress) => {
      onProgress?.(progress);
    };

    const binaryPath = this.getBinaryPath();
    const tempPath = this.getTempBinaryPath(binaryPath);

    try {
      notify({ stage: 'checking', percent: 0 });
      
      // 获取二进制信息
      const binaryInfo = await this.getBinaryInfo();

      // 确保目录存在
      const binariesDir = path.join(this.pluginDir, 'binaries');
      if (!fs.existsSync(binariesDir)) {
        fs.mkdirSync(binariesDir, { recursive: true });
      }

      notify({ stage: 'downloading', percent: 10 });
      
      // 下载二进制文件
      this.safeUnlink(tempPath);
      
      try {
        await this.downloadFile(binaryInfo.url, tempPath, (percent, downloadedBytes, totalBytes) => {
          // 下载阶段占 10% - 80%
          notify({
            stage: 'downloading',
            percent: 10 + percent * 0.7,
            downloadedBytes,
            totalBytes,
          });
        });
      } catch (downloadError) {
        // 如果下载失败，提供详细的错误信息
        const errorMsg = downloadError instanceof Error ? downloadError.message : String(downloadError);
        debugWarn('[BinaryDownloader] 下载失败:', errorMsg);
        
        // 如果是 404 错误，可能是版本不存在，尝试最新版本
        if (errorMsg.includes('404')) {
          debugLog('[BinaryDownloader] 尝试下载最新版本...');
          const latestBaseUrl = `https://github.com/${this.repo}/releases/latest/download`;
          const latestUrl = this.applyDownloadAccelerator(`${latestBaseUrl}/${binaryInfo.filename}`);
          const latestChecksumUrl = this.applyDownloadAccelerator(`${latestBaseUrl}/${binaryInfo.filename}.sha256`);
          
          await this.downloadFile(latestUrl, tempPath, (percent, downloadedBytes, totalBytes) => {
            notify({
              stage: 'downloading',
              percent: 10 + percent * 0.7,
              downloadedBytes,
              totalBytes,
            });
          });
          
          // 更新校验和 URL
          binaryInfo.checksumUrl = latestChecksumUrl;
        } else {
          throw downloadError;
        }
      }

      notify({ stage: 'verifying', percent: 85 });
      
      // 下载并验证校验和
      if (binaryInfo.checksumUrl) {
        try {
          const checksumContent = await this.fetchText(binaryInfo.checksumUrl);
          const expectedHash = checksumContent.split(/\s+/)[0].toLowerCase();
          
          const actualHash = await this.calculateSHA256(tempPath);
          
          if (actualHash !== expectedHash) {
            // 删除损坏的文件
            this.safeUnlink(tempPath);
            throw new Error(
              t('notices.checksumMismatch') || 
              `校验和不匹配: 期望 ${expectedHash}, 实际 ${actualHash}`
            );
          }
          
          debugLog('[BinaryDownloader] SHA256 校验通过');
        } catch (checksumError) {
          // 校验和下载失败时，仅警告但不阻止使用
          debugWarn('[BinaryDownloader] 校验和验证失败:', checksumError);
        }
      }

      // 设置可执行权限 (Unix)
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
   * 获取二进制文件信息
   * 直接构造 GitHub Release 下载 URL，绕过 API 限流
   */
  private async getBinaryInfo(): Promise<BinaryInfo> {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    const filename = `termy-server-${platform}-${arch}${ext}`;

    // 直接构造 GitHub Release 下载 URL
    // 格式: https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}
    const baseUrl = `https://github.com/${this.repo}/releases/download/${this.version}`;
    
    const downloadUrl = this.applyDownloadAccelerator(`${baseUrl}/${filename}`);
    const checksumUrl = this.applyDownloadAccelerator(`${baseUrl}/${filename}.sha256`);
    
    debugLog('[BinaryDownloader] 使用直接下载 URL:', downloadUrl);
    
    return {
      filename,
      url: downloadUrl,
      checksumUrl,
    };
  }

  /**
   * 下载文件
   */
  private async downloadFile(
    url: string, 
    destPath: string,
    onProgress?: (percent: number, downloadedBytes: number, totalBytes: number) => void
  ): Promise<void> {
    debugLog('[BinaryDownloader] 开始下载:', url);
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
            resolve(this.downloadFileWithRedirect(nextUrl, destPath, onProgress, remainingRedirects - 1));
            return;
          }

          if (statusCode !== 200) {
            response.resume();
            reject(new Error(`下载失败: HTTP ${statusCode}`));
            return;
          }

          const totalBytes = Number(response.headers['content-length'] || 0);
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

  private applyDownloadAccelerator(url: string): string {
    const base = this.downloadAcceleratorUrl.trim();
    if (!base) {
      return url;
    }

    if (!/^https?:\/\//i.test(base)) {
      debugWarn('[BinaryDownloader] 下载加速源格式无效，已忽略:', base);
      return url;
    }

    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return `${normalizedBase}${url}`;
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
   * 获取文本内容
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

          // 处理重定向
          if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
            response.resume();
            const nextUrl = new URL(redirectLocation, urlObj).toString();
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
            resolve(data);
          });

          response.on('error', reject);
        }
      );

      request.on('error', reject);
    });
  }

  /**
   * 计算文件 SHA256
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
