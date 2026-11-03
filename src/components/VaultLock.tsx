import { useState } from 'react'
import { FingerprintIcon, KeyIcon, LockKeyIcon } from '@phosphor-icons/react'
import { SpaceBackground } from '@/components/Page'
import { Logo } from '@/components/Nav'
import { PrimaryButton } from '@/components/ui'
import { passkeySupported, askVaultPasskey, PasskeyError } from '@/vault/passkey'
import { passkeys } from '@/vault/keys'
import { vault } from '@/vault'
import { useVaultState } from '@/vault/state'
import { t } from '@/i18n'

type Way = 'password' | 'recovery'

export default function VaultLock() {
  const busy = useVaultState(s => s.busy)
  const [way, setWay] = useState<Way>('password')
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [erase, setErase] = useState(false)
  const header = vault.header()
  const hasPasskey = !!header && passkeys(header).length > 0 && passkeySupported()

  const explain = (r: Awaited<ReturnType<typeof vault.unlock>>) => {
    if (r === 'wrong') setMessage(way === 'password' ? t('Wrong password.') : t('That recovery key does not match.'))
    else if (r === 'wait') setMessage(t('Too many tries. Wait {n} seconds.', { n: vault.secondsUntilRetry() }))
    else if (r === 'tab') setMessage(t('Aster is open in another window. Close it and try again.'))
    else if (r === 'error') setMessage(t('The data could not be opened.'))
  }

  const submit = async () => {
    if (!secret || busy) return
    setMessage(null)
    const r = await vault.unlock(way === 'password' ? { kind: 'password', password: secret } : { kind: 'recovery', key: secret })
    if (r !== 'ok') explain(r)
  }

  const withPasskey = async () => {
    setMessage(null)
    try {
      const { credentialId, secret: s } = await askVaultPasskey(header?.wraps ?? [])
      const r = await vault.unlock({ kind: 'passkey', credentialId, secret: s })
      if (r !== 'ok') explain(r)
    } catch (e) {
      if (!(e instanceof PasskeyError && e.code === 'cancelled')) setMessage(t('The passkey did not work.'))
    }
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      <SpaceBackground />
      <main className="relative mx-auto flex min-h-[100dvh] max-w-[420px] flex-col justify-center px-6 pb-[calc(28px+var(--safe-bottom))] pt-[calc(20px+var(--safe-top))]">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo />
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/[0.06] text-fg-2"><LockKeyIcon size={26} weight="bold" /></span>
          <h1 className="text-[28px] font-bold tracking-[-0.03em]">{t('Aster is locked')}</h1>
          <p className="text-[14.5px] text-fg-3">{way === 'password' ? t('Enter your password to open your people.') : t('Enter the recovery key you saved when you turned protection on.')}</p>
        </div>

        <form onSubmit={e => { e.preventDefault(); void submit() }} className="flex flex-col gap-3">
          <input autoFocus type="password" autoComplete={way === 'password' ? 'current-password' : 'off'} spellCheck={false} aria-label={way === 'password' ? t('Password') : t('Recovery key')} value={secret}
            onChange={e => setSecret(e.target.value)} placeholder={way === 'password' ? t('Password') : 'XXXXX-XXXXX-…'}
            className="field glass rounded-[18px] px-4 py-3.5 text-[17px]" />
          {message && <p role="alert" className="px-1 text-[13.5px] text-danger">{message}</p>}
          <PrimaryButton className="w-full" type="submit" disabled={busy || !secret}>{busy ? t('Opening…') : t('Unlock')}</PrimaryButton>
        </form>

        <div className="mt-5 flex flex-col items-center gap-3 text-[14px] text-fg-3">
          {hasPasskey && <button type="button" onClick={withPasskey} className="press flex items-center gap-2 text-fg-2"><FingerprintIcon size={18} />{t('Use a passkey')}</button>}
          <button type="button" onClick={() => { setWay(w => (w === 'password' ? 'recovery' : 'password')); setSecret(''); setMessage(null) }} className="press flex items-center gap-2"><KeyIcon size={16} />{way === 'password' ? t('I forgot the password') : t('Use the password instead')}</button>
          {!erase ? (
            <button type="button" onClick={() => setErase(true)} className="press mt-4 text-[13px] text-fg-4 underline decoration-white/20 underline-offset-4">{t('I lost everything: start over')}</button>
          ) : (
            <div className="glass mt-3 flex flex-col gap-3 rounded-[20px] p-4 text-center">
              <p className="text-[13.5px] text-fg-2">{t('This deletes all your people and notes on this device for good. Only a backup file can bring them back.')}</p>
              <button type="button" onClick={() => void vault.eraseEverything()} className="press hit rounded-full bg-danger/20 px-4 py-2.5 text-[14px] font-semibold text-danger">{t('Delete everything')}</button>
              <button type="button" onClick={() => setErase(false)} className="press text-[13px] text-fg-3">{t('Cancel')}</button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
