import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { MicrophoneIcon, XIcon } from '@phosphor-icons/react'
import { AstraStar, AstraThinking, astraGlow } from '@/components/astra/Astra'
import { applyPlan, astraCapture, astraChat } from '@/ai/astra'
import type { ChatReply } from '@/ai/local/chat'
import type { CapturePlan } from '@/ai/schemas'
import { db } from '@/data/db'
import { useSettings } from '@/data/hooks'
import { speechSupported } from '@/lib/speech'
import { haptic, useUI } from '@/app/store'
import { captureText, describePlan, intentOf, isNo, isYes, spokenConfirm, stripWake } from './commands'
import { listenContinuously, speak } from './wake'
import { t } from '@/i18n'

type State =
  | { phase: 'idle' }
  | { phase: 'working'; heard: string }
  | { phase: 'confirm'; heard: string; plan: CapturePlan; lines: string[] }
  | { phase: 'answer'; heard: string; reply: ChatReply; source: 'ai' | 'local' }
  | { phase: 'notice'; text: string }

const CONFIRM_TIMEOUT = 60_000
const MANUAL_WINDOW = 9_000

/**
 * Голосовое управление без касаний: «Астра, запиши, что с Ниной договорились на пятницу».
 * Ничего не пишется в базу, пока человек не подтвердит план словами «да» или кнопкой.
 */
export function VoiceHost() {
  const settings = useSettings()
  const voice = settings?.voice
  const loc = useLocation()
  const toast = useUI(s => s.toast)
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [denied, setDenied] = useState(false)
  const ref = useRef(state)
  ref.current = state
  const manualUntil = useRef(0)
  const timer = useRef<number>(0)
  const speakOn = !!voice?.speak

  // с микрофоном работают экраны диктовки, диалога, события и разбора — там слушаем только их
  const paused = /^\/(capture|chat|event|review)/.test(loc.pathname)
  const enabled = !!voice?.wake && speechSupported() && !paused && !!settings?.onboarded && !denied

  const idle = useCallback(() => { window.clearTimeout(timer.current); setState({ phase: 'idle' }) }, [])
  const notice = useCallback((text: string, ms = 6000) => {
    window.clearTimeout(timer.current)
    setState({ phase: 'notice', text })
    timer.current = window.setTimeout(() => setState(s => (s.phase === 'notice' ? { phase: 'idle' } : s)), ms)
  }, [])

  const confirm = useCallback(async () => {
    const s = ref.current
    if (s.phase !== 'confirm') return
    window.clearTimeout(timer.current)
    haptic(20)
    const res = await applyPlan(s.plan)
    const parts = [res.created && t('new cards: {created}', { created: res.created }), res.updated && t('updated: {updated}', { updated: res.updated }), s.plan.interaction && t('entry added'), s.plan.reminders.length && t('reminders: {count}', { count: s.plan.reminders.length })].filter(Boolean)
    toast(t('Done — {v}', { v: parts.join(', ') || t('saved') }))
    if (speakOn) speak(t('Done'))
    idle()
  }, [idle, speakOn, toast])

  const cancel = useCallback(() => {
    toast(t('Cancelled, nothing saved'), 'info')
    if (speakOn) speak(t("OK, I'm not saving anything"))
    idle()
  }, [idle, speakOn, toast])

  const handle = useCallback(async (rest: string) => {
    setState({ phase: 'working', heard: rest })
    if (intentOf(rest) === 'record') {
      const r = await astraCapture(captureText(rest), [])
      const lines = describePlan(r.data, await db.people.toArray())
      if (!lines.length) { notice(t("Couldn't tell what to record. Say, for example: “Astra, log that Nina and I agreed on Friday”"), 9000); return }
      setState({ phase: 'confirm', heard: rest, plan: r.data, lines })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { if (ref.current.phase === 'confirm') { notice(t('No confirmation — nothing saved'), 7000) } }, CONFIRM_TIMEOUT)
      if (speakOn) speak(spokenConfirm(lines))
    } else {
      const r = await astraChat(rest, [])
      setState({ phase: 'answer', heard: rest, reply: r.data, source: r.source })
      if (speakOn) speak(r.data.text.replace(/[«»]/g, ''))
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setState(s => (s.phase === 'answer' ? { phase: 'idle' } : s)), 25_000)
    }
  }, [notice, speakOn])

  const onFinal = useCallback((text: string) => {
    const cur = ref.current
    if (cur.phase === 'confirm') {
      if (isYes(text)) { void confirm(); return }
      if (isNo(text)) { cancel(); return }
    }
    if (cur.phase === 'working') return
    const rest = stripWake(text)
    const manual = Date.now() < manualUntil.current
    if (rest === null && !manual) return
    manualUntil.current = 0
    if (!rest && rest !== null) { manualUntil.current = Date.now() + MANUAL_WINDOW; notice(t('Listening — say a command'), MANUAL_WINDOW); return }
    void handle(rest ?? text)
  }, [cancel, confirm, handle, notice])

  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => {
    if (!enabled) return
    const l = listenContinuously(item => onFinalRef.current(item), kind => { if (kind === 'denied') { setDenied(true); toast(t('No microphone access — voice control is off until restart'), 'info') } })
    return () => l.stop()
  }, [enabled, toast])

  useEffect(() => { if (!voice?.wake) setDenied(false) }, [voice?.wake])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!enabled && state.phase === 'idle') return null

  return (
    <>
      {enabled && state.phase === 'idle' && (
        <button type="button" onClick={() => { haptic(8); manualUntil.current = Date.now() + MANUAL_WINDOW; notice(t('Listening — say a command'), MANUAL_WINDOW) }}
          className="press fixed right-3 top-[calc(10px+var(--safe-top))] z-[45] flex h-8 items-center gap-1.5 rounded-full border border-line bg-ink/90 px-3 text-[12px] font-medium text-fg-3" title={t('Say “Astra, …” or tap to dictate a command')}>
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mint" /></span>
          <MicrophoneIcon size={13} />{' '}{t('“Astra…”')}
        </button>
      )}
      <AnimatePresence>
        {state.phase !== 'idle' && (
          <motion.div key={state.phase} initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }} transition={{ type: 'spring', stiffness: 440, damping: 36 }}
            role="alertdialog" aria-label={t('Voice command')} className="fixed inset-x-3 bottom-[calc(96px+var(--safe-bottom))] z-[65] mx-auto max-w-[480px] rounded-[28px] p-1 lg:bottom-8 lg:left-[calc(264px+0.75rem)]" style={astraGlow}>
            <div className="rounded-[24px] bg-ink-2 p-4">
              {state.phase === 'working' && (<><div className="mb-1 text-[13px] text-fg-3">«{state.heard}»</div><AstraThinking kind="capture" /></>)}

              {state.phase === 'notice' && (
                <div className="flex items-start gap-3">
                  <AstraStar size={22} className="mt-0.5 shrink-0" />
                  <p className="flex-1 text-[14.5px] leading-relaxed">{state.text}</p>
                  <button type="button" aria-label={t('Close')} onClick={idle} className="press text-fg-3"><XIcon size={16} weight="bold" /></button>
                </div>
              )}

              {state.phase === 'confirm' && (
                <>
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[#ffe2c2]"><AstraStar size={15} />{' '}{t('Check before I save')}</div>
                  <p className="mt-2 text-[12.5px] text-fg-4">{t('Heard: “')}{state.heard}»</p>
                  <ul className="mt-3 flex flex-col gap-2">
                    {state.lines.map((l, i) => <li key={i} className="rounded-[16px] bg-white/[0.05] px-3.5 py-2.5 text-[15px] leading-snug">{l}</li>)}
                  </ul>
                  <div className="mt-4 flex gap-2.5">
                    <button type="button" onClick={cancel} className="press btn-glass h-12 flex-1 text-[15px]">{t('No')}</button>
                    <button type="button" onClick={() => void confirm()} className="press btn-primary h-12 flex-[1.6] text-[15px]">{t('Yes, save')}</button>
                  </div>
                  <p className="mt-2.5 text-center text-[12px] text-fg-4">{t('You can answer by voice: “yes” or “no”')}</p>
                </>
              )}

              {state.phase === 'answer' && (
                <div className="flex items-start gap-3">
                  <AstraStar size={22} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-fg-4">«{state.heard}»</p>
                    <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">{state.reply.text}</p>
                    {state.reply.quotes[0] && <p className="mt-2 border-l-2 border-white/20 pl-3 text-[13.5px] leading-snug text-fg-2">«{state.reply.quotes[0].text}»</p>}
                  </div>
                  <button type="button" aria-label={t('Close')} onClick={idle} className="press text-fg-3"><XIcon size={16} weight="bold" /></button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
