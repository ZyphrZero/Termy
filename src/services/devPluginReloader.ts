import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { debugLog, errorLog } from '@/utils/logger';

export const DEV_RELOAD_REQUEST_FILE = '.termy-dev-reload.json';

interface DevReloadRequest {
  pluginId?: unknown;
  requestId?: unknown;
}

interface ObsidianPluginManager {
  disablePlugin(pluginId: string): Promise<void>;
  enablePlugin(pluginId: string): Promise<void>;
}

type AppWithInternalPluginApi = App & {
  plugins?: ObsidianPluginManager;
};

export class DevPluginReloader {
  private readonly requestPath: string;
  private lastRequestId: string | null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloading = false;

  constructor(
    private readonly app: App,
    private readonly pluginId: string,
    pluginDir: string
  ) {
    this.requestPath = path.join(pluginDir, DEV_RELOAD_REQUEST_FILE);
    this.lastRequestId = this.readRequestId();
  }

  start(): void {
    fs.watchFile(this.requestPath, { interval: 750 }, this.handleRequestFileChanged);
    debugLog(`[DevPluginReloader] Watching ${this.requestPath}`);
  }

  stop(): void {
    fs.unwatchFile(this.requestPath, this.handleRequestFileChanged);
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  private readonly handleRequestFileChanged = (): void => {
    const requestId = this.readRequestId();
    if (!requestId || requestId === this.lastRequestId) {
      return;
    }

    this.lastRequestId = requestId;
    this.scheduleReload();
  };

  private scheduleReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }

    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.reloadPlugin();
    }, 250);
  }

  private async reloadPlugin(): Promise<void> {
    if (this.reloading) {
      return;
    }

    const app = this.app as AppWithInternalPluginApi;
    if (!app.plugins?.disablePlugin || !app.plugins?.enablePlugin) {
      errorLog('[DevPluginReloader] Obsidian plugin API is unavailable');
      return;
    }

    this.reloading = true;
    debugLog(`[DevPluginReloader] Reloading ${this.pluginId}`);

    try {
      await app.plugins.disablePlugin(this.pluginId);
      await app.plugins.enablePlugin(this.pluginId);
    } catch (error) {
      errorLog('[DevPluginReloader] Failed to reload plugin:', error);
      new Notice('Termy dev reload failed. Check the developer console.');
    } finally {
      this.reloading = false;
    }
  }

  private readRequestId(): string | null {
    try {
      if (!fs.existsSync(this.requestPath)) {
        return null;
      }

      const request = JSON.parse(fs.readFileSync(this.requestPath, 'utf-8')) as DevReloadRequest;
      if (request.pluginId !== this.pluginId) {
        return null;
      }

      return typeof request.requestId === 'string' && request.requestId.length > 0
        ? request.requestId
        : null;
    } catch (error) {
      errorLog('[DevPluginReloader] Failed to read reload request:', error);
      return null;
    }
  }
}
