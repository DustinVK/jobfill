// Build entrypoints into dist/ (shippable extension) and dist-harness/ (e2e-only bundle).
// `node scripts/build.mjs [--harness] [--watch]`
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const harnessOnly = args.includes('--harness');
const watch = args.includes('--watch');

const manifestVersion = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
).version;

const common = {
  bundle: true,
  target: ['firefox128'],
  platform: 'browser',
  // Unminified on purpose: AMO source-submission rule (SPEC §10.1) — readable ships, no source bundle needed.
  minify: false,
  sourcemap: false,
  logLevel: 'info',
  legalComments: 'inline', // keep vendored MIT notices (Preact) in the shipped bundle
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: {
    'process.env.NODE_ENV': '"production"',
    __JOBFILL_VERSION__: JSON.stringify(manifestVersion),
  },
};

/** @type {import('esbuild').BuildOptions[]} */
const extensionBuilds = [
  {
    ...common,
    entryPoints: [`${root}/src/background/index.ts`],
    outfile: `${root}/dist/background.js`,
    format: 'esm',
  },
  // Content scripts are classic scripts in Firefox — IIFE, never ESM.
  {
    ...common,
    entryPoints: [`${root}/src/content/index.ts`],
    outfile: `${root}/dist/content.js`,
    format: 'iife',
  },
  // Auto-run variant for registered scripts on granted origins (SPEC §8.4.4/§8.5).
  {
    ...common,
    entryPoints: [`${root}/src/content/auto-entry.ts`],
    outfile: `${root}/dist/content-auto.js`,
    format: 'iife',
  },
  {
    ...common,
    entryPoints: [`${root}/src/options/main.tsx`],
    outfile: `${root}/dist/options.js`,
    format: 'esm',
    splitting: false,
  },
  {
    ...common,
    entryPoints: [`${root}/src/popup/main.tsx`],
    outfile: `${root}/dist/popup.js`,
    format: 'esm',
  },
];

/** @type {import('esbuild').BuildOptions[]} */
const harnessBuilds = [
  {
    ...common,
    entryPoints: [`${root}/src/content/harness-entry.ts`],
    outfile: `${root}/dist-harness/content.harness.js`,
    format: 'iife',
  },
  {
    ...common,
    entryPoints: [`${root}/src/options/dev-entry.tsx`],
    outfile: `${root}/dist-harness/options.dev.js`,
    format: 'esm',
  },
  {
    ...common,
    // Real React (not Preact) for the controlled-input harness — dev dependency only.
    jsx: 'automatic',
    jsxImportSource: 'react',
    entryPoints: [`${root}/tests/harness/react-form.jsx`],
    outfile: `${root}/dist-harness/react-form.js`,
    format: 'iife',
  },
];

function copyStatic() {
  mkdirSync(`${root}/dist`, { recursive: true });
  cpSync(`${root}/manifest.json`, `${root}/dist/manifest.json`);
  cpSync(`${root}/icons`, `${root}/dist/icons`, { recursive: true });
  cpSync(`${root}/src/options/options.html`, `${root}/dist/options.html`);
  cpSync(`${root}/src/options/options.css`, `${root}/dist/options.css`);
  cpSync(`${root}/src/popup/popup.html`, `${root}/dist/popup.html`);
  if (existsSync(`${root}/src/popup/popup.css`)) {
    cpSync(`${root}/src/popup/popup.css`, `${root}/dist/popup.css`);
  }
}

const builds = harnessOnly ? harnessBuilds : extensionBuilds;
if (harnessOnly) {
  mkdirSync(`${root}/dist-harness`, { recursive: true });
  cpSync(`${root}/src/options/options.css`, `${root}/dist-harness/options.css`);
} else {
  rmSync(`${root}/dist`, { recursive: true, force: true });
  copyStatic();
}

if (watch) {
  for (const b of builds) {
    const ctx = await context(b);
    await ctx.watch();
  }
  console.log('watching…');
} else {
  await Promise.all(builds.map((b) => build(b)));
  console.log(harnessOnly ? 'harness build complete' : 'extension build complete');
}
