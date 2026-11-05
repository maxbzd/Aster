// Documentation must not point at files that do not exist: every relative link in every Markdown file is checked.
//
//   npm run check:docs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage']);

function* markdown(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* markdown(path);
    else if (name.endsWith('.md')) yield path;
  }
}

const broken = [];
let files = 0;
for (const file of markdown(ROOT)) {
  files++;
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = target.split('#')[0];
    if (path && !existsSync(normalize(join(dirname(file), path)))) broken.push(`${relative(ROOT, file)}: ${target}`);
  }
}
if (broken.length) {
  console.error(`${broken.length} broken link(s):\n${broken.join('\n')}`);
  process.exit(1);
}
console.log(`OK — ${files} Markdown files, every relative link resolves`);
