import { useState } from 'react'
import { useNavigate } from 'react-router'
import { CheckIcon, EyeIcon, EyeSlashIcon, GlobeIcon, LockKeyIcon, NotePencilIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { AstraStar } from '@/components/astra/Astra'
import { Segmented } from '@/components/ui'
import { CommitInput, Field, FormGroup } from '@/components/forms'
import { useSettings } from '@/data/hooks'
import { patchAi } from '@/data/actions'
import type { AiMode, AiSettings } from '@/data/types'
import { DEFAULT_MODEL, MODELS, providerOf, type ModelInfo } from '@/ai/models'
import { testConnection } from '@/ai/astra'
import { useAiSpend, useAstraStatus } from '@/ai/hooks'
import { serverHasAi, serverModels, useServerStatus } from '@/ai/managed'
import { AI_DEFAULTS } from '@/ai/autoSetup'
import { useCloud } from '@/cloud/store'
import { cloudEnabled } from '@/cloud/config'
import { useUI } from '@/app/store'
import { haptic } from '@/app/store'
import { SpeechSettings } from './SpeechSettings'
import { t } from '@/i18n'

const DEFAULTS = AI_DEFAULTS

/** Connecting Astra to a cloud model. */
export function AstraSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings()
  const status = useAstraStatus()
  const spend = useAiSpend()
  const server = useServerStatus()
  const signedIn = !!useCloud(s => s.userId)
  const openSheet = useUI(s => s.open)
  const nav = useNavigate()
  const ai: AiSettings = { ...DEFAULTS, ...settings?.ai }
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  // in the server mode you see the models whose key is set on the server (your gateway, free Gemini and Groq, Claude); otherwise only Claude
  const catalog: ModelInfo[] = ai.mode === 'managed' ? serverModels(server) : MODELS
  /** Switching the mode picks a suitable model: gateway and free models exist only on the server, Claude directly only in the other modes. */
  const chooseMode = (mode: AiMode) => {
    if (mode === 'managed') {
      const offered = serverModels(server)
      if (offered.length && !offered.some(m => m.id === ai.model)) return set({ mode, model: offered[0]!.id })
      return set({ mode })
    }
    if (providerOf(ai.model) !== 'anthropic') return set({ mode, model: DEFAULT_MODEL })
    return set({ mode })
  }
  const set = (patch: Partial<AiSettings>) => { setTest(null); return patchAi(patch, DEFAULTS) }

  const run = async () => {
    setTesting(true)
    setTest(await testConnection())
    setTesting(false)
    haptic(15)
  }

  return (
    <Sheet onClose={onClose} tall glow="rgb(255 200 150 / 0.28)">
      <div className="flex flex-col items-center pt-2 text-center">
        <AstraStar size={56} thinking={testing} />
        <h2 className="display mt-4 text-[36px] leading-none">{t('Astra')}</h2>
        <p className="mt-2 text-[14px] text-fg-3">
          {status.connected ? <>{t('Connected ·')}{' '}<span className="text-fg-2">{status.model?.name}</span></> : t('Runs on this device')}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <div className="glass rounded-[22px] p-4">
          <div className="text-[14.5px] font-semibold">{t('◇ Basic brain')}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">{t('Always on. Runs on your phone, free, and sends nothing anywhere.')}</p>
        </div>
        <div className="glass glow-card rounded-[22px] p-4" style={{ ['--glow' as string]: 'rgb(255 200 150 / 0.3)', ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
          <div className="text-[14.5px] font-semibold">{t('✦ Cloud model')}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">{t('Understands meaning, reads business-card photos, writes natural text.')}</p>
        </div>
      </div>

      <div className="micro mb-2 mt-7 px-1 text-fg-3">{t('Connection')}</div>
      <Segmented<AiMode> value={ai.mode} onChange={chooseMode}
        options={[{ value: 'off' as AiMode, label: t('Device') }, ...(cloudEnabled() || ai.mode === 'managed' ? [{ value: 'managed' as AiMode, label: t('Server') }] : []), { value: 'key' as AiMode, label: t('Own key') }, ...(ai.mode === 'proxy' ? [{ value: 'proxy' as AiMode, label: t('Proxy') }] : [])]} />

      {ai.mode === 'off' && serverHasAi(server) && (
        <button type="button" onClick={() => chooseMode('managed')} className="press glass mt-3 flex w-full items-center gap-3 rounded-[22px] p-4 text-left">
          <AstraStar size={22} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">{t('Server key is already connected')}</span>
            <span className="block text-[12.5px] text-fg-3">{t('Nothing to enter — switch on “Server” mode.')}</span>
          </span>
        </button>
      )}

      {ai.mode === 'managed' && (
        <div className="glass mt-3 rounded-[22px] p-4 text-[13.5px] leading-relaxed">
          {!signedIn ? (
            <>
              <p className="text-fg-2">{t('The AI key is stored on the server and never reaches the app. To use it, sign in to your cloud account.')}</p>
              <button type="button" onClick={() => openSheet({ kind: 'cloud' })} className="press btn-glass mt-3 h-11 px-5">{t('Sign in to the cloud')}</button>
            </>
          ) : server === null ? (
            <p className="text-fg-3">{t("Checking the server… If nothing changes, this isn't a deployed version of the site: there is no server key here.")}</p>
          ) : !server.allowed ? (
            <p className="text-danger">{t("This account can't use the server key. The owner needs to add its email to the ALLOWED_EMAILS secret of the ai function in Supabase.")}</p>
          ) : !serverHasAi(server) ? (
            <p className="text-danger">{t('No AI key is set on the server (the GEMINI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY or GATEWAY_API_KEY secrets of the ai function in Supabase).')}</p>
          ) : (
            <>
              <p className="text-mint">{t('✓ Server key connected. No need to enter it on the device.')}</p>
              <button type="button" onClick={() => { onClose(); nav('/eval') }} className="press btn-glass mt-3 h-11 px-5">{t('Compare models on test tasks')}</button>
            </>
          )}
        </div>
      )}

      {ai.mode === 'key' && (
        <FormGroup>
          <Field label={t('Anthropic API key')} hint={t('Stored only on this device and never included in backups. Create a key at console.anthropic.com')}>
            <div className="flex items-center gap-2">
              <CommitInput type={showKey ? 'text' : 'password'} value={ai.apiKey ?? ''} onCommit={v => set({ apiKey: v.trim() })} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} className="field font-mono text-[15px]" />
              <button type="button" aria-label={showKey ? t('Hide') : t('Show')} onClick={() => setShowKey(v => !v)} className="press text-fg-3">{showKey ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}</button>
            </div>
          </Field>
        </FormGroup>
      )}
      {ai.mode === 'proxy' && (
        <FormGroup>
          <Field label={t('Server address')} hint={t('Your proxy that keeps the key to itself (for example, a function on Vercel)')}>
            <CommitInput value={ai.proxyUrl ?? ''} onCommit={v => set({ proxyUrl: v.trim() })} placeholder="https://aster.example.com/api" className="field text-[15px]" />
          </Field>
          <Field label={t('Access token')}>
            <CommitInput type="password" value={ai.proxyToken ?? ''} onCommit={v => set({ proxyToken: v })} placeholder={t('server password')} className="field text-[15px]" />
          </Field>
        </FormGroup>
      )}

      {ai.mode !== 'off' && (
        <>
          <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Model')}</div>
          <div className="glass rows overflow-hidden rounded-[22px]">
            {catalog.map(m => (
              <button key={m.id} type="button" onClick={() => set({ model: m.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${ai.model === m.id ? 'border-fg bg-fg text-ink' : 'border-white/25'}`}>{ai.model === m.id && <CheckIcon size={11} weight="bold" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{m.name}{m.id === DEFAULT_MODEL && <span className="ml-2 rounded-full bg-[#ffd9a8]/15 px-2 py-0.5 text-[11px] font-semibold text-[#ffd9a8]">{t('recommended')}</span>}</span>
                  <span className="block text-[12.5px] text-fg-3">{m.note}</span>
                </span>
                {m.input === 0 && m.output === 0
                  ? <span className={`shrink-0 text-right text-[11.5px] font-semibold leading-tight ${m.provider === 'gateway' ? 'text-fg-3' : 'text-mint'}`}>{m.provider === 'gateway' ? t('per its pricing') : t('free')}</span>
                  : <span className="tnum shrink-0 text-right text-[11.5px] leading-tight text-fg-4">${m.input} / ${m.output}<br />{t('per 1M tokens')}</span>}
              </button>
            ))}
          </div>

          <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Privacy')}</div>
          <div className="glass rows overflow-hidden rounded-[22px]">
            <Toggle icon={NotePencilIcon} title={t('Share notes and history')} text={t('Without them the brief and drafts will be drier')} on={ai.shareNotes} onChange={v => set({ shareNotes: v })} />
            <Toggle icon={GlobeIcon} title={t('Look up news about people')} text={t('Web search by name and company — reasons to reach out')} on={ai.webSearch} onChange={v => set({ webSearch: v })} />
          </div>

          <button type="button" onClick={() => set({ consentAt: ai.consentAt ? undefined : Date.now() })} className="press glass mt-4 flex w-full items-start gap-3 rounded-[22px] p-4 text-left">
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] ${ai.consentAt ? 'border-mint bg-mint text-ink' : 'border-white/30'}`}>{ai.consentAt && <CheckIcon size={12} weight="bold" />}</span>
            <span>
              <span className="flex items-center gap-1.5 text-[14.5px] font-medium"><LockKeyIcon size={15} />{' '}{t('I understand how my data is processed')}</span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-fg-3">{t("For each request Astra sends the model provider only what's needed: one person's card or a compact list of your network without phone numbers or emails. Phone numbers and emails from cards are never sent.")}</span>
            </span>
          </button>

          <div className="mt-4 flex items-center gap-3">
            <button type="button" disabled={testing || !ai.consentAt} onClick={run} className="press btn-primary h-12 flex-1 disabled:opacity-40">{testing ? t('Checking…') : t('Test connection')}</button>
          </div>
          {!ai.consentAt && <p className="mt-2 px-1 text-[12.5px] text-fg-4">{t('Tick the consent above to turn on the cloud model.')}</p>}
          {test && <p className={`mt-3 px-1 text-[14px] ${test.ok ? 'text-mint' : 'text-danger'}`}>{test.ok ? t('✓ Works: “{message}”', { message: test.message }) : test.message}</p>}
          <p className="mt-5 text-center text-[12.5px] text-fg-4">{t('Last 30 days:')}{' '}{spend.calls}{' '}{t('requests · ≈ $')}{spend.cost.toFixed(2)}</p>
        </>
      )}
      <SpeechSettings />
      <div className="h-6" />
    </Sheet>
  )
}

function Toggle({ icon: I, title, text, on, onChange }: { icon: typeof GlobeIcon; title: string; text: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]"><I size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{title}</span>
        <span className="block text-[12.5px] text-fg-3">{text}</span>
      </span>
      <span className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${on ? 'bg-mint' : 'bg-white/15'}`}>
        <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
      </span>
    </button>
  )
}
