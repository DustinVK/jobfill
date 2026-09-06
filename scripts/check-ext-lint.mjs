// Runs addons-linter (web-ext lint) over dist/ and gates the build.
//
// Fails closed: a non-zero linter exit with an unparseable/mis-shaped report fails the gate.
// Any error fails. Warnings fail too unless they match an ACCEPTED entry below — and each
// entry pins an exact expected count, so one *more* warning of an accepted kind (e.g. a new
// innerHTML assignment in our own code) breaks the build instead of hiding in the noise.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ACCEPTED = [
  // SPEC §8.2 pins strict_min_version 128 while also requiring gecko.data_collection_permissions
  // (mandatory for new AMO submissions since Nov 2025; the key landed in FF 140 / Android 142).
  // Older Firefox ignores the key; AMO requires it. Keeping the manifest as specced is correct.
  { code: 'KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION', file: 'manifest.json', count: 1 },
  { code: 'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION', file: 'manifest.json', count: 1 },
  // Preact's own `dangerouslySetInnerHTML` support path (one assignment inside diffProps),
  // present in each Preact-using bundle. jobfill never passes that prop; all our DOM
  // construction is createElement/textContent. Count pinned to exactly one per bundle.
  { code: 'UNSAFE_VAR_ASSIGNMENT', file: 'options.js', count: 1 },
  { code: 'UNSAFE_VAR_ASSIGNMENT', file: 'popup.js', count: 1 },
];

const child = spawn(
  'npx',
  ['web-ext', 'lint', '--source-dir=dist', '--output=json', '--no-config-discovery'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);

let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));

child.on('close', (exitCode) => {
  let report;
  try {
    report = JSON.parse(out.slice(out.indexOf('{')));
  } catch {
    console.error(`web-ext lint produced no parseable report (exit ${exitCode}):\n${out}${err}`);
    process.exit(1);
  }
  if (!Array.isArray(report.errors) || !Array.isArray(report.warnings)) {
    console.error(
      `web-ext lint report has an unexpected shape (exit ${exitCode}) — failing closed.`,
    );
    process.exit(1);
  }

  let failed = false;
  for (const e of report.errors) {
    console.error(`ERROR ${e.code} ${e.file ?? ''} — ${e.message}`);
    failed = true;
  }

  // Grade warnings against the pinned expectations.
  const buckets = new Map(ACCEPTED.map((a) => [`${a.code}|${a.file}`, { ...a, seen: 0 }]));
  for (const w of report.warnings) {
    const bucket = buckets.get(`${w.code}|${w.file ?? ''}`);
    if (bucket) {
      bucket.seen++;
    } else {
      console.error(`UNEXPECTED WARNING ${w.code} ${w.file ?? ''} — ${w.message}`);
      failed = true;
    }
  }
  for (const bucket of buckets.values()) {
    if (bucket.seen !== bucket.count) {
      console.error(
        `WARNING COUNT DRIFT ${bucket.code} ${bucket.file}: expected ${bucket.count}, saw ${bucket.seen}`,
      );
      failed = true;
    }
  }

  // Linter exited non-zero for a reason we did not account for (e.g. crashed mid-run).
  if (exitCode !== 0 && report.errors.length === 0) {
    console.error(`web-ext lint exited ${exitCode} without reporting errors — failing closed.`);
    failed = true;
  }

  if (failed) {
    console.error('\nweb-ext lint gate FAILED');
    process.exit(1);
  }
  console.log(
    `web-ext lint OK — 0 errors, ${report.warnings.length} accepted warning(s) (pinned in scripts/check-ext-lint.mjs)`,
  );
});
