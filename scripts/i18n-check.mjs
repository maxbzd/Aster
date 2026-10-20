// Checks that every message used in the source exists in every translation and that translations are well-formed.
//
//   npm run i18n:check            fail on missing / malformed translations, list unused ones
//   npm run i18n:check -- --strict  also fail on unused translations
//
// Messages are found by scanning for t('…'), tn(n, '…', '…'), tx('…', …) and msg('…') calls with literal keys.
// Keep keys literal (no template strings with ${…}, no variables): that is what makes this check complete.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')
const LOCALES = join(SRC, 'i18n', 'locales')
const CTX = '\u0004'
const strict = process.argv.includes('--strict')

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) yield p
  }
}

/** Reads a JS string literal starting at `i` (which points at the quote). Returns [value, indexAfter] or null for templates with ${}. */
function readString(src, i) {
  const q = src[i]
  let out = ''
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]
    if (c === '\\') {
      const n = src[++j]
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' ? String.fromCharCode(parseInt(src.slice(j + 1, j + 5), 16)) : n
      if (n === 'u') j += 4
    } else if (c === q) return [out, j + 1]
    else if (q === '`' && c === '$' && src[j + 1] === '{') return null
    else out += c
  }
  return null
}

/** Splits the argument list of a call starting right after "(" into [text, start] pieces, respecting brackets and strings. */
function splitArgs(src, i) {
  const args = []
  let depth = 0
  let start = i
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (c === '"' || c === "'" || c === '`') {
      let k = j + 1
      while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++ }
      j = k
    } else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) { args.push([src.slice(start, j), start]); return args }
      depth--
    } else if (c === ',' && depth === 0) { args.push([src.slice(start, j), start]); start = j + 1 }
  }
  return args
}

const literal = (arg) => {
  const [text, start] = arg
  const t = text.trimStart()
  const off = start + (text.length - t.length)
  if (!t || !'"\'`'.includes(t[0])) return null
  const r = readString(arg.src ?? '', off)
  return r ? r[0] : null
}

const used = new Map() // key -> { plural: boolean, files: Set }
const dynamic = []
const CALL = /(?<![\w$.])(?<!get )(t|tn|tx|msg)\((?!\?)/g

for (const file of walk(SRC)) {
  if (file.startsWith(join(SRC, 'i18n'))) continue
  const src = readFileSync(file, 'utf8')
  let m
  while ((m = CALL.exec(src))) {
    const kind = m[1]
    const args = splitArgs(src, m.index + m[0].length).map(a => Object.assign(a, { src }))
    // t('key', vars?, ctx?)   tn(n, 'one', 'other', vars?, ctx?)   tx('key', vars, ctx?)   msg('key')
    const keyArg = kind === 'tn' ? args[1] : args[0]
    const ctxArg = kind === 't' || kind === 'tx' ? args[kind === 't' ? 2 : 2] : kind === 'tn' ? args[4] : undefined
    if (!keyArg) continue
    const key = literal(keyArg)
    const line = src.slice(0, m.index).split('\n').length
    if (key === null) {
      // only report calls that look like real translations (a non-literal first argument that is not a plain identifier-based lookup is fine for msg()-marked values)
      if (kind !== 'msg') dynamic.push(`${relative(ROOT, file)}:${line}: ${kind}(${keyArg[0].trim().slice(0, 50)})`)
      continue
    }
    const ctx = ctxArg ? literal(ctxArg) : null
    const full = ctx ? ctx + CTX + key : key
    const e = used.get(full) ?? { plural: false, files: new Set() }
    if (kind === 'tn') e.plural = true
    e.files.add(`${relative(ROOT, file)}:${line}`)
    used.set(full, e)
  }
}

let problems = 0
const report = (msg) => { problems++; console.error(msg) }
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort().join(',')

for (const file of readdirSync(LOCALES).filter(f => f.endsWith('.json'))) {
  const locale = file.replace(/\.json$/, '')
  const dict = JSON.parse(readFileSync(join(LOCALES, file), 'utf8'))
  const missing = []
  const malformed = []
  for (const [key, info] of used) {
    const entry = dict[key]
    const shown = key.replace(CTX, ' ⟨ctx⟩ ')
    if (entry === undefined) { missing.push(`${shown}   (${[...info.files][0]})`); continue }
    if (info.plural && !Array.isArray(entry)) malformed.push(`${shown}: plural message needs an array of forms`)
    if (!info.plural && typeof entry !== 'string') malformed.push(`${shown}: expected a string`)
    const base = key.includes(CTX) ? key.split(CTX)[1] : key
    const forms = Array.isArray(entry) ? entry : [entry]
    for (const f of forms) {
      if (typeof f !== 'string') { malformed.push(`${shown}: non-string form`); continue }
      // plural messages may drop {n} in a form ("год назад"), but may not invent placeholders
      const want = new Set(placeholders(base).split(',').filter(Boolean))
      if (info.plural) want.add('n')
      const got = placeholders(f).split(',').filter(Boolean)
      for (const g of got) if (!want.has(g)) malformed.push(`${shown}: unknown placeholder {${g}} in "${f}"`)
      if (!info.plural) for (const w of want) if (!got.includes(w)) malformed.push(`${shown}: placeholder {${w}} missing in "${f}"`)
    }
  }
  const unused = Object.keys(dict).filter(k => !used.has(k))
  console.log(`[${locale}] ${used.size} messages used, ${Object.keys(dict).length} translated, ${missing.length} missing, ${malformed.length} malformed, ${unused.length} unused`)
  for (const x of missing) report(`  missing    ${x}`)
  for (const x of malformed) report(`  malformed  ${x}`)
  if (unused.length) {
    console.log(`  unused (${unused.length}):`)
    for (const x of unused.slice(0, 40)) console.log(`    ${x.replace(CTX, ' ⟨ctx⟩ ').slice(0, 110)}`)
    if (strict) problems += unused.length
  }
}

if (dynamic.length) {
  console.log(`\nCalls with a non-literal key (cannot be checked, make sure the strings are marked with msg()):`)
  for (const d of dynamic) console.log(`  ${d}`)
}

if (problems) { console.error(`\n${problems} problem(s).`); process.exit(1) }
console.log('\nOK')
