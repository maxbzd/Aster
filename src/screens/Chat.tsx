import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeftIcon, ArrowUpIcon, MicrophoneIcon, StopIcon, TrashSimpleIcon } from '@phosphor-icons/react'
import { Avatar } from '@/components/Avatar'
import { AstraStar, AstraThinking, SourceBadge, astraGlow } from '@/components/astra/Astra'
import { astraChat } from '@/ai/astra'
import { chatExamples } from '@/ai/local/chat'
import { addChatMessage, clearChat, useChat } from '@/data/chat'
import { db } from '@/data/db'
import { useAllPeople } from '@/data/hooks'
import { useSpeech } from '@/lib/speech'
import { dateLong, fullName, jobLine } from '@/lib/format'
import { haptic } from '@/app/store'
import type { ChatMessage, ChatQuote, Person } from '@/data/types'
import { t } from '@/i18n'

const KIND_LABEL: Record<NonNullable<ChatQuote['kind']>, { label: string; color: string }> = {
  mine: { get label() { return t('You promised') }, color: '#ffb36b' },
  theirs: { get label() { return t('Promised to you') }, color: '#5fe3b0' },
  agreed: { get label() { return t('We agreed') }, color: '#8f7cff' },
  topic: { get label() { return t('From a record') }, color: '#9b9cb4' },
}

/** Диалог с Астрой: помнит записи общения и предыдущие реплики. Без модели отвечает локально. */
export function Chat() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const messages = useChat()
  const people = useAllPeople()
  const speech = useSpeech()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const abort = useRef<AbortController | null>(null)
  const byId = useMemo(() => new Map((people ?? []).map(p => [p.id, p])), [people])

  const send = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (!q || pending) return
    haptic(8)
    setText('')
    speech.stop()
    setPending(true)
    const history = (await db.chat.orderBy('at').toArray()).slice(-12)
    await addChatMessage({ role: 'user', text: q })
    abort.current = new AbortController()
    try {
      const r = await astraChat(q, history, abort.current.signal)
      await addChatMessage({ role: 'astra', text: r.data.text, cards: r.data.cards, quotes: r.data.quotes, followUps: r.data.followUps, focus: r.data.focus, source: r.source })
    } finally {
      setPending(false)
    }
  }, [pending, speech])

  // вопрос из поиска или с экрана «Сегодня»: ?q=…
  useEffect(() => {
    const q = params.get('q')
    if (!q) return
    setParams(p => { const n = new URLSearchParams(p); n.delete('q'); return n }, { replace: true })
    void send(q)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages?.length, pending])
  useEffect(() => () => abort.current?.abort(), [])

  // голос → поле ввода
  useEffect(() => { if (speech.listening) setText(`${speech.text} ${speech.interim}`.trim()) }, [speech.text, speech.interim, speech.listening])
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  const empty = messages && messages.length === 0 && !pending

  return (
    <div className="fixed inset-0 z-[40] flex flex-col lg:left-[264px]">
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-ink/92 px-4 pb-3 pt-[calc(12px+var(--safe-top))]">
        <button type="button" aria-label={t('Back')} onClick={() => nav(-1)} className="press glass grid h-10 w-10 place-items-center rounded-full"><ArrowLeftIcon size={18} /></button>
        <div className="flex items-center gap-2 text-[16px] font-semibold"><AstraStar size={18} thinking={pending} />{' '}{t('Astra')}</div>
        <button type="button" aria-label={t('Clear chat')} title={t('Clear chat')} disabled={!messages?.length} onClick={() => { haptic(8); void clearChat() }} className="press glass grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"><TrashSimpleIcon size={17} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-5">
          {empty && <Welcome onPick={send} />}
          {(messages ?? []).map(m => <Bubble key={m.id} m={m} byId={byId} onFollow={send} />)}
          <AnimatePresence>
            {pending && <motion.div key="p" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><AstraThinking kind="ask" /></motion.div>}
          </AnimatePresence>
          <div ref={end} />
        </div>
      </div>

      <form onSubmit={e => { e.preventDefault(); void send(text) }} className="relative z-10 shrink-0 border-t border-line bg-ink/95 px-3 pb-[calc(12px+var(--safe-bottom))] pt-3">
        <div className="mx-auto flex w-full max-w-[640px] items-end gap-2">
          <div className="glass flex min-h-[48px] flex-1 items-end rounded-[26px] pl-4 pr-1.5">
            <textarea ref={area} value={text} onChange={e => setText(e.target.value)} rows={1} placeholder={speech.listening ? t('Listening…') : t('Ask about people and conversations')} enterKeyHint="send"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text) } }}
              className="field max-h-[132px] flex-1 resize-none py-3 text-[16px] leading-snug" />
            {speech.supported && (
              <button type="button" aria-label={speech.listening ? t('Stop recording') : t('Dictate a message')} onClick={() => { haptic(8); if (speech.listening) speech.stop(); else { speech.setText(text); speech.start() } }}
                className={`press mb-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${speech.listening ? 'bg-[#ff6b7a] text-white' : 'text-fg-3'}`}>
                {speech.listening ? <StopIcon size={16} weight="fill" /> : <MicrophoneIcon size={19} />}
              </button>
            )}
          </div>
          <button type="submit" aria-label={t('Send')} disabled={!text.trim() || pending} className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fg text-ink disabled:opacity-35"><ArrowUpIcon size={20} weight="bold" /></button>
        </div>
      </form>
    </div>
  )
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center pt-10 text-center">
      <AstraStar size={56} />
      <h1 className="display mt-5 text-[30px] leading-tight">{t('Ask what you remember')}<br />{t('about your people')}</h1>
      <p className="mt-3 max-w-[340px] text-[14.5px] leading-relaxed text-fg-3">{t("I know all your records: promises, conversations, agreements. I answer from them and don't make things up.")}</p>
      <div className="mt-7 flex w-full flex-col gap-2.5">
        {chatExamples().map((q, i) => (
          <motion.button key={q} type="button" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.08 }} onClick={() => onPick(q)}
            className="press glass rounded-[22px] px-4 py-3.5 text-left text-[15px]">{q}</motion.button>
        ))}
      </div>
    </motion.div>
  )
}

function Bubble({ m, byId, onFollow }: { m: ChatMessage; byId: Map<string, Person>; onFollow: (q: string) => void }) {
  if (m.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex justify-end">
        <div className="max-w-[86%] whitespace-pre-line rounded-[22px] rounded-br-[8px] bg-white/[0.1] px-4 py-2.5 text-[15.5px] leading-relaxed">{m.text}</div>
      </motion.div>
    )
  }
  const cards = (m.cards ?? []).map(c => ({ ...c, p: byId.get(c.id) })).filter((c): c is { id: string; reason: string; p: Person } => !!c.p)
  const quotes = m.quotes ?? []
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-2.5">
      <div className="max-w-[94%] rounded-[24px] rounded-bl-[8px] p-1" style={astraGlow}>
        <div className="whitespace-pre-line px-3.5 py-2.5 text-[15.5px] leading-relaxed">{m.text}</div>
      </div>

      {quotes.length > 0 && (
        <div className="flex w-full max-w-[94%] flex-col gap-2">
          {quotes.map((q, i) => {
            const k = KIND_LABEL[q.kind ?? 'topic']
            const p = byId.get(q.personId)
            return (
              <div key={i} className="rounded-[18px] bg-white/[0.045] py-2.5 pl-3.5 pr-3" style={{ borderLeft: `3px solid ${k.color}` }}>
                <div className="flex flex-wrap items-center gap-x-2 text-[11.5px]">
                  <span className="font-semibold" style={{ color: k.color }}>{k.label}</span>
                  {q.date > 0 && <span className="text-fg-4">{dateLong(q.date)}</span>}
                  {p && <Link to={`/person/${p.id}`} className="text-fg-3 underline-offset-2 hover:underline">{fullName(p)}</Link>}
                </div>
                <p className="mt-1 text-[14.5px] leading-snug text-fg-2">«{q.text}»</p>
              </div>
            )
          })}
        </div>
      )}

      {cards.length > 0 && (
        <div className="glass rows w-full max-w-[94%] overflow-hidden rounded-[22px]">
          {cards.map(({ id, reason, p }) => (
            <Link key={id} to={`/person/${id}`} className="press flex items-center gap-3 px-3.5 py-2.5">
              <Avatar person={p} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{fullName(p)}</span>
                <span className="block truncate text-[12.5px] text-fg-3">{reason || jobLine(p)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {(m.followUps?.length ?? 0) > 0 && (
        <div className="flex max-w-[94%] flex-wrap gap-1.5">
          {m.followUps!.map(f => <button key={f} type="button" onClick={() => onFollow(f)} className="press rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[13px] text-fg-2 hover:text-fg">{f}</button>)}
        </div>
      )}
      {m.source && <SourceBadge source={m.source} />}
    </motion.div>
  )
}
