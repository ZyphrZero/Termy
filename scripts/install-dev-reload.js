import fs from 'fs';
import path from 'path';

export const DEV_RELOAD_REQUEST_FILE = '.termy-dev-reload.json';

function createRequestId() {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
}

export function createDevReloadRequest({
  pluginId = 'termy',
  requestId = createRequestId(),
  requestedAt = new Date(),
  pid = process.pid,
} = {}) {
  return {
    pluginId,
    requestId,
    requestedAt: requestedAt.toISOString(),
    pid,
  };
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
