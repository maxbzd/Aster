// Compatibility guard that needs no other browser: every JavaScript file in the build must parse as ES2022, so no syntax newer than
// Chrome 94, Firefox 93 and Safari 15.4 ships by accident (a dependency can bring it in without a word). This does not replace
// running the app in Firefox and Safari; it only keeps the door they need open.
//
//   npm run build && npm run check:syntax
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'acorn';

const DIR = new URL('../dist/assets/', import.meta.url);
const files = readdirSync(DIR).filter((name) => name.endsWith('.js'));
if (!files.length) throw new Error('no build output: run npm run build first');
const bad = [];
for (const name of files) {
  try {
    parse(readFileSync(new URL(name, DIR), 'utf8'), { ecmaVersion: 2022, sourceType: 'module' });
  } catch (error) {
    bad.push(`${name}: ${String(error.message).slice(0, 100)}`);
  }
}
if (bad.length) {
  console.error(`${bad.length} of ${files.length} files use syntax newer than ES2022:\n${bad.join('\n')}`);
  process.exit(1);
}
console.log(`OK — all ${files.length} JavaScript files are ES2022`);
