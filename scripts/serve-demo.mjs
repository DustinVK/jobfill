// Serves demo/ (and docs/screenshots/ under /shots/) for phone review over the tailnet.
// `node scripts/serve-demo.mjs [--host 127.0.0.1|<tailnet-ip>] [--port N] [--tailnet]`
//
// Default bind is 127.0.0.1 — pair it with `tailscale serve --bg <port>` for tailnet-only
// HTTPS (survives the Mac being locked; teardown: `tailscale serve reset`).
// `--tailnet` does that wiring itself: reads `tailscale status --json`, starts Serve in the
// background, prints the phone URL. If the tailnet has HTTPS/MagicDNS disabled it STOPS and
// prints tailscale's exact message instead of falling back silently (that toggle is a
// one-time switch at https://login.tailscale.com/admin — doable from a phone). The manual
// fallback is plain HTTP bound to this machine's tailnet IP: `--host <100.x.y.z>`.
// NEVER `tailscale funnel` — this must stay tailnet-only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = join(repo, 'demo');
const shotsRoot = join(repo, 'docs', 'screenshots');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const tailnetMode = argv.includes('--tailnet');
const port = Number(flag('port') ?? process.env.PORT ?? 5181);
const host = flag('host') ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

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
    let base = demoRoot;
    if (rel === 'shots' || rel.startsWith('shots/')) {
      base = shotsRoot;
      rel = rel.slice('shots'.length).replace(/^\/+/, '');
    }
    let file = join(base, rel === '' ? 'index.html' : rel);
    if (!file.startsWith(base)) {
      res.writeHead(404).end('not found');
      return;
    }
    if (!extname(file)) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, host, () => {
  console.log(`demo → http://${host}:${port}/`);
  if (existsSync(join(shotsRoot, 'index.html'))) {
    console.log(`shots → http://${host}:${port}/shots/`);
  }
  if (tailnetMode) wireTailscale();
});

function tailscale(...args) {
  return execFileSync('tailscale', args, { encoding: 'utf8' });
}

function wireTailscale() {
  let dnsName;
  try {
    const status = JSON.parse(tailscale('status', '--json'));
    if (status.BackendState !== 'Running') {
      console.error(
        `tailscale backend state: ${status.BackendState} — run \`tailscale up\` first.`,
      );
      process.exitCode = 1;
      return;
    }
    dnsName = (status.Self?.DNSName ?? '').replace(/\.$/, '');
  } catch (err) {
    console.error('tailscale status failed — is tailscaled running?');
    console.error(String(err?.stderr ?? err));
    process.exitCode = 1;
    return;
  }
  try {
    tailscale('serve', '--bg', String(port));
    console.log('');
    console.log(`phone URL → https://${dnsName}/`);
    if (existsSync(join(shotsRoot, 'index.html'))) {
      console.log(`shots     → https://${dnsName}/shots/`);
    }
    console.log('teardown  → tailscale serve reset');
  } catch (err) {
    // Do NOT silently fall back to HTTP — surface tailscale's exact message; enabling
    // HTTPS/MagicDNS is a one-time tailnet toggle at https://login.tailscale.com/admin.
    console.error('`tailscale serve` failed. Exact output:');
    console.error(String(err?.stderr ?? err?.stdout ?? err));
    console.error('');
    console.error('If this is the HTTPS/MagicDNS-not-enabled message: enable it in the admin');
    console.error(`console, then re-run. Manual HTTP fallback (tailnet-only bind):`);
    console.error(`  node scripts/serve-demo.mjs --host $(tailscale ip -4) --port ${port}`);
    process.exitCode = 1;
  }
}
