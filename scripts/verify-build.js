import fs from 'node:fs';
import path from 'node:path';

const bundlePath = path.resolve('main.js');

if (!fs.existsSync(bundlePath)) {
	console.error(`[verify-build] Bundle not found: ${bundlePath}`);
	process.exit(1);
}

const bundle = fs.readFileSync(bundlePath, 'utf8');
const requestModeIndex = bundle.indexOf('requestMode(');

if (requestModeIndex === -1) {
	console.error('[verify-build] Could not locate xterm requestMode in bundle');
	process.exit(1);
}

const requestModeWindow = bundle.slice(requestModeIndex, requestModeIndex + 600);
const brokenRequestModePattern = /void 0\|\|\([A-Za-z_$][\w$]*=\{\}\)/;

if (brokenRequestModePattern.test(requestModeWindow)) {
	console.error('[verify-build] Detected broken requestMode bundle pattern that can freeze the terminal on DECRQM');
	process.exit(1);
}

console.log('[verify-build] Bundle smoke check passed');
