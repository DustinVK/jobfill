// On-device Firefox-for-Android testing over Tailscale (temporary/debug install ONLY —
// never `web-ext sign`, per CLAUDE.md). `node scripts/run-android.mjs [--check]`
//
// Preflight: verifies adb + the device named by JOBFILL_ANDROID_DEVICE (a wireless-debug
// address like 100.x.y.z:PORT) is connected and authorized. If not, prints the exact
// `adb pair` / `adb connect` commands to run — pairing is DELIBERATELY manual: the pairing
// code and the auth prompt appear on the phone, so a human has to be holding it.
//
// `--check` stops after the preflight (used to confirm the connection before launching).
// Otherwise it launches `web-ext run -t firefox-android` against dist/ on STABLE Firefox
// (org.mozilla.firefox — extensions are GA on release Firefox for Android).
//
// See docs/ANDROID_TESTING.md for the full pairing walkthrough and console access.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const device = process.env.JOBFILL_ANDROID_DEVICE;

function die(...lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

// --- adb present? -----------------------------------------------------------
try {
  execFileSync('adb', ['version'], { encoding: 'utf8' });
} catch {
  die('adb not found. Install it with:', '  brew install --cask android-platform-tools');
}

if (!device) {
  die(
    "Set JOBFILL_ANDROID_DEVICE to the phone's wireless-debug address, e.g.:",
    '  export JOBFILL_ANDROID_DEVICE=100.92.139.79:37123',
    '',
    "The IP is the phone's Tailscale IP (`tailscale status`); the port is shown on the",
    'phone under Settings → Developer options → Wireless debugging (it rotates on reboot).',
    'Then re-run. Pairing steps: docs/ANDROID_TESTING.md.',
  );
}

// --- device connected + authorized? ----------------------------------------
const list = execFileSync('adb', ['devices'], { encoding: 'utf8' });
const row = list
  .split('\n')
  .map((l) => l.trim())
  .find((l) => l.startsWith(device));
const status = row?.split(/\s+/)[1];

if (status !== 'device') {
  const ip = device.split(':')[0];
  die(
    row
      ? `Device ${device} is listed but "${status}" — not usable yet.`
      : `Device ${device} is not connected.`,
    '',
    'On the phone: Settings → Developer options → Wireless debugging (ON, phone on the',
    'tailnet). If this Mac has never paired: tap "Pair device with pairing code", then run',
    '',
    `  adb pair ${ip}:PAIRING_PORT`,
    '',
    '(use the pairing port + 6-digit code from that dialog — NOT the main port). Then:',
    '',
    `  adb connect ${device}`,
    '',
    status === 'unauthorized'
      ? 'Status "unauthorized": accept the debugging prompt on the phone, then re-run.'
      : 'The main port is on the Wireless debugging screen; it rotates on reboot.',
    'Re-run this command when `adb devices` shows the device as "device".',
  );
}

console.log(`preflight OK — ${device} connected and authorized`);
if (checkOnly) process.exit(0);

// --- launch -----------------------------------------------------------------
if (!existsSync(`${repo}/dist/manifest.json`)) {
  die('dist/ is missing — run `npm run build` first (or use `npm run run:android`).');
}
const result = spawnSync(
  'npx',
  [
    'web-ext',
    'run',
    '-t',
    'firefox-android',
    '--android-device',
    device,
    '--firefox-apk',
    'org.mozilla.firefox',
    '--adb-remove-old-artifacts',
    '--source-dir',
    `${repo}/dist`,
  ],
  { stdio: 'inherit', cwd: repo },
);
process.exit(result.status ?? 1);
