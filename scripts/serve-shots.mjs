// Serves docs/screenshots/ on 0.0.0.0 for phone/other-machine review.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
const port = Number(process.env.PORT ?? 5180);
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png' };

createServer(async (req, res) => {
  try {
    let rel;
    try {
      rel = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(
        /^\/+/,
        '',
      );
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    const file = join(root, rel === '' ? 'index.html' : rel);
    if (!file.startsWith(root)) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`screenshots → http://0.0.0.0:${port}/  (open /index.html)`);
});
