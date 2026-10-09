import { posix as posixPath, win32 as win32Path } from 'node:path';

export function resolvePluginDir(
  vaultPath: string,
  configDir: string,
  pluginId: string,
  manifestDir?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathModule = platform === 'win32' ? win32Path : posixPath;
  const pluginDir = manifestDir || pathModule.join(configDir, 'plugins', pluginId);

  // Obsidian's normalizePath is for vault-relative paths and strips Unix roots.
  return pathModule.isAbsolute(pluginDir)
    ? pathModule.normalize(pluginDir)
    : pathModule.join(vaultPath, pluginDir);
}
