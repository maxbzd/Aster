// Builds the app twice, from the same source, in two clean folders, and checks that every file comes out byte for byte the same.
// A build that depends on the clock, the folder or the run cannot be checked by anyone else: with this one, anybody can
// build the published commit and compare the fingerprint below with the files that are served.
//
//   npm run check:reproducible
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const work = mkdtempSync(join(tmpdir(), 'reproducible-'))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

function files(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path, base) : [relative(base, path)]
  })
}

function build(name) {
  const dir = join(work, name)
  const result = spawnSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { env: { ...process.env, BUILD_TAG: 'reproducible' }, stdio: 'inherit' })
  assert.equal(result.status, 0, `the build "${name}" failed`)
  return Object.fromEntries(files(dir).sort().map((file) => [file, sha(readFileSync(join(dir, file)))]))
}

const first = build('first')
const second = build('second')
const names = [...new Set([...Object.keys(first), ...Object.keys(second)])].sort()
const different = names.filter((name) => first[name] !== second[name])
assert.deepEqual(different, [], `these files differ between two builds of the same source:\n  ${different.join('\n  ')}`)
console.log(`${names.length} files, identical in both builds`)
console.log(`fingerprint (sha256 of the list of names and hashes): ${sha(names.map((name) => `${name} ${first[name]}`).join('\n'))}`)
