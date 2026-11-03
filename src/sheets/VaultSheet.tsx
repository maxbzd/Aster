import { useState } from 'react'
import { CopyIcon, DownloadSimpleIcon, FingerprintIcon, KeyIcon, LockKeyIcon, ShieldCheckIcon, TrashIcon, WarningIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Field, TextInput } from '@/components/forms'
import { PrimaryButton } from '@/components/ui'
import { useUI } from '@/app/store'
import { passwordProblem } from './BackupSheet'
import { passkeys } from '@/vault/keys'
import { PasskeyError, passkeySupported, registerPasskey } from '@/vault/passkey'
import { vault } from '@/vault'
import { useVaultState } from '@/vault/state'
import type { PreparedVault } from '@/vault/session'
import { download } from '@/lib/ics'
import { dateLong } from '@/lib/format'
import { t } from '@/i18n'

type View = 'home' | 'enable' | 'recovery' | 'password' | 'newRecovery' | 'turnOff'
const LOCK_CHOICES = [0, 1, 5, 15, 60] as const

function RecoveryKeyCard({ text }: { text: string }) {
  const toast = useUI(s => s.toast)
  return (
    <div className="glass rounded-[22px] p-4">
      <div className="micro mb-2 text-fg-3">{t('Your recovery key')}</div>
      <div className="break-all font-mono text-[15px] leading-relaxed tracking-wide" data-testid="recovery-key">{text}</div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => undefined); toast(t('Copied')) }} className="press hit flex flex-1 items-center justify-center gap-2 rounded-full bg-white/[0.07] px-3 py-2.5 text-[14px]"><CopyIcon size={16} />{t('Copy')}</button>
        <button type="button" onClick={() => download('aster-recovery-key.txt', `${t('Aster recovery key')}\n\n${text}\n\n${t('Keep this somewhere safe and private. Anyone who has it can open your data.')}\n`)} className="press hit flex flex-1 items-center justify-center gap-2 rounded-full bg-white/[0.07] px-3 py-2.5 text-[14px]"><DownloadSimpleIcon size={16} />{t('Save a file')}</button>
      </div>
    </div>
  )
}

/** Turn protection on or off, and manage how the app is opened. */
export function VaultSheet({ onClose }: { onClose: () => void }) {
  const state = useVaultState(s => s.state)
  const toast = useUI(s => s.toast)
  const on = state === 'unlocked'
  const [view, setView] = useState<View>('home')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [current, setCurrent] = useState('')
  const [prepared, setPrepared] = useState<PreparedVault | null>(null)
  const [recovery, setRecovery] = useState('')
  const [saved, setSaved] = useState(false)
  const [minutes, setMinutes] = useState(() => vault.autoLockMinutes())
  const [, bump] = useState(0)
  const header = vault.header()
  const keys = header ? passkeys(header) : []

  const reset = (next: View) => { setView(next); setError(null); setPassword(''); setRepeat(''); setCurrent(''); setSaved(false) }
  const run = async (f: () => Promise<void>, fail: string) => {
    setBusy(true); setError(null)
    try { await f() } catch (e) { setError(e instanceof Error && e.message && !(e instanceof PasskeyError) ? e.message : fail) } finally { setBusy(false) }
  }

  const turnOn = () => {
    const problem = passwordProblem(password, repeat)
    if (problem) { setError(problem); return }
    void run(async () => { const p = await vault.prepare(password); setPrepared(p); setRecovery(p.recoveryKey); setView('recovery') }, t("Couldn't turn protection on. Nothing was changed."))
  }
  const finish = () => run(async () => { await prepared!.commit() }, t("Couldn't finish. Close the other windows of Aster and try again."))
  const cancel = async () => { await prepared?.abort(); setPrepared(null); reset('home') }

  const changePassword = () => {
    const problem = passwordProblem(password, repeat)
    if (problem) { setError(problem); return }
    void run(async () => {
      if (!(await vault.verifyPassword(current))) { setError(t('Wrong password.')); return }
      await vault.changePassword(password); toast(t('Password changed')); reset('home')
    }, t("Couldn't change the password"))
  }
  const newRecovery = () => run(async () => {
    if (!(await vault.verifyPassword(current))) { setError(t('Wrong password.')); return }
    setRecovery(await vault.renewRecoveryKey()); setSaved(false); setView('recovery')
  }, t("Couldn't make a new key"))
  const turnOff = () => run(async () => {
    if (!(await vault.verifyPassword(current))) { setError(t('Wrong password.')); return }
    await vault.disable()
  }, t("Couldn't turn protection off"))
  const addPasskey = () => run(async () => {
    const made = await registerPasskey('Aster')
    await vault.addPasskey(made.credentialId, made.prfSalt, made.secret, navigator.platform || t('This device'))
    bump(n => n + 1); toast(t('Passkey added'))
  }, t("Couldn't add the passkey"))
  const removePasskey = (id: string) => run(async () => { await vault.removePasskey(id); bump(n => n + 1) }, t("Couldn't remove the passkey"))

  const pair = (label: string) => (
    <div className="glass overflow-hidden rounded-[22px] divide-y divide-line">
      <Field label={label}><TextInput type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <Field label={t('Repeat it')}><TextInput type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} /></Field>
    </div>
  )
  const confirmField = (
    <div className="glass overflow-hidden rounded-[22px]"><Field label={t('Your current password')}><TextInput type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></Field></div>
  )
  const errorLine = error && <p role="alert" className="px-1 text-[13px] text-danger">{error}</p>
  const back = <button type="button" onClick={() => reset('home')} className="press px-1 py-2 text-[14px] text-fg-3">{t('Back')}</button>

  return (
    <Sheet onClose={view === 'recovery' && prepared ? () => undefined : onClose} title={t('Protect this device')} subtitle={on ? t('Your data is encrypted on this device.') : t('Encrypt your people and notes on this device.')} glow="rgb(95 227 176 / 0.28)" tall>
      <div className="flex flex-col gap-3 pt-1">
        {view === 'home' && !on && (
          <>
            <p className="px-1 text-[14px] leading-relaxed text-fg-2">{t('Everything is kept encrypted on this device. Without your password, a passkey or the recovery key, no one can read it, even with the phone in hand. Opening takes a moment, and the app locks itself when you leave it.')}</p>
            <p className="flex gap-2 px-1 text-[13px] leading-snug text-fg-3"><WarningIcon size={15} className="mt-px shrink-0 text-warm" />{t('If you lose the password and the recovery key, your data cannot be recovered. Keep a backup file as well.')}</p>
            <PrimaryButton className="w-full" onClick={() => reset('enable')}>{t('Set it up')}</PrimaryButton>
          </>
        )}

        {view === 'enable' && (
          <>
            {pair(t('Choose a password'))}
            {errorLine}
            <PrimaryButton className="w-full" disabled={busy} onClick={turnOn}>{busy ? t('Encrypting your data…') : t('Continue')}</PrimaryButton>
            {back}
          </>
        )}

        {view === 'recovery' && (
          <>
            <p className="px-1 text-[14px] leading-relaxed text-fg-2">{prepared ? t('Write this key down or save it. It is the only way back in if you forget the password. It is shown once.') : t('Your new recovery key. The old one no longer works.')}</p>
            <RecoveryKeyCard text={recovery} />
            <label className="flex items-start gap-3 px-1 text-[14px]"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="mt-1 h-5 w-5" />{t('I saved the recovery key')}</label>
            {errorLine}
            {prepared ? (
              <>
                <PrimaryButton className="w-full" disabled={!saved || busy} onClick={finish}>{busy ? t('Working…') : t('Turn protection on')}</PrimaryButton>
                <button type="button" onClick={cancel} className="press px-1 py-2 text-[14px] text-fg-3">{t('Cancel')}</button>
              </>
            ) : <PrimaryButton className="w-full" disabled={!saved} onClick={() => reset('home')}>{t('Done')}</PrimaryButton>}
          </>
        )}

        {view === 'home' && on && (
          <>
            <div className="glass flex items-center gap-3 rounded-[22px] p-4"><ShieldCheckIcon size={22} className="shrink-0 text-mint" /><span className="text-[14px] text-fg-2">{t('Protection is on. Only sealed data is stored on this device.')}</span></div>
            <button type="button" onClick={() => void vault.lock()} className="press glass flex items-center gap-3 rounded-[20px] px-4 py-3.5 text-left"><LockKeyIcon size={20} />{t('Lock now')}</button>

            <div className="glass rounded-[20px] p-4">
              <div className="mb-2.5 text-[13px] text-fg-3">{t('Lock automatically')}</div>
              <div className="flex flex-wrap gap-2">
                {LOCK_CHOICES.map(m => <button key={m} type="button" aria-pressed={minutes === m} onClick={() => { vault.setAutoLockMinutes(m); setMinutes(m) }} className={`press rounded-full px-3.5 py-2 text-[13.5px] ${minutes === m ? 'bg-fg text-ink font-semibold' : 'bg-white/[0.07]'}`}>{m === 0 ? t('Never') : m === 60 ? t('1 hour') : t('{n} min', { n: m })}</button>)}
              </div>
              <p className="mt-2 text-[12.5px] text-fg-4">{t('Counts from the last tap, and from leaving the app.')}</p>
            </div>

            {passkeySupported() && (
              <div className="glass rounded-[20px] p-4">
                <div className="mb-2.5 flex items-center gap-2 text-[13px] text-fg-3"><FingerprintIcon size={16} />{t('Passkeys')}</div>
                {keys.map(k => (
                  <div key={k.credentialId} className="flex items-center justify-between gap-3 py-1.5 text-[14px]">
                    <span className="min-w-0 flex-1 truncate">{k.label || t('Passkey')} <span className="text-fg-4">· {dateLong(k.createdAt)}</span></span>
                    <button type="button" aria-label={t('Remove')} onClick={() => removePasskey(k.credentialId!)} className="press hit grid h-8 w-8 place-items-center rounded-full text-fg-3"><TrashIcon size={16} /></button>
                  </div>
                ))}
                {keys.length === 0 && <p className="mb-2 text-[13px] text-fg-3">{t('Open Aster with Face ID, a fingerprint or a security key instead of typing the password.')}</p>}
                <button type="button" disabled={busy} onClick={addPasskey} className="press hit mt-1 rounded-full bg-white/[0.07] px-4 py-2.5 text-[14px]">{t('Add a passkey')}</button>
                {errorLine}
              </div>
            )}

            <button type="button" onClick={() => reset('password')} className="press glass flex items-center gap-3 rounded-[20px] px-4 py-3.5 text-left"><KeyIcon size={20} />{t('Change the password')}</button>
            <button type="button" onClick={() => reset('newRecovery')} className="press glass flex items-center gap-3 rounded-[20px] px-4 py-3.5 text-left"><KeyIcon size={20} />{t('Make a new recovery key')}</button>
            <button type="button" onClick={() => reset('turnOff')} className="press flex items-center gap-3 px-4 py-3 text-left text-danger"><TrashIcon size={20} />{t('Turn protection off')}</button>
          </>
        )}

        {view === 'password' && (<>{confirmField}{pair(t('New password'))}{errorLine}<PrimaryButton className="w-full" disabled={busy} onClick={changePassword}>{busy ? t('Working…') : t('Change the password')}</PrimaryButton>{back}</>)}
        {view === 'newRecovery' && (<>{confirmField}<p className="px-1 text-[13px] text-fg-3">{t('The old recovery key stops working.')}</p>{errorLine}<PrimaryButton className="w-full" disabled={busy || !current} onClick={newRecovery}>{busy ? t('Working…') : t('Make a new recovery key')}</PrimaryButton>{back}</>)}
        {view === 'turnOff' && (<>{confirmField}<p className="px-1 text-[13px] text-fg-3">{t('Your data will be stored on this device without encryption again.')}</p>{errorLine}<PrimaryButton className="w-full" disabled={busy || !current} onClick={turnOff}>{busy ? t('Working…') : t('Turn protection off')}</PrimaryButton>{back}</>)}
      </div>
      <div className="h-4" />
    </Sheet>
  )
}
