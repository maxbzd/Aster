import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowLeftIcon, ClipboardTextIcon, DownloadSimpleIcon, FileArrowUpIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { PrimaryButton } from '@/components/ui'
import { Field, FormGroup, TextInput } from '@/components/forms'
import { SelectField } from '@/components/pickers'
import { Switch, TagInput, TagPill } from '@/components/reserve/parts'
import { addLeads, undoBatch } from '@/data/leads'
import { uid } from '@/data/db'
import {
  ROLE_LABEL, ROLE_ORDER, suggestedTags, autoTags, classify, detectHeader, guessRoles, parseTextList, rowToParsed, toLead, leadText,
  type ParsedLead, type Role,
} from '@/data/leadParse'
import { parseVCards } from '@/data/vcard'
import { useLeads, usePeople } from '@/data/hooks'
import { FileReadError, templateCsv, classifyText, readContactsFile, type FileRead } from '@/lib/tabular'
import { download } from '@/lib/ics'
import { pickFile } from '@/lib/image'
import { fullName } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import { leadLine } from '@/ai/local/reserve'
import { t, tn } from '@/i18n'

type Stage = 'pick' | 'map' | 'review'

const uniq = (a: string[]) => [...new Set(a)]
const colName = (i: number) => String.fromCharCode(65 + (i % 26))
const ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt,.vcf,.json,text/csv,text/plain,text/vcard'

/** List import: a file (xlsx, csv, vcf, json, txt) or pasted text → parsing → review → "add everyone". */
export function LeadImportSheet({ file: file0, text: text0, onClose }: { file?: File; text?: string; onClose: () => void }) {
  const leads = useLeads()
  const people = usePeople()
  const toast = useUI(s => s.toast)
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [stage, setStage] = useState<Stage>('pick')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [label, setLabel] = useState('')
  const [fromFile, setFromFile] = useState('')
  const [paste, setPaste] = useState(text0 ?? '')
  // data
  const [rows, setRows] = useState<string[][] | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [roles, setRoles] = useState<Role[]>([])
  const [flat, setFlat] = useState<ParsedLead[] | null>(null)
  // parameters
  const [tags, setTags] = useState<string[]>([])
  const [source, setSource] = useState('')
  const [auto, setAuto] = useState(true)
  const [skipDups, setSkipDups] = useState(true)

  const ingest = (r: FileRead, name: string) => {
    setError('')
    setLabel(name)
    if (r.kind === 'vcf') {
      const list = parseVCards(r.text).map(p => ({ firstName: p.firstName, lastName: p.lastName, company: p.company, role: p.role, city: p.city, notes: p.notes, tags: [] as string[], channels: p.channels }))
      if (!list.length) return setError(t('No contacts found in the file'))
      setFlat(list); setRows(null); setStage('review')
    } else if (r.kind === 'text') {
      const list = parseTextList(r.text)
      if (!list.length) return setError(t("Couldn't find any contacts — paste one person per line"))
      setFlat(list); setRows(null); setStage('review')
    } else {
      const header = detectHeader(r.rows)
      const body = header ? r.rows.slice(1) : r.rows
      const cols = Math.max(...r.rows.slice(0, 50).map(x => x.length))
      if (cols <= 1) {
        const list = parseTextList(body.map(x => x[0] ?? '').join('\n'))
        if (!list.length) return setError(t("Couldn't find any contacts"))
        setFlat(list); setRows(null); setStage('review')
        return
      }
      setRows(r.rows); setHasHeader(header); setFlat(null)
      setRoles(guessRoles(header ? r.rows[0] : null, body))
      setStage('map')
    }
  }

  const readFile = async (f: File) => {
    setBusy(true); setError('')
    try { const name = f.name.replace(/\.[^.]+$/, ''); ingest(await readContactsFile(f), name); setFromFile(name) } catch (e) {
      setError(e instanceof FileReadError ? e.message : t("Couldn't read the file. Try saving it as .csv or .xlsx"))
    } finally { setBusy(false) }
  }

  const analyzePaste = () => {
    const query = paste.trim()
    if (!query) return
    const r = classifyText(query)
    setFromFile('')
    ingest(r, t('Pasted list'))
  }

  useEffect(() => { if (file0) readFile(file0) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (text0) analyzePaste() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // changing the header recomputes the roles
  const toggleHeader = (v: boolean) => {
    if (!rows) return
    setHasHeader(v)
    setRoles(guessRoles(v ? rows[0] : null, v ? rows.slice(1) : rows))
  }

  const parsed = useMemo<ParsedLead[]>(() => {
    if (rows) return (hasHeader ? rows.slice(1) : rows).map(r => rowToParsed(r, roles, { autoTags: auto })).filter((p): p is ParsedLead => !!p)
    return (flat ?? []).map(p => ({ ...p, tags: auto ? uniq([...p.tags, ...autoTags(leadText({ ...p, tags: [] }))]).slice(0, 3) : [] }))
  }, [rows, hasHeader, roles, flat, auto])

  const classified = useMemo(() => classify(parsed, leads ?? [], people ?? []), [parsed, leads, people])
  const counts = useMemo(() => ({
    fresh: classified.filter(c => c.kind === 'new').length,
    lead: classified.filter(c => c.kind === 'lead').length,
    person: classified.filter(c => c.kind === 'person').length,
    file: classified.filter(c => c.kind === 'file').length,
  }), [classified])
  const toAdd = useMemo(() => classified.filter(c => (skipDups ? c.kind === 'new' : true)), [classified, skipDups])
  const skipped = classified.filter(c => !toAdd.includes(c))

  const tagSuggestions = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of leads ?? []) for (const item of l.tags) m.set(item, (m.get(item) ?? 0) + 1)
    return uniq([...[...m.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]), ...suggestedTags()])
  }, [leads])

  const run = async () => {
    if (!toAdd.length) return
    haptic(14)
    setBusy(true)
    const batchId = uid()
    const base = Date.now()
    const n = toAdd.length
    await addLeads(toAdd.map((c, i) => toLead(c.parsed, { tags, source: source.trim() || undefined, batchId, createdAt: base + (n - i) })))
    onClose()
    if (!pathname.startsWith('/reserve')) nav('/reserve')
    toast(t('In reserve: +{pl}', { pl: tn(n, '{n} contact', '{n} contacts') }), 'check', {
      label: t('Undo import'),
      run: async () => { const k = await undoBatch(batchId); toast(t('Import undone · removed {k}', { k }), 'info') },
    })
  }

  const back = () => {
    if (stage === 'review' && rows) setStage('map')
    else { setStage('pick'); setError('') }
  }

  const sample = (i: number) => (hasHeader ? rows!.slice(1) : rows!).slice(0, 40).map(r => (r[i] ?? '').trim()).filter(Boolean).slice(0, 3)
  const cols = rows ? Math.max(...rows.slice(0, 50).map(r => r.length)) : 0

  const title = stage === 'pick' ? t('Upload a list') : stage === 'map' ? t("What's in the columns?") : t('Review and add')
  const subtitle = stage === 'pick' ? t("A file or text — I'll add everyone at once")
    : stage === 'map' ? `${tn(parsed.length, '{n} contact', '{n} contacts')} · ${label}`
    : `${label} · ${tn(parsed.length, '{n} contact', '{n} contacts')}`

  return (
    <Sheet onClose={onClose} tall glow="rgb(95 227 176 / 0.22)"
      title={<span className="flex items-center gap-3">{stage !== 'pick' && <button type="button" aria-label={t('Back')} onClick={back} className="press -ml-1 grid h-8 w-8 place-items-center rounded-full bg-white/[0.08]"><ArrowLeftIcon size={16} /></button>}{title}</span>}
      subtitle={subtitle}
      footer={stage === 'map' ? (
        <PrimaryButton className="w-full" disabled={!parsed.length} onClick={() => setStage('review')}>{parsed.length ? t('Next · {pl}', { pl: tn(parsed.length, '{n} contact', '{n} contacts') }) : t('Pick the name or contact column')}</PrimaryButton>
      ) : stage === 'review' ? (
        <PrimaryButton className="w-full" disabled={!toAdd.length || busy} onClick={run}>{busy ? t('Adding…') : toAdd.length ? t('Add {count} to reserve', { count: toAdd.length }) : t('No one to add')}</PrimaryButton>
      ) : (
        <PrimaryButton className="w-full" disabled={!paste.trim() || busy} onClick={analyzePaste}>{t('Parse text')}</PrimaryButton>
      )}>

      {error && (
        <div className="mt-1 flex items-start gap-3 rounded-[18px] border border-danger/30 bg-danger/[0.08] px-4 py-3">
          <WarningCircleIcon size={20} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[14px] leading-snug text-fg-2">{error}</p>
        </div>
      )}

      {stage === 'pick' && (
        <div onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f) }}>
          <button type="button" disabled={busy} onClick={async () => { const f = await pickFile(ACCEPT); if (f) readFile(f) }}
            className={`press glass glow-card mt-2 flex w-full flex-col items-center gap-2 rounded-[26px] px-6 py-8 text-center transition-colors ${dragging ? '!border-mint/60' : ''}`}
            style={{ ['--glow' as string]: 'rgb(95 227 176 / 0.28)', ['--gx' as string]: '50%', ['--gy' as string]: '0%' }}>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/[0.08] text-mint"><FileArrowUpIcon size={28} weight="duotone" /></span>
            <span className="text-[18px] font-semibold">{busy ? t('Reading the file…') : dragging ? t('Drop the file here') : t('Choose a file')}</span>
            <span className="text-[13px] text-fg-3">{t('Excel (.xlsx), CSV, .vcf contacts, text, JSON')}</span>
          </button>

          <div className="my-5 flex items-center gap-3 text-[12.5px] text-fg-4"><span className="h-px flex-1 bg-line" />{' '}{t('or paste a list')}{' '}<span className="h-px flex-1 bg-line" /></div>

          <div className="glass rounded-[22px] p-4">
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={6} spellCheck={false}
              placeholder={t('One person per line:\nJohn Smith — fund, Dubai, @john\nAnna Lee, lawyer, anna@law.com\n\nOr copy cells from Excel / Google Sheets and paste them here')}
              className="field resize-none text-[15px] leading-relaxed" />
            <div className="mt-2 flex items-center gap-2 border-t border-line pt-2.5">
              {typeof navigator !== 'undefined' && !!navigator.clipboard?.readText && (
                <button type="button" onClick={async () => { try { setPaste(await navigator.clipboard.readText()) } catch { toast(t('No clipboard access'), 'info') } }} className="press flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 text-[13px] text-fg-2"><ClipboardTextIcon size={14} />{' '}{t('From clipboard')}</button>
              )}
              <span className="ml-auto text-[12px] text-fg-4">{paste.trim() ? t('{count} rows', { count: paste.trim().split('\n').length }) : ''}</span>
            </div>
          </div>

          <div className="mt-5 space-y-2 px-1 text-[13px] leading-relaxed text-fg-3">
            <p>{t("I understand LinkedIn, Telegram and Instagram links, emails and phone numbers. From the description I'll pull tags — “investor”, “lawyer”, “designer” — and the city.")}</p>
            <button type="button" onClick={() => { download('aster-reserve-template.csv', templateCsv(), 'text/csv'); toast(t('Template downloaded')) }} className="press flex items-center gap-1.5 text-fg-2 hover:text-fg"><DownloadSimpleIcon size={15} />{' '}{t('Download a table template')}</button>
          </div>
        </div>
      )}

      {stage === 'map' && rows && (
        <div className="pt-1">
          <button type="button" onClick={() => toggleHeader(!hasHeader)} className="press flex w-full items-center gap-3 rounded-[18px] border border-line bg-white/[0.04] px-4 py-3 text-left">
            <span className="flex-1 text-[15px]">{t('First row is the headers')}</span>
            <Switch on={hasHeader} />
          </button>

          <div className="mt-4 space-y-2">
            {Array.from({ length: cols }, (_, i) => (
              <div key={i} className="glass rounded-[20px] p-3.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="micro text-fg-4">{t('Column')}{' '}{colName(i)}</div>
                    <div className="truncate text-[15px] font-medium">{hasHeader && rows[0]?.[i] ? rows[0][i] : t('Untitled')}</div>
                  </div>
                  <SelectField value={roles[i] ?? 'skip'} onChange={v => setRoles(r => r.map((x, j) => (j === i ? v : x)))} label={t('Column {colName}: what is it', { colName: colName(i) })} variant="none" width={240}
                    className={`h-10 max-w-[170px] shrink-0 rounded-[14px] border px-3 text-[14px] ${roles[i] && roles[i] !== 'skip' ? 'border-mint/30 bg-mint/[0.08]' : 'border-line bg-white/[0.05] text-fg-3'}`}
                    options={ROLE_ORDER.map(r => ({ value: r, label: ROLE_LABEL[r] }))} />
                </div>
                <div className="mt-2 truncate text-[12.5px] text-fg-3">{sample(i).join('  ·  ') || t('— empty —')}</div>
              </div>
            ))}
          </div>

          {parsed.length > 0 && (
            <div className="mt-5">
              <div className="micro mb-2 px-1 text-fg-3">{t('This is how the first ones will look')}</div>
              <div className="glass rows overflow-hidden rounded-[22px]">
                {parsed.slice(0, 3).map((p, i) => <PreviewRow key={i} p={p} i={i} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {stage === 'review' && (
        <div className="pt-1">
          <div className="glass glow-card flex items-center gap-4 rounded-[24px] p-5" style={{ ['--glow' as string]: 'rgb(95 227 176 / 0.25)', ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
            <div className="tnum text-[44px] font-semibold leading-none tracking-[-0.04em]">{toAdd.length}</div>
            <div className="min-w-0 flex-1 text-[14px] leading-snug text-fg-2">
              {tn(toAdd.length, 'contact will be added', 'contacts will be added')}
              {skipped.length > 0 && <div className="text-[12.5px] text-fg-3">{t('skipping')}{' '}{skipped.length}: {[counts.lead && t('{lead} already in reserve', { lead: counts.lead }), counts.person && t('{person} already in network', { person: counts.person }), counts.file && t('{file} duplicates in the file', { file: counts.file })].filter(Boolean).join(', ')}</div>}
            </div>
          </div>

          {toAdd.length > 0 && (
            <div className="mt-4">
              <div className="micro mb-2 px-1 text-fg-3">{t('First from the list')}</div>
              <div className="glass rows overflow-hidden rounded-[22px]">
                {toAdd.slice(0, 6).map((c, i) => <PreviewRow key={i} p={{ ...c.parsed, tags: uniq([...tags, ...c.parsed.tags]).slice(0, 3) }} i={i} />)}
              </div>
              {toAdd.length > 6 && <div className="mt-2 px-2 text-[13px] text-fg-3">{t('…and more')}{' '}{toAdd.length - 6}</div>}
            </div>
          )}

          <FormGroup title={t('For everyone on the list')}>
            <Field label={t('Where this list is from')}>
              <TextInput value={source} onChange={e => setSource(e.target.value)} placeholder={fromFile ? t('For example: “{fromFile}”', { fromFile }) : t("Web Summit, a founders' chat, via Alina…")} />
              {!source && fromFile && <button type="button" onClick={() => setSource(fromFile)} className="press mt-2 text-[12.5px] text-fg-3 hover:text-fg-2">{t('Use “')}{fromFile}»</button>}
            </Field>
            <div className="px-4 py-3.5">
              <span className="micro mb-2 block text-fg-3">{t('Shared tags')}</span>
              <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder={t('Add a tag for everyone… Enter')} />
            </div>
          </FormGroup>

          <div className="mt-4 space-y-2">
            <button type="button" onClick={() => setAuto(v => !v)} className="press flex w-full items-center gap-3 rounded-[18px] border border-line bg-white/[0.04] px-4 py-3.5 text-left">
              <span className="flex-1"><span className="block text-[15px]">{t('Detect tags and cities')}</span><span className="block text-[12.5px] text-fg-3">{t('From the description: “investor”, “lawyer”, “Dubai”')}</span></span>
              <Switch on={auto} />
            </button>
            {skipped.length > 0 && (
              <button type="button" onClick={() => setSkipDups(v => !v)} className="press flex w-full items-center gap-3 rounded-[18px] border border-line bg-white/[0.04] px-4 py-3.5 text-left">
                <span className="flex-1"><span className="block text-[15px]">{t('Skip duplicates')}</span><span className="block text-[12.5px] text-fg-3">{t('Same phone, email, handle or name')}</span></span>
                <Switch on={skipDups} />
              </button>
            )}
            {skipped.length === 0 && counts.lead + counts.person + counts.file === 0 && !skipDups && null}
          </div>

          {skipped.length > 0 && (
            <div className="mt-5 px-1 text-[12.5px] leading-relaxed text-fg-3">
              <span className="text-fg-2">{t('Skipped:')}</span> {skipped.slice(0, 4).map(c => `${fullName(c.parsed)}${c.kind === 'person' ? t(' (in network)') : c.kind === 'lead' ? t(' (in reserve)') : ''}`).join(', ')}{skipped.length > 4 ? t(' and {v} more', { v: skipped.length - 4 }) : ''}
            </div>
          )}
        </div>
      )}
      <div className="h-4" />
    </Sheet>
  )
}

function PreviewRow({ p, i }: { p: ParsedLead; i: number }) {
  const line = leadLine({ ...p, company: p.company, role: p.role } as never)
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <Avatar person={{ id: `${i}-${p.firstName}`, firstName: p.firstName, lastName: p.lastName }} size={38} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{fullName(p)}</div>
        <div className="truncate text-[12.5px] text-fg-3">{line || p.channels.map(c => c.value).join(' · ') || ' '}</div>
        {p.tags.length > 0 && <div className="mt-1 flex gap-1 overflow-hidden">{p.tags.slice(0, 3).map(tag2 => <TagPill key={tag2} tag={tag2} />)}</div>}
      </div>
      <span className="flex shrink-0 -space-x-1 text-[11px] text-fg-4">{p.channels.length ? tn(p.channels.length, '{n} channel', '{n} channels') : ''}</span>
    </div>
  )
}
