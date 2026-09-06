// Builds docs/screenshots/index.html: ONE self-contained contact sheet with every PNG
// embedded as a base64 data URI and a feature/state/theme caption under each.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.png')) out.push(p);
  }
  return out;
}

const shots = walk(root).sort();
const cards = shots
  .map((file) => {
    const rel = relative(root, file); // e.g. palette/open-empty-query-light-clip.png
    const [feature, rest] = [rel.split('/')[0], rel.split('/').slice(1).join('/')];
    const match = /^(.*)-(light|dark)-(full|clip)\.png$/.exec(rest) ?? [];
    const [, state = rest, theme = '?', variant = '?'] = match;
    const b64 = readFileSync(file).toString('base64');
    return `<figure>
  <img src="data:image/png;base64,${b64}" alt="${rel}" loading="lazy">
  <figcaption><strong>${feature}</strong> · ${state} · ${theme} · ${variant}</figcaption>
</figure>`;
  })
  .join('\n');

writeFileSync(
  join(root, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>jobfill — visual QA contact sheet</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; background: #f4f5f7; }
  h1 { font-size: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  figure { margin: 0; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 8px; }
  img { width: 100%; height: auto; border-radius: 4px; }
  figcaption { padding-top: 6px; color: #444; }
</style>
</head>
<body>
<h1>jobfill — visual QA contact sheet (${shots.length} shots)</h1>
<p>Harness renders of the real content bundle (mock adapters, seeded sample vault) — not a loaded extension.</p>
<div class="grid">
${cards}
</div>
</body>
</html>
`,
);
console.log(`contact sheet: ${shots.length} shots → docs/screenshots/index.html`);
