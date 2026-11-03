import { useEffect, useState } from 'react'
import { CopyIcon, DevicesIcon, KeyIcon, LockKeyIcon, WarningIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Field, TextInput } from '@/components/forms'
import { PrimaryButton } from '@/components/ui'
import { useUI } from '@/app/store'
import { useCloud } from '@/cloud/store'
import { answerJoin, beginJoin, cloudRecoveryText, completeJoin, enableCloudEncryption, joinWithRecoveryText } from '@/cloud/e2eSetup'
import type { JoinRequest } from '@/crypto/pairing'
import { t } from '@/i18n'

type View = 'home' | 'recovery' | 'add' | 'join'

const Code = ({ text }: { text: string }) => {
  const toast = useUI(s => s.toast)
  return (
    <div className="glass rounded-[18px] p-3.5">
      <div className="max-h-28 overflow-auto break-all font-mono text-[12px] leading-snug text-fg-2" data-testid="code">{text}</div>
      <button type="button" onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => undefined); toast(t('Copied')) }} className="press hit mt-2.5 flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-[13.5px]"><CopyIcon size={15} />{t('Copy')}</button>
    </div>
  )
}

const Digits = ({ value }: { value: string }) => (
  <div className="glass rounded-[18px] p-4 text-center">
    <div className="micro text-fg-3">{t('Check digits')}</div>
    <div className="mt-1 font-mono text-[26px] tracking-[0.08em]" data-testid="digits">{value}</div>
  </div>
)

/** Encrypt the cloud copy, and move the key between devices. */
export function CloudKeySheet({ onClose }: { onClose: () => void }) {
  const e2e = useCloud(s => s.e2e ?? 'off')
  const [view, setView] = useState<View>(e2e === 'locked' ? 'join' : 'home')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState('')
  const [saved, setSaved] = useState(false)
  // add a device (old device)
  const [theirCode, setTheirCode] = useState('')
  const [reading, setReading] = useState<{ checkDigits: string; answer(): Promise<string> } | null>(null)
  const [answer, setAnswer] = useState('')
  // join (new device)
  const [request, setRequest] = useState<JoinRequest | null>(null)
  const [reply, setReply] = useState('')
  const [typedKey, setTypedKey] = useState('')

  useEffect(() => { if (view === 'join' && !request) void beginJoin().then(setRequest) }, [view, request])
  const run = async (f: () => Promise<void>, fail: string) => {
    setBusy(true); setError(null)
    try { await f() } catch (e) { setError(e instanceof Error && e.message ? e.message : fail) } finally { setBusy(false) }
  }

  return (
    <Sheet onClose={onClose} title={t('Encrypt cloud data')} subtitle={e2e === 'on' ? t('On: the server holds only sealed data.') : e2e === 'locked' ? t('This account is encrypted. This device needs the key.') : t('So that not even the server can read your people.')} glow="rgb(95 227 176 / 0.28)" tall>
      <div className="flex flex-col gap-3 pt-1">
        {view === 'home' && e2e === 'off' && (
          <>
            <p className="px-1 text-[14px] leading-relaxed text-fg-2">{t('Every record is sealed on your devices before it is sent. The server, and anyone who gets into it, sees only data it cannot read. Your devices still merge edits as before.')}</p>
            <p className="flex gap-2 px-1 text-[13px] leading-snug text-fg-3"><WarningIcon size={15} className="mt-px shrink-0 text-warm" />{t('The key stays on your devices. If you lose every device and the recovery key, the cloud copy cannot be read by anyone. Things that read your data on the server stop working: the Claude connection, the Orbita bridge and TickTick.')}</p>
            {error && <p role="alert" className="px-1 text-[13px] text-danger">{error}</p>}
            <PrimaryButton className="w-full" disabled={busy} onClick={() => void run(async () => { setRecovery(await enableCloudEncryption()); setSaved(false); setView('recovery') }, t("Couldn't turn encryption on"))}>{busy ? t('Sealing your data…') : t('Turn on')}</PrimaryButton>
          </>
        )}

        {view === 'recovery' && (
          <>
            <p className="px-1 text-[14px] leading-relaxed text-fg-2">{t('Write this key down or save it. With it, a new device can open your cloud data even if the old ones are gone.')}</p>
            <div className="glass rounded-[22px] p-4"><div className="break-all font-mono text-[15px] leading-relaxed" data-testid="recovery-key">{recovery}</div></div>
            <label className="flex items-start gap-3 px-1 text-[14px]"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="mt-1 h-5 w-5" />{t('I saved the recovery key')}</label>
            <PrimaryButton className="w-full" disabled={!saved} onClick={() => { setRecovery(''); setView('home') }}>{t('Done')}</PrimaryButton>
          </>
        )}

        {view === 'home' && e2e === 'on' && (
          <>
            <button type="button" onClick={() => { setView('add'); setError(null) }} className="press glass flex items-center gap-3 rounded-[20px] px-4 py-3.5 text-left"><DevicesIcon size={20} />{t('Add a device')}</button>
            <button type="button" onClick={() => void run(async () => { setRecovery((await cloudRecoveryText()) ?? ''); setSaved(true); setView('recovery') }, t("Couldn't show the key"))} className="press glass flex items-center gap-3 rounded-[20px] px-4 py-3.5 text-left"><KeyIcon size={20} />{t('Show the recovery key')}</button>
            <p className="px-1 text-[12.5px] text-fg-4">{t('Signing out of this device removes the key from it. To go back to plain cloud storage, delete the cloud data and sign in again.')}</p>
          </>
        )}

        {view === 'add' && (
          <>
            <p className="px-1 text-[14px] leading-relaxed text-fg-2">{t('On the new device choose “Join”, and paste the code it shows here.')}</p>
            <div className="glass overflow-hidden rounded-[22px]"><Field label={t('Code from the new device')}><TextInput value={theirCode} onChange={e => { setTheirCode(e.target.value); setReading(null); setAnswer('') }} spellCheck={false} /></Field></div>
            {!reading ? (
              <PrimaryButton className="w-full" disabled={busy || !theirCode.trim()} onClick={() => void run(async () => setReading(await answerJoin(theirCode)), t('That code is not valid'))}>{t('Continue')}</PrimaryButton>
            ) : (
              <>
                <Digits value={reading.checkDigits} />
                <p className="px-1 text-[13.5px] leading-snug text-fg-3">{t('The same 12 digits must be on the new device. If they differ, stop: someone changed the code on the way.')}</p>
                {!answer ? <PrimaryButton className="w-full" disabled={busy} onClick={() => void run(async () => setAnswer(await reading.answer()), t("Couldn't make the answer"))}>{t('They match: make the answer')}</PrimaryButton> : (
                  <>
                    <p className="px-1 text-[13.5px] text-fg-2">{t('Paste this answer on the new device.')}</p>
                    <Code text={answer} />
                  </>
                )}
              </>
            )}
            {error && <p role="alert" className="px-1 text-[13px] text-danger">{error}</p>}
            <button type="button" onClick={() => { setView('home'); setTheirCode(''); setReading(null); setAnswer(''); setError(null) }} className="press px-1 py-2 text-[14px] text-fg-3">{t('Back')}</button>
          </>
        )}

        {view === 'join' && (
          <>
            <p className="px-1 text-[14px] leading-relaxed text-fg-2">{t('Open Aster on a device that already has your data, choose “Add a device”, and give it this code.')}</p>
            {request ? (<><Code text={request.code} /><Digits value={request.checkDigits} /></>) : <div className="h-24" />}
            <div className="glass overflow-hidden rounded-[22px]"><Field label={t('Answer from the other device')}><TextInput value={reply} onChange={e => setReply(e.target.value)} spellCheck={false} /></Field></div>
            <PrimaryButton className="w-full" disabled={busy || !request || !reply.trim()} onClick={() => void run(async () => { await completeJoin(request!, reply); onClose() }, t("That answer doesn't open. Check that it is the one made for this code."))}>{busy ? t('Working…') : t('Join')}</PrimaryButton>
            <div className="mt-2 flex items-center gap-2 px-1 text-[13px] text-fg-3"><LockKeyIcon size={14} />{t('Or use the recovery key')}</div>
            <div className="glass overflow-hidden rounded-[22px]"><Field label={t('Recovery key')}><TextInput value={typedKey} onChange={e => setTypedKey(e.target.value)} spellCheck={false} placeholder="XXXXX-XXXXX-…" /></Field></div>
            <PrimaryButton className="w-full !bg-white/10 !text-fg" disabled={busy || !typedKey.trim()} onClick={() => void run(async () => { if (!(await joinWithRecoveryText(typedKey))) throw new Error(t('That is not a valid recovery key.')); onClose() }, t("Couldn't join"))}>{t('Join with the key')}</PrimaryButton>
            {error && <p role="alert" className="px-1 text-[13px] text-danger">{error}</p>}
          </>
        )}
      </div>
      <div className="h-4" />
    </Sheet>
  )
}
