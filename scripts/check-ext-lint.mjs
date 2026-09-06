// Runs addons-linter (web-ext lint) over dist/ and gates the build.
//
// Any error fails. Warnings fail too, *unless* the code is in ACCEPTED below with a written
// reason — so a newly introduced warning breaks the build instead of hiding in the noise.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ACCEPTED = {
  // SPEC §8.2 pins strict_min_version 128 while also requiring gecko.data_collection_permissions
  // (mandatory for new AMO submissions since Nov 2025; the key landed in FF 140 / Android 142).
  // Older Firefox ignores the key; AMO requires it. Keeping the manifest as specced is correct.
  KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION: 'manifest.json',
  KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION: 'manifest.json',
  // Preact's own `dangerouslySetInnerHTML` support path, present in the vendored library code.
  // jobfill never passes that prop; all our DOM construction is createElement/textContent.
  UNSAFE_VAR_ASSIGNMENT: /^(options|popup)\.js$/,
};

function accepted(item) {
  const rule = ACCEPTED[item.code];
  if (!rule) return false;
  return rule instanceof RegExp ? rule.test(item.file ?? '') : rule === item.file;
}

const child = spawn(
  'npx',
  ['web-ext', 'lint', '--source-dir=dist', '--output=json', '--no-config-discovery'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);

let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));

child.on('close', () => {
  let report;
  try {
    report = JSON.parse(out.slice(out.indexOf('{')));
  } catch {
    console.error('web-ext lint produced no parseable report:\n' + out + err);
    process.exit(1);
  }
  const errors = report.errors ?? [];
  const unexpected = (report.warnings ?? []).filter((w) => !accepted(w));
  for (const e of errors) console.error(`ERROR ${e.code} ${e.file ?? ''} — ${e.message}`);
  for (const w of unexpected)
    console.error(`UNEXPECTED WARNING ${w.code} ${w.file ?? ''} — ${w.message}`);
  if (errors.length || unexpected.length) {
    console.error('\nweb-ext lint gate FAILED');
    process.exit(1);
  }
  const acceptedCount = (report.warnings ?? []).length;
  console.log(
    `web-ext lint OK — 0 errors, ${acceptedCount} accepted warning(s) (see scripts/check-ext-lint.mjs)`,
  );
});
