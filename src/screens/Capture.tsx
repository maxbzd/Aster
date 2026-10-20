import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { CameraIcon, FileTextIcon, KeyboardIcon, MicrophoneIcon, StopIcon, WaveformIcon, XIcon } from '@phosphor-icons/react'
import { Aurora } from '@/components/Aurora'
import { AstraStar, AstraThinking } from '@/components/astra/Astra'
import { PlanReview, type PlanExtras } from '@/components/astra/PlanReview'
import { PrimaryButton } from '@/components/ui'
import { applyPlan, astraCapture } from '@/ai/astra'
import type { CapturePlan } from '@/ai/schemas'
import { useAstraStatus } from '@/ai/hooks'
import { useSpeech } from '@/lib/speech'
import { useSettings } from '@/data/hooks'
import { networkTerms, sttReady, transcribeFile, type TranscribeProgress } from '@/stt/client'
import { AUDIO_ACCEPT, parseTranscript, TRANSCRIPT_EXT } from '@/stt/transcript'
import { fileToPhoto, pickFile } from '@/lib/image'
import { haptic, useUI } from '@/app/store'
import { t, tn, msg, intlTag } from '@/i18n'

const EXAMPLES = [
  msg("Met Artem at dinner at Alina's — he's a CTO in fintech, moving to Dubai in March…"),
  msg("Had coffee with Mark: he's looking for strong fintech teams, agreed to call on Friday…"),
  msg('Met Katie Smith at a conference, a designer at Spotify, lives in Berlin…'),
]

/** «Наговори встречу» — голос или текст → Астра раскладывает по полям. */
export function Capture() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const speech = useSpeech()
  const status = useAstraStatus()
  const toast = useUI(s => s.toast)
  const open = useUI(s => s.open)
  const settings = useSettings()
  const [stt, setStt] = useState<TranscribeProgress | null>(null)
  const abortStt = useRef<AbortController | null>(null)
  const [mode, setMode] = useState<'voice' | 'text'>(params.get('mode') === 'text' || !speech.supported ? 'text' : 'voice')
  const [typed, setTyped] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [stage, setStage] = useState<'input' | 'thinking' | 'review'>('input')
  const [result, setResult] = useState<{ plan: CapturePlan; source: 'ai' | 'local'; error?: string } | null>(null)
  const [extras, setExtras] = useState<PlanExtras>({ circleIds: [], closeness: 3 })
  const [saving, setSaving] = useState(false)
  const example = useMemo(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)], [])

  // автостарт записи при входе в голосовой режим
  useEffect(() => {
    if (mode === 'voice' && speech.supported && params.get('autostart') !== '0') speech.start()
    return () => speech.stop()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const text = mode === 'voice' ? `${speech.text} ${speech.interim}`.trim() : typed
  const canAnalyze = text.trim().length > 3 || photos.length > 0

  const switchMode = (m: 'voice' | 'text') => {
    haptic(5)
    if (m === 'text') { speech.stop(); setTyped(item => (item || speech.text)) }
    else { speech.setText(typed); speech.start() }
    setMode(m)
  }

  const analyze = async () => {
    speech.stop()
    haptic(12)
    setStage('thinking')
    const r = await astraCapture(text, photos)
    setResult({ plan: r.data, source: r.source, error: r.error })
    setStage('review')
    if (r.error) toast(r.error, 'info')
  }

  const save = async () => {
    if (!result) return
    setSaving(true)
    const res = await applyPlan(result.plan, { circleIds: extras.circleIds, closeness: extras.closeness })
    haptic(20)
    const parts = [res.created && tn(res.created, '{n} new person', '{n} new people'), res.updated && t('{updated} updated', { updated: res.updated }), result.plan.reminders.length && tn(result.plan.reminders.length, '{n} reminder', '{n} reminders')].filter(Boolean)
    toast(t('Saved: {v}', { v: parts.join(', ') }))
    const first = result.plan.people[0]?.ref
    nav(first && res.refToId[first] ? `/person/${res.refToId[first]}` : '/', { replace: true })
  }

  const applyTranscript = (value2: string) => {
    speech.stop()
    setTyped(value2)
    setMode('text')
  }

  /** Расшифровка из файла — просто текст. */
  const addTranscript = async () => {
    const f = await pickFile(TRANSCRIPT_EXT.join(',') + ',text/plain')
    if (!f) return
    const query = parseTranscript(f.name, await f.text())
    if (!query) { toast(t('No text in the file'), 'info'); return }
    applyTranscript(query)
    toast(t('Transcript loaded: {v} characters', { v: query.length.toLocaleString(intlTag()) }))
  }

  /** Запись встречи: настоящее распознавание речи на сервере с ключом пользователя. */
  const addRecording = async () => {
    if (!sttReady(settings?.stt)) { toast(t("First add a recognition key in Astra's settings"), 'info'); open({ kind: 'astra' }); return }
    const f = await pickFile(AUDIO_ACCEPT)
    if (!f) return
    const ctrl = new AbortController()
    abortStt.current = ctrl
    setStt({ done: 0, total: 1 })
    try {
      const value3 = await transcribeFile(f, settings!.stt!, p => setStt(p), ctrl.signal, settings!.stt!.provider === 'managed' ? await networkTerms() : undefined)
      if (!value3) toast(t("Couldn't make out any speech in the recording"), 'info')
      else { applyTranscript(value3); toast(t('Recording transcribed')) }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast(e instanceof Error ? e.message : t("Couldn't transcribe the recording"), 'info')
    } finally {
      setStt(null)
      abortStt.current = null
    }
  }

  const addPhoto = async () => {
    const f = await pickFile('image/*')
    if (!f) return
    setPhotos(p => [...p, '']) // мгновенный плейсхолдер
    const img = await fileToPhoto(f, 1400)
    setPhotos(p => [...p.filter(Boolean), img])
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      <Aurora colors={['rgb(255 150 90 / 0.45)', 'rgb(124 92 255 / 0.45)', 'rgb(255 110 160 / 0.25)']} intensity={stage === 'input' && speech.listening ? 1.4 : 1} />

      {/* верхняя панель */}
      <div className="relative z-10 mx-auto flex w-full max-w-[560px] items-center justify-between px-4 pt-[calc(14px+var(--safe-top))]">
        <button type="button" aria-label={t('Close')} onClick={() => (stage === 'review' ? setStage('input') : nav(-1))} className="press glass grid h-10 w-10 place-items-center rounded-full"><XIcon size={18} weight="bold" /></button>
        <div className="flex items-center gap-2 text-[15px] font-semibold"><AstraStar size={18} thinking={stage === 'thinking'} /> {stage === 'review' ? t('Review and save') : t('Dictate the meeting')}</div>
        <div className="w-10" />
      </div>

      <AnimatePresence mode="wait">
        {stage === 'input' && (
          <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }} className="relative mx-auto flex w-full max-w-[560px] flex-1 flex-col px-5">
            {mode === 'voice' ? (
              <div className="flex flex-1 flex-col items-center justify-center pt-4">
                <VoiceOrb level={speech.level} active={speech.listening} />
                <div className="mt-8 min-h-[120px] w-full text-center">
                  {text ? (
                    speech.listening ? (
                      <p className="display text-[25px] leading-snug">
                        {speech.text} <span className="text-fg-3">{speech.interim}</span>
                      </p>
                    ) : (
                      <textarea value={speech.text} onChange={e => speech.setText(e.target.value)} rows={4} className="field display resize-none text-center text-[23px] leading-snug" />
                    )
                  ) : (
                    <>
                      <p className="text-[16px] text-fg-2">{speech.listening ? t('Listening — tell me who you met') : t('Tap the microphone and speak')}</p>
                      <p className="mx-auto mt-3 max-w-[340px] text-[14px] leading-relaxed text-fg-4">{t("Where you met, what the person does, what's worth remembering and what you agreed. For example: “")}{example}»</p>
                    </>
                  )}
                  {speech.error && (
                    <div className="mt-3 flex flex-col items-center gap-2.5">
                      <p className="text-[13.5px] text-danger">{speech.error}</p>
                      <button type="button" onClick={() => switchMode('text')} className="press btn-glass h-10 px-4 text-[14px]"><KeyboardIcon size={16} />{' '}{t('Type instead')}</button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col pt-8">
                <textarea autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder={example} className="field display min-h-[260px] flex-1 resize-none text-[24px] leading-snug placeholder:text-fg-4" />
                <p className="mt-2 text-[13px] text-fg-4">{t('Tip: on a phone you can dictate with the 🎙 button on your keyboard.')}</p>
              </div>
            )}

            {photos.length > 0 && (
              <div className="mb-3 flex gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative h-16 w-16 overflow-hidden rounded-[14px] border border-line bg-white/5">
                    {p && <img src={p} alt="" className="h-full w-full object-cover" />}
                    <button type="button" aria-label={t('Remove photo')} onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60"><XIcon size={10} weight="bold" /></button>
                  </div>
                ))}
                {!status.connected && <p className="self-center text-[12.5px] leading-snug text-fg-4">{t('Astra will read business-card photos once you connect a model')}</p>}
              </div>
            )}

            {/* нижняя панель */}
            <div className="flex items-center justify-between gap-3 pb-[calc(24px+var(--safe-bottom))] pt-3">
              <div className="flex gap-2">
                <button type="button" aria-label={t('Photo of a business card or badge')} title={t('Photo of a business card or badge')} onClick={addPhoto} className="press glass grid h-12 w-12 place-items-center rounded-full"><CameraIcon size={20} /></button>
                <button type="button" aria-label={t('Upload a meeting recording')} title={t('Upload a meeting recording (audio or video)')} onClick={addRecording} className="press glass grid h-12 w-12 place-items-center rounded-full"><WaveformIcon size={20} /></button>
                <button type="button" aria-label={t('Upload a transcript')} title={t('Upload a transcript (txt, srt, vtt, json)')} onClick={addTranscript} className="press glass grid h-12 w-12 place-items-center rounded-full"><FileTextIcon size={20} /></button>
                {speech.supported && (
                  <button type="button" aria-label={mode === 'voice' ? t('Type it') : t('Use voice')} onClick={() => switchMode(mode === 'voice' ? 'text' : 'voice')} className="press glass grid h-12 w-12 place-items-center rounded-full">
                    {mode === 'voice' ? <KeyboardIcon size={20} /> : <MicrophoneIcon size={20} />}
                  </button>
                )}
              </div>
              {mode === 'voice' && (
                <button type="button" aria-label={speech.listening ? t('Stop dictation') : t('Speak')} onClick={() => { haptic(10); speech.listening ? speech.stop() : speech.start() }}
                  className="press grid h-[72px] w-[72px] place-items-center rounded-full text-ink"
                  style={{ background: speech.listening ? '#ff6b7a' : 'radial-gradient(circle at 35% 30%, #fff, #ffe2bd 45%, #b8a6ff 100%)', boxShadow: speech.listening ? '0 0 40px -4px rgb(255 107 122 / 0.7)' : '0 10px 40px -6px rgb(255 190 130 / 0.55)' }}>
                  {speech.listening ? <StopIcon size={26} weight="fill" className="text-white" /> : <MicrophoneIcon size={28} weight="fill" />}
                </button>
              )}
              <PrimaryButton disabled={!canAnalyze} onClick={analyze} className="!h-12 !px-5">
                <AstraStar size={16} />{' '}{t('Review')}
              </PrimaryButton>
            </div>
          </motion.div>
        )}

        {stt && (
          <motion.div key="stt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-20 grid place-items-center bg-ink/85 px-8">
            <div className="w-full max-w-[340px] text-center">
              <AstraStar size={40} thinking />
              <div className="display mt-4 text-[24px]">{t('Transcribing the recording')}</div>
              <p className="mt-2 text-[14px] text-fg-3">{stt.total > 1 ? t('Part {min} of {total}. Long recordings are processed in chunks.', { min: Math.min(stt.done + 1, stt.total), total: stt.total }) : t('This usually takes under a minute.')}</p>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-fg transition-all" style={{ width: `${Math.max(6, (stt.done / stt.total) * 100)}%` }} /></div>
              <button type="button" onClick={() => abortStt.current?.abort()} className="press btn-glass mt-6 h-11 px-6">{t('Cancel')}</button>
            </div>
          </motion.div>
        )}

        {stage === 'thinking' && (
          <motion.div key="thinking" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="relative flex flex-1 items-center justify-center px-6">
            <div className="w-full max-w-[420px]">
              <AstraThinking kind="capture" />
              <p className="mx-auto mt-2 max-w-[360px] text-center text-[14px] leading-relaxed text-fg-4">«{text.slice(0, 140)}{text.length > 140 ? '…' : ''}»</p>
            </div>
          </motion.div>
        )}

        {stage === 'review' && result && (
          <motion.div key="review" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative mx-auto flex w-full max-w-[560px] flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-4 pb-6 pt-5">
              {result.plan.people.length ? (
                <PlanReview plan={result.plan} onChange={plan => setResult(r => (r ? { ...r, plan } : r))} source={result.source} error={result.error} extras={extras} onExtras={setExtras} />
              ) : (
                <div className="pt-16 text-center">
                  <div className="display text-[26px]">{t("Couldn't tell who this is about")}</div>
                  <p className="mx-auto mt-2 max-w-[320px] text-[14.5px] text-fg-3">{result.plan.summary || t('Name the person — for example, “Met Artem…”')}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-line bg-ink/92 px-4 pb-[calc(16px+var(--safe-bottom))] pt-3">
              <button type="button" onClick={() => setStage('input')} className="press btn-glass h-[52px] px-5">{t('Edit')}</button>
              <PrimaryButton className="flex-1" disabled={!result.plan.people.length || saving} onClick={save}>{saving ? t('Saving…') : t('Save all')}</PrimaryButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Сфера, которая дышит в такт голосу. */
function VoiceOrb({ level, active }: { level: number; active: boolean }) {
  const s = 1 + (active ? level * 0.35 : 0)
  return (
    <div className="relative grid h-[220px] w-[220px] place-items-center">
      {active && [0, 1, 2].map(i => (
        <motion.span key={i} className="absolute inset-0 rounded-full border border-white/25"
          initial={{ scale: 0.6, opacity: 0.6 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }} />
      ))}
      <div className="absolute inset-[-30%] rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(255 160 100 / 0.45), rgb(124 92 255 / 0.18) 60%, transparent)', transform: `scale(${s})`, transition: 'transform 90ms linear' }} />
      <div className="relative h-[150px] w-[150px] rounded-full"
        style={{
          background: 'radial-gradient(circle at 34% 28%, #fff1dc 0%, #ffb36b 28%, #ff6a8a 56%, #8a4dff 82%, #2b1a6b 100%)',
          boxShadow: 'inset -12px -16px 30px rgb(40 0 60 / 0.45), inset 6px 8px 18px rgb(255 255 255 / 0.3), 0 0 60px rgb(255 130 110 / 0.5)',
          transform: `scale(${s})`, transition: 'transform 90ms linear',
          animation: active ? undefined : 'breathe 5s ease-in-out infinite',
        }}>
        <div className="absolute inset-0 rounded-full" style={{ background: 'conic-gradient(from 0deg, transparent, rgb(255 255 255 / 0.2) 15%, transparent 30%, rgb(255 210 170 / 0.18) 55%, transparent 70%)', animation: `spin ${active ? 6 : 24}s linear infinite` }} />
      </div>
    </div>
  )
}
