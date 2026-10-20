/** Мини-упаковщик zip для тестов: собираем настоящий .xlsx без внешних библиотек. */

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const u16 = (n: number) => [n & 255, (n >> 8) & 255]
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]

export async function makeZip(files: Record<string, string>, opts: { store?: boolean } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: number[][] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text)
    const method = opts.store ? 0 : 8
    const body = opts.store ? raw : await deflateRaw(raw)
    const nameBytes = enc.encode(name)
    const header = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(raw.length), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ])
    chunks.push(header, body)
    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes,
    ])
    offset += header.length + body.length
  }
  const cd = new Uint8Array(central.flat())
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cd.length), ...u32(offset), ...u16(0)])
  const out = new Uint8Array(offset + cd.length + end.length)
  let pos = 0
  for (const c of [...chunks, cd, end]) { out.set(c, pos); pos += c.length }
  return out
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const colLetter = (i: number) => String.fromCharCode(65 + i)

/** Таблица значений → содержимое xlsx. Числа пишутся числами, строки — через sharedStrings (как делает Excel). */
export async function makeXlsx(rows: (string | number | null)[][], opts: { inline?: boolean; store?: boolean } = {}): Promise<Uint8Array> {
  const shared: string[] = []
  const idx = (s: string) => { const i = shared.indexOf(s); if (i >= 0) return i; shared.push(s); return shared.length - 1 }
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      if (v === null || v === '') return ''
      const ref = `${colLetter(c)}${r + 1}`
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`
      return opts.inline ? `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>` : `<c r="${ref}" t="s"><v>${idx(v)}</v></c>`
    }).join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  return makeZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="${ns}"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ...(opts.inline ? {} : { 'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="${ns}">${shared.map(s => `<si><t>${esc(s)}</t></si>`).join('')}</sst>` }),
  }, { store: opts.store })
}
