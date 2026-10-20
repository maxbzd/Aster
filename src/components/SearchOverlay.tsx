import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ArrowLeftIcon, BellSimpleIcon, CalendarStarIcon, ChatCircleDotsIcon, FileArrowUpIcon, MagnifyingGlassIcon, MicrophoneIcon, PlanetIcon, PulseIcon,
  UserCirclePlusIcon, VaultIcon, type Icon,
} from '@phosphor-icons/react'
import { useAllInteractions, useAllPeople, useLeads } from '@/data/hooks'
import { useUI } from '@/app/store'
import { Avatar } from './Avatar'
import { INTERACTIONS } from './icons'
import { AstraStar, AstraThinking, SourceBadge, astraGlow } from './astra/Astra'
import { haystack, personMatches } from '@/data/search'
import { relationPhrase } from '@/data/family'
import { dateShort, fullName, jobLine } from '@/lib/format'
import { astraAsk, type Result } from '@/ai/astra'
import { askReserve, filterLeads, leadLine } from '@/ai/local/reserve'
import type { AskResult } from '@/ai/schemas'
import type { Lead } from '@/data/types'
import { t, msg } from '@/i18n'

const QUESTION = /\?|^(кто|кого|кому|с кем|у кого|где|какие|какой|какая|сколько|когда|чей|чья|посоветуй|подскажи|найди|кем|о ком|что у|чем|who|whom|whose|which|what|where|when|how|why|can|could|should|find|suggest|recommend|do i|did i|is there|are there)\s/i
const SUGGESTED = [msg('Who can help with a visa to the UAE?'), msg('Who should I invite to a dinner about AI?'), msg("Which investors haven't heard from me in a while?"), msg('Whose birthdays are coming up?')]

/** Командная строка + «Спроси свою сеть». Ctrl/⌘ K. */
export function SearchOverlay() {
  const open = useUI(s => s.search)
  return <AnimatePresence>{open && <Search />}</AnimatePresence>
}

function Search() {
  const setSearch = useUI(s => s.setSearch)
  const openSheet = useUI(s => s.open)
  const people = useAllPeople()
  const leads = useLeads()
  const ints = useAllInteractions()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const [ask, setAsk] = useState<{ q: string; res: Result<AskResult> | null } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const close = () => setSearch(false)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const runAsk = async (question: string) => {
    const question2 = question.trim()
    if (!question2) return
    setQ(question2)
    setAsk({ q: question2, res: null })
    const res = await astraAsk(question2)
    setAsk({ q: question2, res })
  }

  const isQuestion = QUESTION.test(q.trim()) || q.trim().split(/\s+/).length >= 4

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const actions: { icon: Icon; label: string; run: () => void }[] = [
      { icon: ChatCircleDotsIcon, label: t('Chat with Astra'), run: () => nav('/chat') },
      { icon: MicrophoneIcon, label: t('Dictate a meeting'), run: () => nav('/capture') },
      { icon: UserCirclePlusIcon, label: t('New person'), run: () => openSheet({ kind: 'addPerson' }) },
      { icon: ChatCircleDotsIcon, label: t('Log an interaction'), run: () => openSheet({ kind: 'log' }) },
      { icon: BellSimpleIcon, label: t('Reminder'), run: () => openSheet({ kind: 'reminder' }) },
      { icon: CalendarStarIcon, label: t('Event mode'), run: () => nav('/event') },
      { icon: VaultIcon, label: t('Reserve — spare contacts'), run: () => nav('/reserve') },
      { icon: FileArrowUpIcon, label: t('Upload a list to the reserve'), run: () => openSheet({ kind: 'leadImport' }) },
      { icon: PlanetIcon, label: t('Open the orbit'), run: () => nav('/orbit') },
      { icon: PulseIcon, label: t('Network pulse'), run: () => nav('/pulse') },
    ].filter(a => !query || a.label.toLowerCase().includes(query))
    const ps = (people ?? [])
      .filter(p => personMatches(query, p, haystack(p)))
      .sort((a, b) => (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0))
      .slice(0, query ? 10 : 5)
    const ls = query ? filterLeads(query, leads ?? []).slice(0, 5) : []
    const its = query ? ints.filter(i => `${i.title ?? ''} ${i.note ?? ''} ${i.place ?? ''}`.toLowerCase().includes(query)).sort((a, b) => b.date - a.date).slice(0, 5) : []
    return { actions, ps, ls, its }
  }, [q, people, leads, ints, openSheet, nav])

  const askFn = () => runAsk(q)
  const psFns = results.ps.map(p => () => { nav(`/person/${p.id}`); close() })
  const lsFns = results.ls.map(l => () => { close(); openSheet({ kind: 'lead', id: l.id }) })
  const itsFns = results.its.map(i => () => { if (i.personIds[0]) nav(`/person/${i.personIds[0]}`); close() })
  const actFns = results.actions.map(a => () => { a.run(); close() })
  const askFirst = isQuestion && q.trim()
  const order = askFirst ? [askFn, ...psFns, ...lsFns, ...itsFns, ...actFns]
    : q.trim() ? [...psFns, ...lsFns, askFn, ...itsFns, ...actFns]
    : [...psFns, ...lsFns, ...itsFns, ...actFns]
  const run = (i: number) => order[i]?.()
  const byId = new Map((people ?? []).map(p => [p.id, p]))
  let k = -1
  const askRow = () => {
    const i = ++k
    return (
      <button key="ask" type="button" onMouseEnter={() => setCursor(i)} onClick={() => run(i)}
        className={`mb-1 flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left ${cursor === i ? 'bg-white/[0.08]' : ''}`} style={astraGlow}>
        <AstraStar size={22} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">{t('Ask the network')}</span>
          <span className="block truncate text-[12.5px] text-fg-3">«{q.trim()}»</span>
        </span>
        <kbd className="hidden rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-fg-3 md:block">Enter</kbd>
      </button>
    )
  }

  const personRow = (x: { id: string; reason: string }) => {
    const p = byId.get(x.id)
    if (!p) return null
    return (
      <button key={x.id} type="button" onClick={() => { nav(`/person/${p.id}`); close() }} className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left hover:bg-white/[0.06]">
        <Avatar person={p} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">{fullName(p)} <span className="font-normal text-fg-3">{jobLine(p) && `· ${jobLine(p)}`}</span></span>
          <span className="mt-0.5 block text-[13px] leading-snug text-fg-2">{x.reason}</span>
        </span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[55] flex justify-center px-3 pt-[calc(10px+var(--safe-top))] md:pt-[10vh]">
      <motion.div className="absolute inset-0 bg-black/75" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        className="glass-strong relative flex max-h-[82dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-[28px]"
        onKeyDown={e => {
          if (e.key === 'Escape') { if (ask) setAsk(null); else close() }
          if (ask) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, order.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
          if (e.key === 'Enter') run(cursor)
        }}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
          {ask ? (
            <button type="button" aria-label={t('Back')} onClick={() => setAsk(null)} className="press text-fg-2"><ArrowLeftIcon size={20} /></button>
          ) : <MagnifyingGlassIcon size={20} className="text-fg-3" />}
          <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setCursor(0); setAsk(null) }} placeholder={t('Find a person or ask the network…')} className="field text-[17px]" />
          <kbd className="hidden rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-fg-3 md:block">Esc</kbd>
          <button type="button" onClick={close} className="text-[15px] text-fg-2 md:hidden">{t('Cancel')}</button>
        </div>

        {ask ? (
          <div className="overflow-y-auto p-4">
            {!ask.res ? <AstraThinking kind="ask" /> : (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <div className="rounded-[22px] p-4" style={astraGlow}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-[#ffe2c2]"><AstraStar size={14} />{' '}{t('Answer')}</span>
                    <SourceBadge source={ask.res.source} error={ask.res.error} />
                  </div>
                  <p className="text-[16px] leading-relaxed">{ask.res.data.answer}</p>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  {ask.res.data.people.slice(0, 4).map(personRow)}
                </div>
                <ReserveAnswer q={ask.q} leads={leads ?? []} onOpen={id => { close(); openSheet({ kind: 'lead', id }) }} />
                {ask.res.data.people.length > 4 && (
                  <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
                    <div className="micro px-3 pb-1 text-fg-4">{t('More from your network ·')}{' '}{ask.res.data.people.length - 4}</div>
                    {ask.res.data.people.slice(4).map(personRow)}
                  </div>
                )}
                <button type="button" onClick={() => { nav(`/chat?q=${encodeURIComponent(ask.q)}`); close() }} className="press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-line text-[14px] font-medium text-fg-2"><AstraStar size={14} />{' '}{t('Continue in chat')}</button>
                {ask.res.data.follow_ups.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                    {ask.res.data.follow_ups.map(f => <button key={f} type="button" onClick={() => runAsk(f)} className="press rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[13px] text-fg-2 hover:text-fg">{f}</button>)}
                  </div>
                )}
              </motion.div>
            )}
          </div>
        ) : (
          <div className="overflow-y-auto p-2">
            {askFirst && askRow()}
            {!q.trim() && (
              <div className="px-3 pb-2 pt-2">
                <div className="micro mb-2 flex items-center gap-1.5 text-fg-4"><AstraStar size={11} />{' '}{t('Ask your network')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED.map(s => <button key={s} type="button" onClick={() => runAsk(t(s))} className="press rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[13px] text-fg-2 hover:text-fg">{t(s)}</button>)}
                </div>
              </div>
            )}
            {results.ps.length > 0 && <div className="micro px-3 pb-1.5 pt-3 text-fg-4">{t('People')}</div>}
            {results.ps.map(p => {
              const i = ++k
              return (
                <button key={p.id} type="button" onMouseEnter={() => setCursor(i)} onClick={() => run(i)} className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-2 text-left ${cursor === i ? 'bg-white/[0.08]' : ''}`}>
                  <Avatar person={p} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{fullName(p)}</span>
                    <span className="block truncate text-[12.5px] text-fg-3">{p.familyOf ? relationPhrase(p, byId.get(p.familyOf)) : jobLine(p) || p.city || p.metPlace || ' '}</span>
                  </span>
                </button>
              )
            })}
            {results.ls.length > 0 && <div className="micro px-3 pb-1.5 pt-3 text-fg-4">{t('Reserve')}</div>}
            {results.ls.map(l => {
              const i = ++k
              return (
                <button key={l.id} type="button" onMouseEnter={() => setCursor(i)} onClick={() => run(i)} className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-2 text-left ${cursor === i ? 'bg-white/[0.08]' : ''}`}>
                  <Avatar person={l} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{fullName(l)}</span>
                    <span className="block truncate text-[12.5px] text-fg-3">{leadLine(l) || ' '}</span>
                  </span>
                  <VaultIcon size={15} className="shrink-0 text-mint" />
                </button>
              )
            })}
            {!askFirst && q.trim() && askRow()}
            {results.its.length > 0 && <div className="micro px-3 pb-1.5 pt-3 text-fg-4">{t('Records')}</div>}
            {results.its.map(it => {
              const i = ++k
              const m = INTERACTIONS[it.type]
              const p = byId.get(it.personIds[0])
              return (
                <button key={it.id} type="button" onMouseEnter={() => setCursor(i)} onClick={() => run(i)} className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-2 text-left ${cursor === i ? 'bg-white/[0.08]' : ''}`}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06]" style={{ color: m.color }}><m.icon size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{it.title || m.label}</span>
                    <span className="block truncate text-[12.5px] text-fg-3">{p ? fullName(p) : ''} · {dateShort(it.date)}{it.note ? ` · ${it.note}` : ''}</span>
                  </span>
                </button>
              )
            })}
            {results.actions.length > 0 && <div className="micro px-3 pb-1.5 pt-3 text-fg-4">{t('Actions')}</div>}
            {results.actions.map(a => {
              const i = ++k
              return (
                <button key={a.label} type="button" onMouseEnter={() => setCursor(i)} onClick={() => run(i)} className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left ${cursor === i ? 'bg-white/[0.08]' : ''}`}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06]"><a.icon size={17} /></span>
                  <span className="text-[15px]">{a.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </motion.div>
    </div>
  )
}

/** Ответ на вопрос: кто подходит из резерва (локальный поиск, в облако резерв не уходит). */
function ReserveAnswer({ q, leads, onOpen }: { q: string; leads: Lead[]; onOpen: (id: string) => void }) {
  const hits = useMemo(() => askReserve(q, leads, 5), [q, leads])
  if (!hits.length) return null
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="micro mb-1.5 flex items-center gap-1.5 px-3 text-fg-4"><VaultIcon size={12} className="text-mint" />{' '}{t('From the reserve ·')}{' '}{hits.length}</div>
      {hits.map(h => (
        <button key={h.lead.id} type="button" onClick={() => onOpen(h.lead.id)} className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left hover:bg-white/[0.06]">
          <Avatar person={h.lead} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">{fullName(h.lead)} <span className="font-normal text-fg-3">{leadLine(h.lead) && `· ${leadLine(h.lead)}`}</span></span>
            <span className="mt-0.5 block text-[13px] leading-snug text-fg-2">{h.reason}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
