import fs from 'fs';
import path from 'path';

export const DEV_RELOAD_REQUEST_FILE = '.termy-dev-reload.json';
export const DEV_RELOAD_PHASE_INSTALLING = 'installing';
export const DEV_RELOAD_PHASE_RELOAD = 'reload';

function createRequestId() {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
}

export function createDevReloadRequest({
  pluginId = 'termy',
  requestId = createRequestId(),
  requestedAt = new Date(),
  phase = DEV_RELOAD_PHASE_RELOAD,
  activeUntil,
  pid = process.pid,
} = {}) {
  const request = {
    pluginId,
    requestId,
    phase,
    requestedAt: requestedAt.toISOString(),
    pid,
  };

  if (activeUntil) {
    request.activeUntil = activeUntil.toISOString();
  }

  return request;
}

export function writeDevReloadRequest(targetDir, options = {}) {
  const request = createDevReloadRequest(options);
  const requestPath = path.join(targetDir, DEV_RELOAD_REQUEST_FILE);

  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);

  return {
    request,
    requestPath,
  };
}

export function createDevInstallRequest(options = {}) {
  return createDevReloadRequest({
    ...options,
    phase: DEV_RELOAD_PHASE_INSTALLING,
    activeUntil: options.activeUntil ?? new Date(Date.now() + 2 * 60 * 1000),
  });
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
