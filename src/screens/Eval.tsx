import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, DownloadSimpleIcon, PlayIcon, StopIcon } from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { Chip, Empty, IconButton, PrimaryButton } from '@/components/ui'
import { buildReport, CASES, runSuite, summarize, type ChatFn, type Row } from '@/ai/eval/suite'
import { compatChat } from '@/ai/compat'
import { serverHasAi, serverModels, useServerStatus } from '@/ai/managed'
import { GATEWAY_PREFIX, modelLabel, providerOf } from '@/ai/models'
import { download } from '@/lib/ics'
import { useUI } from '@/app/store'
import { intlTag, t } from '@/i18n'

/**
 * "Compare models": the same checks as `npm run eval`, but right in the app. Requests go through the server function,
 * the keys live on the server. The data is made up; no real records go anywhere.
 */
export function Eval() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const status = useServerStatus()
  const available = useMemo(() => serverModels(status), [status])
  const [picked, setPicked] = useState<string[] | null>(null)
  const [custom, setCustom] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [ranModels, setRanModels] = useState<string[]>([])
  const abort = useRef<AbortController | null>(null)

  // by default — the gateway models; without a gateway — everything that is available
  const defaults = available.filter(m => m.provider === 'gateway').map(m => m.id)
  const models = picked ?? (defaults.length ? defaults : available.map(m => m.id))
  const all = [...new Set([...available.map(m => m.id), ...models])]
  const running = !!progress && progress.done < progress.total

  const toggle = (id: string) => setPicked((models.includes(id) ? models.filter(x => x !== id) : [...models, id]))
  const addCustom = () => {
    const id = custom.trim()
    if (/^[\w][\w.:-]{0,60}(?:\/[\w][\w.:-]{0,60}){0,2}$/.test(id)) { setPicked([...new Set([...models, GATEWAY_PREFIX + id])]); setCustom('') } else toast(t('Format: vendor/model-name'), 'info')
  }

  const start = async () => {
    if (!models.length || running) return
    const chat: ChatFn = async (model, messages) => {
      const r = await compatChat(providerOf(model), model, messages, 6000, abort.current?.signal)
      return { text: r.choices?.[0]?.message?.content ?? '', inTok: r.usage?.prompt_tokens ?? 0, outTok: r.usage?.completion_tokens ?? 0 }
    }
    abort.current = new AbortController()
    setRows([])
    setRanModels(models)
    setProgress({ done: 0, total: models.length * CASES.length })
    try {
      await runSuite(models, chat, (_row, done, total) => { setRows(r => [...r, _row]); setProgress({ done, total }) }, abort.current.signal)
    } finally {
      abort.current = null
      setProgress(p => (p ? { ...p, total: p.done } : p))
    }
  }

  const summary = summarize(ranModels, rows)
  const report = () => download(t('model-comparison-{replace}.md', { replace: new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') }), buildReport(ranModels, rows, t('app, the ai server function')), 'text/markdown')

  if (status && !serverHasAi(status)) {
    return (
      <Page>
        <Head onBack={() => nav(-1)} />
        <div className="mt-10"><Empty icon={PlayIcon} title={t('No server keys')} text={t('Sign in to your cloud account and add secrets in Supabase (GATEWAY_API_KEY, GEMINI_API_KEY…) while the owner is allowed in ALLOWED_EMAILS.')} /></div>
      </Page>
    )
  }

  return (
    <Page>
      <Head onBack={() => nav(-1)} />
      <p className="mt-3 px-1 text-[14px] leading-relaxed text-fg-3">
        {t('Testing models on')}{' '}{CASES.length}{' '}{t('made-up Astra tasks: note parsing, chat over records, network search, drafts, brief. Real people and records are not used.')}
      </p>

      <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Models')}</div>
      <div className="flex flex-wrap gap-2">
        {all.map(id => <Chip key={id} size="sm" active={models.includes(id)} onClick={() => toggle(id)}>{modelLabel(id)}</Chip>)}
        {status === null && <span className="text-[13px] text-fg-4">{t('Checking the server…')}</span>}
      </div>
      {status?.gateway && (
        <div className="mt-3 flex gap-2">
          <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustom()} placeholder={t('Another gateway model: vendor/model-name')} className="field glass h-11 flex-1 rounded-full px-4 text-[14.5px]" spellCheck={false} autoCapitalize="none" />
          <button type="button" onClick={addCustom} className="press btn-glass h-11 px-4 text-[14px]">{t('Add')}</button>
        </div>
      )}

      <div className="mt-5 flex gap-2.5">
        {running
          ? <button type="button" onClick={() => abort.current?.abort()} className="press btn-glass h-12 flex-1 text-[15px]"><StopIcon size={16} weight="fill" />{' '}{t('Stop the run')}</button>
          : <PrimaryButton className="flex-1" disabled={!models.length || !status} onClick={start}><PlayIcon size={16} weight="fill" />{' '}{t('Run on')}{' '}{models.length} {models.length === 1 ? t('model') : t('models')}</PrimaryButton>}
        {rows.length > 0 && <button type="button" onClick={report} className="press btn-glass h-12 px-5 text-[15px]"><DownloadSimpleIcon size={17} />{' '}{t('Report')}</button>}
      </div>
      {progress && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-fg transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
          <div className="tnum mt-1.5 text-[12.5px] text-fg-4">{progress.done}{' '}{t('of')}{' '}{progress.total}</div>
        </div>
      )}

      {summary.length > 0 && rows.length > 0 && (
        <div className="glass mt-6 overflow-hidden rounded-[24px]">
          <div className="rows">
            {summary.map(summary2 => (
              <div key={summary2.model} className="px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15.5px] font-semibold">{modelLabel(summary2.model)}</span>
                  <span className="tnum text-[20px] font-bold">{summary2.ok}<span className="text-[14px] font-medium text-fg-3"> / {CASES.length}</span></span>
                </div>
                <div className="tnum mt-1 text-[12.5px] text-fg-3">{summary2.total}{' '}{t('completed · request errors')}{' '}{summary2.errors}{' '}{t('· repaired JSON')}{' '}{summary2.repaired} · {summary2.sec}{' '}{t('s · tokens')}{' '}{summary2.inTok.toLocaleString(intlTag())} / {summary2.outTok.toLocaleString(intlTag())}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-6 flex flex-col gap-2.5">
          {CASES.filter(c => rows.some(r => r.c.id === c.id)).map(c => (
            <details key={c.id} className="glass overflow-hidden rounded-[22px]">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-fg-4">{c.group}</span>
                  <span className="block truncate text-[14.5px] font-medium">{c.title}</span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {ranModels.map(m => {
                    const r = rows.find(x => x.model === m && x.c.id === c.id)
                    return <span key={m} title={modelLabel(m)} className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-bold ${!r ? 'bg-white/5 text-fg-4' : r.call.error ? 'bg-warm/20 text-warm' : r.issues.length ? 'bg-danger/20 text-danger' : 'bg-mint/20 text-mint'}`}>{!r ? '…' : r.call.error ? '!' : r.issues.length ? '✗' : '✓'}</span>
                  })}
                </span>
              </summary>
              <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
                {ranModels.map(m => {
                  const r = rows.find(x => x.model === m && x.c.id === c.id)
                  if (!r) return null
                  return (
                    <div key={m}>
                      <div className="text-[13px] font-semibold">{modelLabel(m)} <span className="font-normal text-fg-4">· {(r.call.ms / 1000).toFixed(1)}{' '}{t('s')}</span></div>
                      {r.call.error && <p className="mt-1 text-[13px] text-warm">{t('Error:')}{' '}{r.call.error}</p>}
                      {r.issues.length > 0 && <ul className="mt-1 list-disc pl-5 text-[13px] text-danger">{r.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>}
                      <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[14px] bg-black/30 p-3 text-[12px] leading-snug text-fg-2">{r.shown.slice(0, 3500)}</pre>
                    </div>
                  )
                })}
              </div>
            </details>
          ))}
        </div>
      )}
    </Page>
  )
}

function Head({ onBack }: { onBack: () => void }) {
  return (
    <div className="relative flex items-center justify-between pt-[calc(12px+var(--safe-top))]">
      <IconButton icon={ArrowLeftIcon} label={t('Back')} onClick={onBack} size={42} />
      <span className="text-[16px] font-semibold">{t('Compare models')}</span>
      <span className="w-[42px]" />
    </div>
  )
}
