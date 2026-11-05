// The licences of MIT, Apache and similar code ask that their notice travels with copies of it. A minified bundle drops the comments,
// so the notices of every production dependency are collected into one file that is served next to the app.
//
//   npm run licenses            writes public/third-party-licenses.txt
//   npm run licenses -- --check fails when the file is out of date (CI)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}public/third-party-licenses.txt`;
const lock = JSON.parse(readFileSync(`${ROOT}package-lock.json`, 'utf8'));

const entries = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev) continue;
  const dir = `${ROOT}${path}`;
  if (!existsSync(`${dir}/package.json`)) continue;
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  const file = readdirSync(dir).find((name) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(name));
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? '';
  const text = file ? readFileSync(`${dir}/${file}`, 'utf8').replace(/\r\n/g, '\n').trim() : `Licensed under ${license}. See ${pkg.repository?.url ?? pkg.homepage ?? 'the package page'}.`;
  entries.push({ name: pkg.name, version: pkg.version, license, text });
}
entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const body = [
  'Third-party software in this app',
  '================================',
  '',
  'This app contains the open-source packages below. Each is under its own licence; the notices follow.',
  '',
  ...entries.flatMap((e) => [`${e.name} ${e.version} (${e.license})`, '-'.repeat(60), e.text, '', '']),
].join('\n');

if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== body) {
    console.error('public/third-party-licenses.txt is out of date: run npm run licenses and commit the result');
    process.exit(1);
  }
  console.log(`OK — notices for ${entries.length} packages are up to date`);
} else {
  writeFileSync(OUT, body);
  console.log(`wrote ${OUT.replace(ROOT, '')}: ${entries.length} packages, ${Math.round(body.length / 1024)} KB`);
}
