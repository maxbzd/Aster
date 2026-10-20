import { AnimatePresence, motion } from 'motion/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRightIcon, CameraIcon, CheckIcon, MicrophoneIcon, StopIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { Aurora } from '@/components/Aurora'
import { Avatar } from '@/components/Avatar'
import { FlipCounter } from '@/components/FlipCounter'
import { AstraStar, AstraThinking, SourceBadge } from '@/components/astra/Astra'
import { Chip, PrimaryButton, Segmented } from '@/components/ui'
import { db, uid } from '@/data/db'
import { useCircles } from '@/data/hooks'
import { addReminder } from '@/data/actions'
import { CLOSENESS } from '@/data/logic'
import { applyPlan, astraCapture } from '@/ai/astra'
import type { CapturePlan, PersonDraft } from '@/ai/schemas'
import { useAstraStatus } from '@/ai/hooks'
import { useSpeech } from '@/lib/speech'
import { fileToPhoto, pickFile } from '@/lib/image'
import { PALETTES } from '@/lib/colors'
import { DAY, startOfDay, toISODate } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { Capture, Closeness, NetEvent } from '@/data/types'
import { t, tn } from '@/i18n'

interface Parsed { capture: Capture; draft: PersonDraft; origRef: string; plan: CapturePlan; source: 'ai' | 'local'; include: boolean }

const emptyDraft = (): PersonDraft => ({
  ref: 'p1', existing_id: null, first_name: '', last_name: null, role: null, company: null, city: null, family: null, facts: [], interests: [],
  looking_for: null, can_help: null, i_can_help: null, channels: [], birthday: null, met_place: null, introduced_by_id: null, topics: [], gift_ideas: null,
})

/** Режим события: быстро ловим людей на конференции, разбираем вечером. */
export function EventMode() {
  const nav = useNavigate()
  const event = useLiveQuery(async () => (await db.events.filter(e => !e.endedAt).first()) ?? null, [])
  if (event === undefined) return <div className="min-h-[100dvh]" />
  return event ? <Live event={event} onExit={() => nav('/')} /> : <Setup />
}

function Shell({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: ReactNode }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      <Aurora colors={['rgb(95 227 176 / 0.35)', 'rgb(124 92 255 / 0.4)', 'rgb(255 170 110 / 0.25)']} />
      <div className="relative z-10 mx-auto flex w-full max-w-[560px] items-center justify-between px-4 pt-[calc(14px+var(--safe-top))]">
        <button type="button" aria-label={t('Close')} onClick={onClose} className="press glass grid h-10 w-10 place-items-center rounded-full"><XIcon size={18} weight="bold" /></button>
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="w-10" />
      </div>
      <div className="relative mx-auto flex w-full max-w-[560px] flex-1 flex-col px-5">{children}</div>
    </div>
  )
}

function Setup() {
  const nav = useNavigate()
  const circles = useCircles()
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [circleIds, setCircleIds] = useState<string[]>([])
  const start = async () => {
    haptic(15)
    await db.events.put({ id: uid(), name: name.trim(), place: place.trim() || undefined, startedAt: Date.now(), circleIds })
  }
  return (
    <Shell onClose={() => nav(-1)} title={t('Event mode')}>
      <div className="mt-10">
        <div className="micro text-fg-3">{t('Conference, meetup, dinner')}</div>
        <h1 className="mt-3 text-[34px] font-bold leading-tight tracking-[-0.03em]">{t('Where are you going?')}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-3">{t('At the event just snap badges and say a few words about each person. In the evening Astra goes through everyone at once and prepares follow-ups.')}</p>
      </div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Web Summit 2026" className="field mt-8 border-b border-line-2 pb-2 text-[28px] font-semibold tracking-[-0.02em]" />
      <input value={place} onChange={e => setPlace(e.target.value)} placeholder={t('Where — city or venue')} className="field mt-5 border-b border-line pb-2 text-[17px] text-fg-2" />
      {circles.length > 0 && (
        <div className="mt-6">
          <div className="micro mb-2 text-fg-3">{t('Add everyone to a circle')}</div>
          <div className="flex flex-wrap gap-1.5">
            {circles.map(c => <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={circleIds.includes(c.id)} onClick={() => setCircleIds(ids => (ids.includes(c.id) ? ids.filter(x => x !== c.id) : [...ids, c.id]))}>{c.emoji} {c.name}</Chip>)}
          </div>
        </div>
      )}
      <div className="flex-1" />
      <PrimaryButton className="mb-[calc(24px+var(--safe-bottom))] w-full" disabled={!name.trim()} onClick={start}>{t('Start the event')}</PrimaryButton>
    </Shell>
  )
}

function Live({ event, onExit }: { event: NetEvent; onExit: () => void }) {
  const captures = useLiveQuery(() => db.captures.where('eventId').equals(event.id).sortBy('createdAt'), [event.id]) ?? []
  const [stage, setStage] = useState<'live' | 'processing' | 'review'>('live')
  const [parsed, setParsed] = useState<Parsed[]>([])
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)
  const pending = captures.filter(c => c.status === 'pending')

  const process = async () => {
    setStage('processing')
    const out: Parsed[] = []
    // берём свежий список: последняя запись могла сохраниться только что
    const fresh = (await db.captures.where('eventId').equals(event.id).sortBy('createdAt')).filter(c => c.status === 'pending')
    setTotal(fresh.length)
    for (let i = 0; i < fresh.length; i++) {
      setProgress(i)
      const c = fresh[i]
      const r = await astraCapture(c.text ?? '', c.photo ? [c.photo] : [])
      const draft = r.data.people.find(p => !p.existing_id) ?? r.data.people[0] ?? emptyDraft()
      out.push({ capture: c, draft: { ...draft, ref: 'p1' }, origRef: draft.ref, plan: r.data, source: r.source, include: true })
    }
    setParsed(out)
    setStage('review')
  }

  if (stage === 'processing') {
    return (
      <Shell onClose={() => setStage('live')} title={event.name}>
        <div className="flex flex-1 flex-col items-center justify-center">
          <AstraThinking kind="event" className="w-full" />
          <p className="tnum text-[15px] text-fg-3">{t('Processing')}{' '}{Math.min(progress + 1, total)}{' '}{t('of')}{' '}{total}</p>
        </div>
      </Shell>
    )
  }
  if (stage === 'review') return <Review event={event} parsed={parsed} setParsed={setParsed} onBack={() => setStage('live')} onDone={onExit} />

  return <Capturing event={event} captures={captures} pending={pending.length} onProcess={process} onExit={onExit} />
}

function Capturing({ event, captures, pending, onProcess, onExit }: { event: NetEvent; captures: Capture[]; pending: number; onProcess: () => void; onExit: () => void }) {
  const speech = useSpeech()
  const toast = useUI(s => s.toast)
  const [photo, setPhoto] = useState<string>()
  const [note, setNote] = useState('')
  const status = useAstraStatus()
  const text = `${note ? note + ' ' : ''}${speech.text} ${speech.interim}`.trim()

  useEffect(() => () => speech.stop(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const snap = async () => {
    const f = await pickFile('image/*', 'environment')
    if (f) setPhoto(await fileToPhoto(f, 1400))
  }
  const next = async () => {
    speech.stop()
    if (!photo && !text) return
    await db.captures.put({ id: uid(), eventId: event.id, createdAt: Date.now(), photo, text: text || undefined, status: 'pending' })
    haptic(20)
    setPhoto(undefined); setNote(''); speech.setText('')
    toast(t('Logged ✦'))
  }
  const end = async () => {
    speech.stop()
    if (photo || text) await next()
    onProcess()
  }

  return (
    <Shell onClose={onExit} title={<span className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-[#ff6b7a]" />{event.name}</span>}>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <div className="text-[14px] text-fg-3">{t('people caught')}</div>
          <div className="mt-2"><FlipCounter value={captures.length} digits={2} height={56} /></div>
        </div>
        <button type="button" disabled={pending === 0} onClick={end} className="press btn-glass h-11 disabled:opacity-40">{t('Review')}{' '}<ArrowRightIcon size={16} /></button>
      </div>

      {/* текущий человек */}
      <div className="glass glow-card mt-6 rounded-[30px] p-5" style={{ ['--glow' as string]: 'rgb(95 227 176 / 0.22)', ['--gx' as string]: '50%', ['--gy' as string]: '0%' }}>
        <div className="micro text-fg-3">{t('Person #')}{captures.length + 1}</div>
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={snap} className="press relative grid h-[120px] w-[96px] shrink-0 place-items-center overflow-hidden rounded-[18px] border border-dashed border-white/20 bg-white/[0.03]">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-1.5 text-[12px] text-fg-3"><CameraIcon size={24} />{t('Badge')}</span>}
          </button>
          <textarea value={speech.listening ? text : note || speech.text} onChange={e => { setNote(e.target.value); speech.setText('') }}
            placeholder={t('Name, what they do, what you talked about, what you agreed…')} className="field min-h-[120px] flex-1 resize-none text-[15.5px] leading-relaxed" />
        </div>
        <div className="mt-4 flex gap-2">
          {speech.supported && (
            <button type="button" onClick={() => (speech.listening ? speech.stop() : speech.start())} className={`press h-12 min-w-0 flex-1 rounded-full font-semibold ${speech.listening ? 'bg-[#ff6b7a] text-white' : 'btn-glass'}`}>
              <span className="flex items-center justify-center gap-2">{speech.listening ? <><StopIcon size={17} weight="fill" />{' '}{t('Stop')}</> : <><MicrophoneIcon size={17} />{' '}{t('Dictate')}</>}</span>
            </button>
          )}
          <PrimaryButton className="!h-12 min-w-0 flex-1 !px-3" disabled={!photo && !text} onClick={next}><CheckIcon size={17} weight="bold" />{' '}{t('Next one')}</PrimaryButton>
        </div>
        {!status.connected && photo && <p className="mt-3 text-[12px] text-fg-4">{t("Without a connected model photos can't be read — say the name aloud or type it.")}</p>}
      </div>

      {captures.length > 0 && (
        <div className="mt-6 pb-[calc(24px+var(--safe-bottom))]">
          <div className="micro mb-2 text-fg-3">{t('Film roll')}</div>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5">
            {[...captures].reverse().map(c => (
              <div key={c.id} className="glass relative w-[120px] shrink-0 overflow-hidden rounded-[18px]">
                {c.photo ? <img src={c.photo} alt="" className="h-[70px] w-full object-cover opacity-80" /> : <div className="h-[70px] bg-white/[0.03]" />}
                <div className="line-clamp-2 p-2 text-[11.5px] leading-snug text-fg-2">{c.text ?? t('Photo')}</div>
                {c.status === 'saved' && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-mint text-ink"><CheckIcon size={11} weight="bold" /></span>}
                {c.status === 'pending' && <button type="button" aria-label={t('Delete')} onClick={() => db.captures.delete(c.id)} className="hit absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-fg-2"><TrashIcon size={11} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  )
}

function Review({ event, parsed, setParsed, onBack, onDone }: { event: NetEvent; parsed: Parsed[]; setParsed: (p: Parsed[]) => void; onBack: () => void; onDone: () => void }) {
  const circles = useCircles()
  const toast = useUI(s => s.toast)
  const nav = useNavigate()
  const [closeness, setCloseness] = useState<Closeness>(4)
  const [circleIds, setCircleIds] = useState<string[]>(event.circleIds)
  const [saving, setSaving] = useState(false)
  const set = (i: number, patch: Partial<Parsed>) => setParsed(parsed.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const ready = parsed.filter(p => p.include && p.draft.first_name.trim())

  const saveAll = async () => {
    setSaving(true)
    const metAt = toISODate(event.startedAt)
    for (const p of ready) {
      const plan: CapturePlan = {
        summary: '', people: [{ ...p.draft, met_place: p.draft.met_place ?? event.name }],
        interaction: { type: 'event', title: event.name, summary: p.capture.text ?? '', place: event.place ?? null, person_refs: ['p1'] },
        reminders: p.plan.reminders.filter(r => !r.person_ref || r.person_ref === p.origRef).map(r => ({ ...r, person_ref: 'p1' })),
      }
      const { refToId } = await applyPlan(plan, { metAt, metPlace: event.name, closeness, circleIds, interactionDate: p.capture.createdAt })
      // фоллоу-ап завтра утром
      if (refToId.p1) await addReminder({ personId: refToId.p1, text: t('Follow-up after “{name}”', { name: event.name }), dueAt: startOfDay() + DAY + 10 * 3600_000 })
      await db.captures.update(p.capture.id, { status: 'saved' })
    }
    for (const p of parsed.filter(x => !ready.includes(x))) await db.captures.update(p.capture.id, { status: 'skipped' })
    await db.events.update(event.id, { endedAt: Date.now() })
    haptic(25)
    toast(t('{pl} in your network · follow-ups for tomorrow are ready', { pl: tn(ready.length, '{n} person', '{n} people') }))
    nav('/', { replace: true })
    onDone()
  }

  return (
    <Shell onClose={onBack} title={event.name}>
      <div className="mt-6 flex items-center justify-between">
        <h1 className="display text-[32px] leading-none">{t('Who you caught')}</h1>
        {parsed[0] && <SourceBadge source={parsed.some(p => p.source === 'ai') ? 'ai' : 'local'} />}
      </div>
      <p className="mt-2 text-[14px] text-fg-3">{t('Check the names — the rest can be filled in later.')}</p>
      <div className="mt-5 flex flex-col gap-2.5 pb-4">
        <AnimatePresence initial={false}>
          {parsed.map((p, i) => (
            <motion.div key={p.capture.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: p.include ? 1 : 0.45, y: 0 }} className="glass flex gap-3 rounded-[24px] p-3.5">
              {p.capture.photo ? <img src={p.capture.photo} alt="" className="h-[84px] w-[64px] shrink-0 rounded-[12px] object-cover" /> : <Avatar person={{ id: p.capture.id, firstName: p.draft.first_name || '?' }} size={52} />}
              <div className="min-w-0 flex-1">
                <div className="flex gap-2">
                  <input value={p.draft.first_name} onChange={e => set(i, { draft: { ...p.draft, first_name: e.target.value } })} placeholder={t('First name')} className="field w-1/2 text-[16px] font-semibold" />
                  <input value={p.draft.last_name ?? ''} onChange={e => set(i, { draft: { ...p.draft, last_name: e.target.value || null } })} placeholder={t('Last name')} className="field w-1/2 text-[16px] text-fg-2" />
                </div>
                <input value={[p.draft.role, p.draft.company].filter(Boolean).join(' · ')} onChange={e => { const [role, company] = e.target.value.split('·').map(s => s.trim()); set(i, { draft: { ...p.draft, role: role || null, company: company || null } }) }}
                  placeholder={t('Role · company')} className="field mt-1 text-[13.5px] text-fg-3" />
                {p.capture.text && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-fg-4">{p.capture.text}</p>}
              </div>
              <button type="button" aria-label={p.include ? t("Don't save") : t('Save')} onClick={() => set(i, { include: !p.include })} className={`press grid h-7 w-7 shrink-0 place-items-center self-start rounded-full border-[1.5px] ${p.include ? 'border-mint bg-mint text-ink' : 'border-white/25'}`}>{p.include && <CheckIcon size={12} weight="bold" />}</button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="micro mb-2 text-fg-3">{t('Orbit for everyone')}</div>
      <Segmented<Closeness> value={closeness} onChange={setCloseness} options={([1, 2, 3, 4] as Closeness[]).map(c => ({ value: c, label: CLOSENESS[c].short }))} />
      {circles.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {circles.map(c => <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={circleIds.includes(c.id)} onClick={() => setCircleIds(ids => (ids.includes(c.id) ? ids.filter(x => x !== c.id) : [...ids, c.id]))}>{c.emoji} {c.name}</Chip>)}
        </div>
      )}
      <div className="sticky bottom-0 -mx-5 mt-6 border-t border-line bg-ink/92 px-5 pb-[calc(16px+var(--safe-bottom))] pt-3">
        <PrimaryButton className="w-full" disabled={!ready.length || saving} onClick={saveAll}>
          <AstraStar size={16} /> {saving ? t('Saving…') : tn(ready.length, 'Save {n} person', 'Save {n} people')}
        </PrimaryButton>
      </div>
    </Shell>
  )
}
