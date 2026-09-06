// Serves the harness pages + the dev options build on a local static server.
// `npm run dev:options` (options only) / `npm run demo` (options + form harness index).
// Static file serving only — nothing here ships in the extension.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [join(root, 'tests', 'harness'), join(root, 'dist-harness')];
const port = Number(process.env.PORT ?? 5177);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

async function resolveFile(urlPath) {
  const rel = normalize(decodeURIComponent(urlPath))
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^\//, '');
  const candidates = rel === '' ? ['options-dev.html'] : [rel];
  for (const candidate of candidates) {
    for (const base of roots) {
      const full = join(base, candidate);
      if (!full.startsWith(base)) continue;
      try {
        const s = await stat(full);
        if (s.isFile()) return full;
      } catch {
        /* try next root */
      }
    }
  }
  return undefined;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const file = await resolveFile(url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(port, () => {
  console.log(`jobfill dev server → http://localhost:${port}/`);
  console.log(`  options (in-memory adapters): http://localhost:${port}/options-dev.html`);
  console.log(`  harness pages:                http://localhost:${port}/index.html`);
});
