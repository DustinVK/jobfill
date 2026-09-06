// SPEC §1.1 / §11.7: the shipped bundle must contain no runtime network endpoints.
// Fails on any absolute http(s)/ws(s) URL in dist/ that is not an explicitly justified exception.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// Each exception needs a comment saying why it is inert at runtime.
const ALLOWED = [
  // XML namespace literal in inline SVG markup — a namespace identifier, never fetched.
  'http://www.w3.org/2000/svg',
  // JSON Schema dialect identifier used by ajv for meta-validation — resolved offline from the bundled meta-schema.
  'https://json-schema.org/draft/2020-12/schema',
  // $id of our own interchange schema; a document identifier, never dereferenced by the extension.
  'https://occamsgarage.com/jobfill/import.schema.json',
  // XML namespace identifiers emitted by Preact's createElementNS paths. Namespaces are names,
  // not addresses — the browser never fetches them.
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
];

const URL_RE = /(?:https?|wss?):\/\/[^\s"'`)\\]+/g;
const TEXT_EXT = /\.(js|mjs|cjs|json|html|css|txt|md)$/i;

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
for (const file of walk(dist)) {
  if (!TEXT_EXT.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const match of line.matchAll(URL_RE)) {
      const url = match[0].replace(/[.,;]+$/, '');
      if (ALLOWED.some((a) => url.startsWith(a))) continue;
      console.error(`${relative(root, file)}:${i + 1}: forbidden URL in shipped bundle: ${url}`);
      failures++;
    }
  });
}

if (failures > 0) {
  console.error(`\ncheck:local-only FAILED — ${failures} URL(s) in dist/. See SPEC §1.1.`);
  process.exit(1);
}
console.log('check:local-only OK — no network endpoints in dist/');
