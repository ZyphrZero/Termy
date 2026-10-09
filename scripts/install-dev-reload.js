/**
 * Helpers for writing/clearing the dev-install sentinel file.
 *
 * The sentinel is a vault-local marker (`.termy-reload.json`) written into
 * the installed plugin directory while `pnpm install:dev` is replacing files.
 * A running Termy instance reads it from `ServerManager` to suppress
 * WebSocket auto-reconnect and server auto-restart for the duration of the
 * install, so the freshly written native binary is not held open by an
 * orphaned reconnect loop.
 *
 * The plugin never silently disables/enables itself — the user reloads Termy
 * manually after `pnpm install:dev` finishes.
 */

import fs from 'fs';
import path from 'path';

export const DEV_RELOAD_REQUEST_FILE = '.termy-reload.json';
export const DEV_RELOAD_PHASE_INSTALLING = 'installing';

function createRequestId() {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
}

export function createDevInstallRequest({
  pluginId = 'termy',
  requestId = createRequestId(),
  requestedAt = new Date(),
  activeUntil = new Date(Date.now() + 2 * 60 * 1000),
  pid = process.pid,
} = {}) {
  return {
    pluginId,
    requestId,
    phase: DEV_RELOAD_PHASE_INSTALLING,
    requestedAt: requestedAt.toISOString(),
    activeUntil: activeUntil.toISOString(),
    pid,
  };
}

export function writeDevInstallRequest(targetDir, options = {}) {
  const request = createDevInstallRequest(options);
  const requestPath = path.join(targetDir, DEV_RELOAD_REQUEST_FILE);

  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);

  return {
    request,
    requestPath,
  };
}

export function clearDevInstallRequest(targetDir) {
  const requestPath = path.join(targetDir, DEV_RELOAD_REQUEST_FILE);
  try {
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
    if (request?.phase === DEV_RELOAD_PHASE_INSTALLING) {
      fs.rmSync(requestPath, { force: true });
    }
  } catch {
    // Best-effort cleanup for process-exit paths.
  }
}
