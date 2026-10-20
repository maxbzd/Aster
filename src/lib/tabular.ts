import { t } from '@/i18n'
/**
 * Чтение файлов со списками контактов: .xlsx, .csv/.tsv, .json, .vcf, текст.
 * Без внешних библиотек: xlsx — это zip с XML, распаковываем встроенным DecompressionStream.
 */

export type FileRead =
  | { kind: 'table'; rows: string[][]; label: string }
  | { kind: 'vcf'; text: string }
  | { kind: 'text'; text: string }

export class FileReadError extends Error {}

/* ---------- Кодировки ---------- */

export function decodeText(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf)
  if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf).replace(/^﻿/, '')
  if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(buf).replace(/^﻿/, '')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    // Excel на русской Windows сохраняет CSV в windows-1251
    return new TextDecoder('windows-1251').decode(buf)
  }
}

/* ---------- CSV / TSV ---------- */

function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 4000).split(/\r?\n/).filter(Boolean).slice(0, 8)
  let best = ','
  let bestScore = 0
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map(l => {
      let n = 0
      let q = false
      for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++ }
      return n
    })
    const min = Math.min(...counts)
    const score = min > 0 ? min * 10 + counts.filter(c => c === counts[0]).length : 0
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best
}

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? sniffDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch
    } else if (ch === '"' && cell === '') q = true
    else if (ch === d) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean))
}

/* ---------- XLSX ---------- */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

interface ZipEntry { name: string; method: number; compSize: number; offset: number }

function readZipDirectory(buf: ArrayBuffer): Map<string, ZipEntry> {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new FileReadError(t("The file is corrupted or isn't an .xlsx spreadsheet"))
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out = new Map<string, ZipEntry>()
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const compSize = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const offset = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    out.set(name, { name, method, compSize, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function zipText(buf: ArrayBuffer, dir: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const e = dir.get(name)
  if (!e) return null
  const v = new DataView(buf)
  const nameLen = v.getUint16(e.offset + 26, true)
  const extraLen = v.getUint16(e.offset + 28, true)
  const start = e.offset + 30 + nameLen + extraLen
  const raw = new Uint8Array(buf, start, e.compSize)
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null
  if (!bytes) throw new FileReadError(t("This .xlsx compression variant isn't supported — save the spreadsheet as .csv"))
  return new TextDecoder().decode(bytes)
}

const colIndex = (ref: string) => {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
const textOf = (el: Element | null | undefined) => Array.from(el?.getElementsByTagName('t') ?? []).map(el => el.textContent ?? '').join('')

export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const dir = readZipDirectory(buf)
  if (!dir.has('xl/workbook.xml')) throw new FileReadError(t('No Excel table in the file'))

  // общий словарь строк
  const shared: string[] = []
  const ss = await zipText(buf, dir, 'xl/sharedStrings.xml')
  if (ss) for (const si of Array.from(xml(ss).getElementsByTagName('si'))) shared.push(textOf(si))

  // первый лист (по порядку в книге), запасной — sheet1
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wb = xml((await zipText(buf, dir, 'xl/workbook.xml')) ?? '')
  const rels = await zipText(buf, dir, 'xl/_rels/workbook.xml.rels')
  const firstSheet = wb.getElementsByTagName('sheet')[0]
  const rid = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  if (rels && rid) {
    const rel = Array.from(xml(rels).getElementsByTagName('Relationship')).find(r => r.getAttribute('Id') === rid)
    const target = rel?.getAttribute('Target')
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  }
  const sheetXml = await zipText(buf, dir, sheetPath)
  if (!sheetXml) throw new FileReadError(t("Couldn't find a sheet in the file"))

  const rows: string[][] = []
  for (const r of Array.from(xml(sheetXml).getElementsByTagName('row'))) {
    const out: string[] = []
    let next = 0
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r')
      const idx = ref ? colIndex(ref) : next
      next = idx + 1
      const value = c.getAttribute('t')
      let val = ''
      if (value === 'inlineStr') val = textOf(c.getElementsByTagName('is')[0])
      else {
        const raw = c.getElementsByTagName('v')[0]?.textContent ?? ''
        if (value === 's') val = shared[Number(raw)] ?? ''
        else if (value === 'b') val = raw === '1' ? t('yes') : t('none')
        else if (/^-?\d+(\.\d+)?[eE]\+\d+$/.test(raw)) val = BigInt(Math.round(Number(raw))).toString()
        else val = raw
      }
      out[idx] = val.trim()
    }
    for (let i = 0; i < out.length; i++) out[i] ??= ''
    rows.push(out)
  }
  return rows.filter(r => r.some(Boolean))
}

/* ---------- JSON ---------- */

function jsonToRows(data: unknown): string[][] {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data as object).find(Array.isArray) : null
  if (!Array.isArray(list) || !list.length) throw new FileReadError(t("Couldn't find a list of contacts in the JSON"))
  if (list.every(x => typeof x === 'string')) return (list as string[]).map(s => [s])
  const objs = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
  const keys = [...new Set(objs.flatMap(o => Object.keys(o)))]
  const flat = (v: unknown): string => (v == null ? '' : Array.isArray(v) ? v.map(flat).join(', ') : typeof v === 'object' ? Object.values(v as object).map(flat).join(' ') : String(v))
  return [keys, ...objs.map(o => keys.map(k => flat(o[k])))]
}

/* ---------- Вход ---------- */

const looksTabular = (text: string) => {
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 6)
  return lines.length >= 2 && lines.every(l => (l.match(/\t/g) ?? []).length >= 1 && (l.match(/\t/g) ?? []).length === (lines[0].match(/\t/g) ?? []).length)
}

export function classifyText(text: string): FileRead {
  if (/BEGIN:VCARD/i.test(text)) return { kind: 'vcf', text }
  if (looksTabular(text)) return { kind: 'table', rows: parseDelimited(text, '\t'), label: t('Pasted text') }
  return { kind: 'text', text }
}

export async function readContactsFile(file: File): Promise<FileRead> {
  const name = file.name.toLowerCase()
  const label = file.name
  const buf = await file.arrayBuffer()
  const head = new Uint8Array(buf.slice(0, 4))
  const isZip = head[0] === 0x50 && head[1] === 0x4b
  const isOle = head[0] === 0xd0 && head[1] === 0xcf // старый .xls

  if (isOle || /\.xls$/.test(name)) throw new FileReadError(t('This is the old .xls format — save the spreadsheet as .xlsx or .csv and upload again'))
  if (/\.(numbers|pages|key)$/.test(name)) throw new FileReadError(t('From Numbers, export the table to .csv or .xlsx (File → Export)'))
  if (/\.(pdf|docx?|pptx?|png|jpe?g|heic)$/.test(name)) throw new FileReadError(t("Contacts can't be extracted from PDF, Word and images — copy the text and paste it into the field below"))

  if (isZip || /\.(xlsx|xlsm)$/.test(name)) {
    if (!isZip) throw new FileReadError(t("The file doesn't look like an Excel table"))
    const rows = await readXlsx(buf)
    if (!rows.length) throw new FileReadError(t('The table is empty'))
    return { kind: 'table', rows, label }
  }

  const text = decodeText(buf)
  if (/\.json$/.test(name)) {
    try { return { kind: 'table', rows: jsonToRows(JSON.parse(text)), label } } catch (e) {
      throw e instanceof FileReadError ? e : new FileReadError(t("Couldn't read the JSON"))
    }
  }
  if (/\.vcf$/.test(name) || /BEGIN:VCARD/i.test(text.slice(0, 200))) return { kind: 'vcf', text }
  if (/\.(csv|tsv)$/.test(name)) return { kind: 'table', rows: parseDelimited(text), label }
  const c = classifyText(text)
  return c.kind === 'table' ? { ...c, label } : c
}

/* ---------- Шаблон ---------- */

export const templateCsv = () =>
  t('﻿First name,Last name,Company,Position,Phone,Email,Telegram,City,Tags,Why valuable,Source\n') +
  t('John,Smith,Northwind Capital,Partner,+971 50 123 4567,ivan@northwind.vc,@john_smith,Dubai,"Investor, Fintech",Invests in seed in MENA,Web Summit\n') +
  t('Anna,Lee,,Deal lawyer,,anna@lawfirm.com,,London,Lawyer,Corporate law and M&A,Referral from Alina\n')
