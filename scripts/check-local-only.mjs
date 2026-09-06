// SPEC §1.1 / §11.7: the shipped bundle must contain no runtime network endpoints.
//
// Three layers (defense in depth). The *hard* guarantee is layer 3 — the manifest CSP with
// `connect-src 'none'` + `default-src 'self'`, which the browser enforces on extension pages.
// Layers 1–2 keep the bundle honest so a violation is caught at build time, not install time:
//   1. absolute http(s)/ws(s) URL literals in shipped code fail unless individually justified;
//   2. network primitives (fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon,
//      importScripts) anywhere in dist/ fail with no allowlist;
//   3. the shipped manifest must carry the connect-src 'none' CSP.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// --- Layer 1 rules ---------------------------------------------------------
// Exact-match allowlist (never prefixes — a prefix would wave through
// "https://json-schema.org.evil.example/…"). Each entry has a reason:
const ALLOWED_URLS = new Set([
  // XML namespace literals — namespace identifiers, never fetched.
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  // $id of our own interchange schema; a document identifier, never dereferenced.
  'https://occamsgarage.com/jobfill/import.schema.json',
]);

// Origin-level allowances, matched on the *parsed* URL origin (so suffix-host tricks like
// json-schema.org.evil.example fail). Used only for schema identifiers inside the vendored
// ajv meta-schemas — ajv resolves these offline and never fetches; unresolved refs throw.
const ALLOWED_ORIGINS = new Set(['https://json-schema.org', 'http://json-schema.org']);

// Path-prefix allowance for ajv's bundled data.json $ref identifier (inert, never fetched).
const ALLOWED_PREFIXES = ['https://raw.githubusercontent.com/ajv-validator/ajv/'];

// URLs on comment-only lines are ignored: comments cannot execute, and the vendored
// ajv-formats source carries provenance links (RFCs, regex sources) in comments.
function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function urlAllowed(url) {
  if (ALLOWED_URLS.has(url)) return true;
  if (ALLOWED_PREFIXES.some((p) => url.startsWith(p))) return true;
  try {
    return ALLOWED_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

// --- Layer 2: network primitives, no exceptions ----------------------------
const PRIMITIVE_RE = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/;

const URL_RE = /(?:https?|wss?):\/\/[^\s"'`)\\]+/g;
const TEXT_EXT = /\.(js|mjs|cjs|json|html|css|txt|md|svg|xml)$/i;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let failures = 0;

function fail(file, line, message) {
  console.error(`${relative(root, file)}:${line}: ${message}`);
  failures++;
}

for (const file of walk(dist)) {
  if (!TEXT_EXT.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (!isCommentLine(line)) {
      for (const match of line.matchAll(URL_RE)) {
        const url = match[0].replace(/[.,;]+$/, '');
        if (!urlAllowed(url)) fail(file, i + 1, `forbidden URL in shipped bundle: ${url}`);
      }
    }
    const primitive = PRIMITIVE_RE.exec(line);
    if (primitive) fail(file, i + 1, `network primitive "${primitive[1]}" in shipped bundle`);
  });
}

// --- Layer 3: the browser-enforced guarantee -------------------------------
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const csp = manifest.content_security_policy?.extension_pages ?? '';
for (const required of ["connect-src 'none'", "default-src 'self'"]) {
  if (!csp.includes(required)) {
    fail(join(dist, 'manifest.json'), 1, `manifest CSP must include "${required}" (got: "${csp}")`);
  }
}

if (failures > 0) {
  console.error(`\ncheck:local-only FAILED — ${failures} finding(s) in dist/. See SPEC §1.1.`);
  process.exit(1);
}
console.log('check:local-only OK — no network endpoints or primitives in dist/, CSP present');
