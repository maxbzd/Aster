import { useState } from 'react'
import { EyeIcon, EyeSlashIcon, MicrophoneIcon, SpeakerHighIcon, WaveformIcon } from '@phosphor-icons/react'
import { CommitInput, Field, FormGroup } from '@/components/forms'
import { Chip } from '@/components/ui'
import { patchStt, patchVoice } from '@/data/actions'
import { useSettings } from '@/data/hooks'
import { useServerStatus } from '@/ai/managed'
import { STT_PRESETS, sttReady } from '@/stt/client'
import { speechSupported } from '@/lib/speech'
import { t } from '@/i18n'

/** Transcribing recordings and voice control. The recognition key, like Astra's key, is stored on the device only. */
export function SpeechSettings() {
  const settings = useSettings()
  const stt = settings?.stt
  const voice = settings?.voice
  const [show, setShow] = useState(false)
  const server = useServerStatus()
  const on = stt?.provider === 'openai' || stt?.provider === 'managed'
  const managed = stt?.provider === 'managed'
  const preset = STT_PRESETS.find(p => p.baseUrl === (stt?.baseUrl ?? STT_PRESETS[0]!.baseUrl))

  return (
    <>
      <div className="micro mb-2 mt-8 px-1 text-fg-3">{t('Transcribing recordings')}</div>
      <div className="glass rounded-[22px] p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]"><WaveformIcon size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">{t('Speech recognition on the server')}</span>
            <span className="block text-[12.5px] text-fg-3">{t('Upload a meeting recording to get text and a breakdown. Without it the browser microphone and files with a ready transcript still work.')}</span>
          </span>
          <Switch on={on} onChange={v => patchStt({ provider: v ? (server?.stt ? 'managed' : 'openai') : 'off', ...(v && !stt?.baseUrl ? { baseUrl: STT_PRESETS[0]!.baseUrl, model: STT_PRESETS[0]!.model } : {}) })} />
        </div>
        {on && (
          <>
            {server?.stt && (
              <div className="mt-4 flex gap-2">
                <Chip size="sm" active={managed} onClick={() => patchStt({ provider: 'managed' })}>{t('Key on the server')}</Chip>
                <Chip size="sm" active={!managed} onClick={() => patchStt({ provider: 'openai' })}>{t('Own key')}</Chip>
              </div>
            )}
            {managed && <p className="mt-3 px-1 text-[13px] text-mint">{t('✓ Using the server key: nothing to enter.')}</p>}
            {!managed && <div className="mt-4 flex gap-2">
              {STT_PRESETS.map(p => <Chip key={p.id} size="sm" active={preset?.id === p.id} onClick={() => patchStt({ baseUrl: p.baseUrl, model: p.model })}>{p.label}</Chip>)}
            </div>}
            {!managed && preset && <p className="mt-2 px-1 text-[12.5px] text-fg-4">{preset.hint}</p>}
            {!managed && <FormGroup>
              <Field label={t('Key')} hint={t('Stored only on this device and never included in backups. The recording is sent to the server you choose.')}>
                <div className="flex items-center gap-2">
                  <CommitInput type={show ? 'text' : 'password'} value={stt?.apiKey ?? ''} onCommit={v => patchStt({ apiKey: v.trim() || undefined })} placeholder={t('Paste the key')} autoComplete="off" spellCheck={false} className="field text-[16px]" />
                  <button type="button" aria-label={show ? t('Hide key') : t('Show key')} onClick={() => setShow(s => !s)} className="press text-fg-3">{show ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}</button>
                </div>
              </Field>
              <Field label={t('Server address')}><CommitInput value={stt?.baseUrl ?? ''} onCommit={v => patchStt({ baseUrl: v.trim() || undefined })} placeholder="https://api.openai.com/v1" className="field text-[16px]" /></Field>
              <Field label={t('Model')}><CommitInput value={stt?.model ?? ''} onCommit={v => patchStt({ model: v.trim() || undefined })} placeholder={STT_PRESETS[0]!.model} className="field text-[16px]" /></Field>
              <Field label={t('Recording language')} hint={t('Language code, e.g. en or ru. Empty — detected automatically')}><CommitInput value={stt?.language ?? ''} onCommit={v => patchStt({ language: v.trim() || undefined })} placeholder="ru" className="field text-[16px]" /></Field>
            </FormGroup>}
            {!managed && <p className={`mt-3 px-1 text-[13px] ${sttReady(stt) ? 'text-mint' : 'text-fg-4'}`}>{sttReady(stt) ? t('✓ Ready: the “Upload a recording” button on the “Dictate a meeting” screen') : t('Add a key to turn it on')}</p>}
          </>
        )}
      </div>

      <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Voice')}</div>
      <div className="glass rows overflow-hidden rounded-[22px]">
        <Row icon={MicrophoneIcon} title={t('Listen for “Astra, …”')} text={speechSupported() ? t('While the app is open, the phrase “Astra, log…” starts a command. Astra asks for confirmation before any action.') : t("Your browser doesn't support speech recognition")} on={!!voice?.wake} disabled={!speechSupported()} onChange={v => patchVoice({ wake: v })} />
        <Row icon={SpeakerHighIcon} title={t('Ask out loud')} text={t('The confirmation question is read aloud; answer with “yes” or “no”')} on={!!voice?.speak} onChange={v => patchVoice({ speak: v })} />
      </div>
    </>
  )
}

function Row({ icon: I, title, text, on, onChange, disabled }: { icon: typeof MicrophoneIcon; title: string; text: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${disabled ? 'opacity-50' : ''}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]"><I size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{title}</span>
        <span className="block text-[12.5px] leading-snug text-fg-3">{text}</span>
      </span>
      <Switch on={on} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${on ? 'bg-mint' : 'bg-white/15'}`}>
      <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}
