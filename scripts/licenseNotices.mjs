// The licences of MIT, Apache and similar code ask that their notice travels with copies of it. A minified bundle drops the comments,
// so the notices of every production dependency are collected into one file that the build serves next to the app
// (/third-party-licenses.txt). It is made from the lock file at every build, so a dependency update can never leave it stale.
import { existsSync, readdirSync, readFileSync } from 'node:fs';

export function licenseNotices(root) {
  const lock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8'));
  const entries = [];
  for (const [path, info] of Object.entries(lock.packages)) {
    if (!path || info.dev) continue; // the root, and tools that are not shipped
    const dir = `${root}/${path}`;
    if (!existsSync(`${dir}/package.json`)) continue; // optional platform packages that were not installed
    const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
    const file = readdirSync(dir).find((name) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(name));
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? '');
    const text = file ? readFileSync(`${dir}/${file}`, 'utf8').replace(/\r\n/g, '\n').trim() : `Licensed under ${license}. See ${pkg.repository?.url ?? pkg.homepage ?? 'the package page'}.`;
    entries.push({ name: pkg.name, version: pkg.version, license, text });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return [
    'Third-party software in this app',
    '================================',
    '',
    'This app contains the open-source packages below. Each is under its own licence; the notices follow.',
    '',
    ...entries.flatMap((e) => [`${e.name} ${e.version} (${e.license})`, '-'.repeat(60), e.text, '', '']),
  ].join('\n');
}
