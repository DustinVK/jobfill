// Build the phone-friendly interactive demo into demo/ (dev artifact — NOT part of dist/,
// never shipped, gitignored like dist/). `node scripts/build-demo.mjs [--watch]`
//
// demo/index.html      landing page (sample-data notice, links to the views)
// demo/options.html    real options app on the in-memory router + localStorage vault
// demo/form-plain.html plain harness form + content bundle + touch toolbar
// demo/form-react.html React-controlled harness form + content bundle + touch toolbar
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = `${root}/demo`;
const watch = process.argv.includes('--watch');

const manifestVersion = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8')).version;

const common = {
  bundle: true,
  target: ['firefox128', 'safari16', 'chrome120'],
  platform: 'browser',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: {
    'process.env.NODE_ENV': '"production"',
    __JOBFILL_VERSION__: JSON.stringify(manifestVersion),
  },
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    ...common,
    entryPoints: [`${root}/src/demo/options-entry.tsx`],
    outfile: `${out}/options.js`,
    format: 'esm',
  },
  {
    ...common,
    entryPoints: [`${root}/src/demo/form-entry.ts`],
    outfile: `${out}/form-entry.js`,
    format: 'iife',
  },
  {
    ...common,
    jsxImportSource: 'react', // the controlled-form harness is real React on purpose
    entryPoints: [`${root}/tests/harness/react-form.jsx`],
    outfile: `${out}/react-form.js`,
    format: 'iife',
  },
];

const BANNER =
  '<div style="position:sticky;top:0;z-index:2147483000;background:#7a2e0e;color:#ffe8d9;' +
  'font:13px/1.4 system-ui,sans-serif;padding:8px 12px;text-align:center">' +
  '⚠ jobfill DEMO — SAMPLE fictional data (“Maya Okafor”). Not a real application. ' +
  '<a href="./index.html" style="color:#ffd7ba">demo home</a></div>';

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1" />';

/** Turn a tests/harness form page into a demo page: viewport, banner, demo bundles. */
function transformFormPage(sourceFile, extraHead = '') {
  let html = readFileSync(`${root}/tests/harness/${sourceFile}`, 'utf8');
  html = html.replace(
    '<meta charset="utf-8" />',
    `<meta charset="utf-8" />\n    ${VIEWPORT}${extraHead}`,
  );
  html = html.replace(/\s*<script src="\/event-log\.js"><\/script>/, `\n    ${BANNER}`);
  html = html.replace(
    '<script src="/react-form.js"></script>',
    '<script src="./react-form.js"></script>',
  );
  html = html.replace('</body>', '    <script src="./form-entry.js"></script>\n  </body>');
  return html;
}

const LANDING = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    ${VIEWPORT}
    <title>jobfill demo</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; margin: 0; background: #0f1420; color: #e7edf7; }
      main { max-width: 34rem; margin: 0 auto; padding: 16px; }
      .card { display: block; background: #1a2234; border: 1px solid #2c3a54; border-radius: 14px;
              padding: 16px; margin: 14px 0; color: inherit; text-decoration: none; }
      .card:active { background: #223050; }
      .card h2 { margin: 0 0 6px; font-size: 18px; color: #8fd48f; }
      .card p { margin: 0; color: #aab6cc; font-size: 14px; }
      .note { font-size: 13px; color: #aab6cc; margin-top: 20px; }
    </style>
  </head>
  <body>
    ${BANNER}
    <main>
      <h1 style="font-size:22px">jobfill — interactive demo</h1>
      <p class="note">
        Everything here runs in this page: the real jobfill bundles wired to in-memory
        adapters and a vault pre-loaded with a <strong>fictional sample profile</strong>
        (“Maya Okafor”). No extension APIs, nothing leaves the device. Edits in the options
        view persist in this browser's localStorage and show up in the forms after refresh.
      </p>
      <a class="card" href="./options.html">
        <h2>Options app</h2>
        <p>Browse and edit the sample profile: experiences with bullet variants, answers,
           versions, files, settings.</p>
      </a>
      <a class="card" href="./form-plain.html">
        <h2>Application form — plain HTML</h2>
        <p>Mock job-application form. Use the bottom toolbar: Invoke, Palette (search menu
           with category tabs), Fill all, Undo. Tap a field first, then Palette, to fill
           that field from search.</p>
      </a>
      <a class="card" href="./form-react.html">
        <h2>Application form — React-controlled</h2>
        <p>Same drill against a React 18 controlled form, to check native-setter fills.</p>
      </a>
      <p class="note">Fill is confirm-first: green badges apply on Fill all, amber ones ask.
         Sensitive fields always confirm and are never part of Fill all.</p>
    </main>
  </body>
</html>
`;

const OPTIONS_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    ${VIEWPORT}
    <title>jobfill demo — options</title>
    <link rel="stylesheet" href="./options.css" />
  </head>
  <body>
    ${BANNER}
    <div id="app"></div>
    <script type="module" src="./options.js"></script>
  </body>
</html>
`;

function writeStatic() {
  mkdirSync(out, { recursive: true });
  cpSync(`${root}/src/options/options.css`, `${out}/options.css`);
  writeFileSync(`${out}/index.html`, LANDING);
  writeFileSync(`${out}/options.html`, OPTIONS_PAGE);
  writeFileSync(`${out}/form-plain.html`, transformFormPage('plain-form.html'));
  writeFileSync(`${out}/form-react.html`, transformFormPage('react-form.html'));
}

writeStatic();
if (watch) {
  for (const b of builds) {
    const ctx = await context(b);
    await ctx.watch();
  }
  console.log('demo: watching src/ — refresh the phone after edits');
} else {
  await Promise.all(builds.map((b) => build(b)));
  console.log('demo build complete → demo/');
}
