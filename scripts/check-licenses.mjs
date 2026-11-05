// Everything that ships inside the app must be under a licence that lets an open-source project (and anyone who copies it) use it:
// the licence of each production dependency is read from the lock file and compared with a short list of permissive ones.
// A new dependency under any other licence (GPL, AGPL, "unknown") fails the build until someone decides on purpose.
//
//   npm run check:licenses
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const ALLOWED = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|Unlicense|CC0-1\.0|OFL-1\.1|BlueOak-1\.0\.0|Python-2\.0)$/;
const lock = JSON.parse(readFileSync(`${ROOT}package-lock.json`, 'utf8'));

const bad = [];
const seen = new Map();
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev) continue; // the root, and tools that are not shipped
  const manifest = `${ROOT}${path}/package.json`;
  if (!existsSync(manifest)) continue; // optional platform packages that were not installed
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (pkg.licenses ?? []).map((l) => l.type).join(' OR ');
  seen.set(license, (seen.get(license) ?? 0) + 1);
  // "(MIT OR Apache-2.0)" is fine when every alternative is allowed; AND needs all of them
  const parts = String(license).replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/);
  if (!parts.every((part) => ALLOWED.test(part))) bad.push(`${path.replace('node_modules/', '')}: ${license || 'no licence'}`);
}
if (bad.length) {
  console.error(`Production dependencies under a licence that is not on the list:\n${bad.join('\n')}`);
  process.exit(1);
}
console.log(`OK — ${[...seen.values()].reduce((a, b) => a + b, 0)} production dependencies, all permissive: ${[...seen].map(([k, v]) => `${k} ${v}`).join(', ')}`);
