import { useState, type FormEvent } from 'react'
import { ArrowsClockwiseIcon, CheckCircleIcon, CloudIcon, CloudSlashIcon, SignOutIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Field, TextInput } from '@/components/forms'
import { GlassButton, Group, PrimaryButton, Row, Segmented } from '@/components/ui'
import { MIN_PASSWORD, validEmail } from '@/cloud/auth'
import { deleteAccount, resetPassword, resync, setNewPassword, signIn, signOut, signUp, syncNow, UnsyncedError } from '@/cloud/cloud'
import { statusLine } from '@/cloud/status'
import { useCloud } from '@/cloud/store'
import { useUI } from '@/app/store'
import { t, tn } from '@/i18n'

type Mode = 'in' | 'up' | 'reset'

const TONE = { ok: 'text-mint', busy: 'text-fg-2', warn: 'text-[#ffd27a]', bad: 'text-danger' } as const

export function CloudSheet({ onClose }: { onClose: () => void }) {
  const cloud = useCloud()
  const toast = useUI(s => s.toast)
  const signedIn = !!cloud.userId
  return (
    <Sheet onClose={onClose} title={t('Cloud')} subtitle={signedIn ? cloud.email : t('Data on all your devices')} glow="rgb(95 227 176 / 0.25)">
      {cloud.recovery && signedIn ? <NewPassword onDone={() => toast(t('Password changed'))} />
        : signedIn ? <Account onClose={onClose} />
        : <Auth />}
      <div className="h-4" />
    </Sheet>
  )
}

/* ---------- вход и регистрация ---------- */

function Auth() {
  const cloud = useCloud()
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<null | 'confirm' | 'reset'>(null)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setError(null)
    if (!validEmail(email)) return setError(t('Check the email address'))
    if (mode !== 'reset' && !password) return setError(t('Enter a password'))
    if (mode === 'up' && password.length < MIN_PASSWORD) return setError(t('The password must be at least {MIN_PASSWORD} characters', { MIN_PASSWORD }))
    setBusy(true)
    try {
      if (mode === 'in') await signIn(email, password)
      else if (mode === 'up') { if ((await signUp(email, password)) === 'confirm') setSent('confirm') }
      else { await resetPassword(email); setSent('reset') }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed'))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-2 text-center">
        <CheckCircleIcon size={44} weight="duotone" className="mx-auto text-mint" />
        <div className="mt-3 text-[19px] font-semibold">{t('Check your email')}</div>
        <p className="mx-auto mt-2 max-w-[340px] text-[14.5px] leading-relaxed text-fg-3">
          {sent === 'confirm'
            ? <>{t('We sent an email to “')}{email.trim()}{t("”. Click the link in it to confirm the address, then come back here — you'll sign in with this password.")}</>
            : <>{t('We sent a password-reset link to “')}{email.trim()}{t('”. Open it on this device.')}</>}
        </p>
        <GlassButton className="mt-6 w-full" onClick={() => { setSent(null); setMode('in') }}>{t('Sign in')}</GlassButton>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className="px-1 text-[14.5px] leading-relaxed text-fg-3">
        {t('Sign in so your people, notes and reminders are on all your devices. Your data stays on this device and is copied to a protected cloud — without internet everything works as before.')}
      </p>
      {cloud.expired && <div className="mt-3 rounded-[16px] bg-[#ffd27a]/10 px-4 py-3 text-[13.5px] text-[#ffd27a]">{t('Your session expired — sign in again. The data on this device is intact.')}</div>}
      <Segmented className="mt-4" value={mode} onChange={m => { setMode(m); setError(null) }}
        options={[{ value: 'in', label: t('Sign in') }, { value: 'up', label: t('Create account') }]} />

      <div className="mt-3 overflow-hidden rounded-[22px] border border-line bg-white/[0.03] [&>*+*]:border-t [&>*+*]:border-line">
        <Field label={t('Email')}>
          <TextInput type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="name@mail.com" value={email} onChange={e => setEmail(e.target.value)} aria-label={t('Email')} />
        </Field>
        {mode !== 'reset' && (
          <Field label={t('Password')} hint={mode === 'up' ? t('At least {MIN_PASSWORD} characters', { MIN_PASSWORD }) : undefined}>
            <TextInput type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} aria-label={t('Password')} />
          </Field>
        )}
      </div>

      {error && <div role="alert" className="mt-3 flex items-start gap-2 px-1 text-[13.5px] text-danger"><WarningCircleIcon size={17} className="mt-0.5 shrink-0" />{error}</div>}

      <PrimaryButton type="submit" className="mt-5 w-full" disabled={busy}>
        {busy ? t('Wait…') : mode === 'in' ? t('Sign in') : mode === 'up' ? t('Create account') : t('Send link')}
      </PrimaryButton>

      <div className="mt-4 text-center text-[13.5px]">
        {mode === 'reset'
          ? <button type="button" className="press text-fg-3" onClick={() => setMode('in')}>{t('I remembered my password — sign in')}</button>
          : mode === 'in' && <button type="button" className="press text-fg-3" onClick={() => { setMode('reset'); setError(null) }}>{t('Forgot password')}</button>}
      </div>
      <p className="mt-5 px-1 text-center text-[12px] leading-relaxed text-fg-4">{t("Astra's keys stay on this device only and are never sent to the cloud.")}</p>
    </form>
  )
}

/* ---------- новый пароль после ссылки из письма ---------- */

function NewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy(true); setError(null)
    try { await setNewPassword(pw); onDone() } catch (err) { setError(err instanceof Error ? err.message : t('Failed')) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save}>
      <p className="px-1 text-[14.5px] leading-relaxed text-fg-3">{t('Choose a new password for signing in to the cloud.')}</p>
      <div className="mt-3 overflow-hidden rounded-[22px] border border-line bg-white/[0.03]">
        <Field label={t('New password')} hint={t('At least {MIN_PASSWORD} characters', { MIN_PASSWORD })}>
          <TextInput type="password" autoComplete="new-password" autoFocus value={pw} onChange={e => setPw(e.target.value)} aria-label={t('New password')} />
        </Field>
      </div>
      {error && <div role="alert" className="mt-3 px-1 text-[13.5px] text-danger">{error}</div>}
      <PrimaryButton type="submit" className="mt-5 w-full" disabled={busy || pw.length < MIN_PASSWORD}>{t('Save password')}</PrimaryButton>
    </form>
  )
}

/* ---------- аккаунт ---------- */

function Account({ onClose }: { onClose: () => void }) {
  const cloud = useCloud()
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState<null | 'sync' | 'resync' | 'out' | 'del'>(null)
  const [confirm, setConfirm] = useState<null | 'out' | 'del'>(null)
  const [error, setError] = useState<string | null>(null)
  const [unsynced, setUnsynced] = useState(0)
  const st = statusLine(cloud)

  const run = async (kind: 'sync' | 'resync', fn: () => Promise<void>, done: string) => {
    setBusy(kind); setError(null)
    try { await fn(); toast(done) } catch (e) { setError(e instanceof Error ? e.message : t('Failed')) } finally { setBusy(null) }
  }

  const doSignOut = async (force = false) => {
    setBusy('out'); setError(null)
    try { await signOut({ force }); onClose() } catch (e) {
      if (e instanceof UnsyncedError) setUnsynced(e.pending)
      else setError(e instanceof Error ? e.message : t('Failed'))
    } finally { setBusy(null) }
  }

  const doDelete = async () => {
    setBusy('del'); setError(null)
    try { await deleteAccount(); toast(t('Account and cloud data deleted'), 'info'); onClose() } catch (e) { setError(e instanceof Error ? e.message : t('Failed')) } finally { setBusy(null) }
  }

  return (
    <div>
      <div className="flex items-center gap-3.5 rounded-[22px] border border-line bg-white/[0.03] p-4">
        {cloud.phase === 'offline' ? <CloudSlashIcon size={28} className="text-[#ffd27a]" /> : <CloudIcon size={28} weight="duotone" className={TONE[st.tone]} />}
        <div className="min-w-0 flex-1">
          <div className={`text-[15px] font-semibold ${TONE[st.tone]}`} role="status">{st.text}</div>
          <div className="truncate text-[13px] text-fg-3">{cloud.email}</div>
        </div>
      </div>
      {cloud.rejected > 0 && <div role="alert" className="mt-3 rounded-[16px] bg-[#ffd27a]/10 px-4 py-3 text-[13.5px] text-[#ffd27a]">{t("Couldn't send")}{' '}{tn(cloud.rejected, '{n} record', '{n} records')}{t(': the server rejects them (too large or corrupted). The rest syncs as usual; “Full resync” will try again.')}</div>}
      {cloud.notice && <div className="mt-3 rounded-[16px] bg-white/[0.05] px-4 py-3 text-[13.5px] text-fg-2">{cloud.notice}</div>}
      {error && <div role="alert" className="mt-3 px-1 text-[13.5px] text-danger">{error}</div>}

      <div className="mt-4">
        <Group>
          <Row icon={ArrowsClockwiseIcon} label={t('Sync now')} sub={t('This usually happens on its own, a couple of seconds after an edit')}
            onClick={busy ? undefined : () => void run('sync', syncNow, t('Done'))} trailing={busy === 'sync' ? <span className="text-[12.5px] text-fg-3">…</span> : undefined} />
          <Row icon={ArrowsClockwiseIcon} iconColor="#7fd6ff" label={t('Full resync')} sub={t('If devices disagree: re-uploads everything in both directions')}
            onClick={busy ? undefined : () => void run('resync', resync, t('Resynced'))} trailing={busy === 'resync' ? <span className="text-[12.5px] text-fg-3">…</span> : undefined} />
        </Group>
      </div>

      <div className="mt-4">
        <Group>
          {confirm !== 'out' ? (
            <Row icon={SignOutIcon} label={t('Sign out on this device')} sub={t('Cloud data stays, and this device is cleared')} onClick={() => { setConfirm('out'); setUnsynced(0) }} />
          ) : (
            <div className="px-4 py-3.5">
              <div className="text-[15px] font-semibold">{t('Sign out and remove data from this device?')}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
                {unsynced
                  ? t("Not sent: {pl} — if you sign out now they'll be lost. Connect to the internet and retry, or make a backup to a file.", { pl: tn(unsynced, '{n} change', '{n} changes') })
                  : t('Everything on this device is already in the cloud. Sign in again and your data comes back.')}
              </p>
              <div className="mt-3 flex gap-2">
                <GlassButton className="flex-1" onClick={() => setConfirm(null)}>{t('Cancel')}</GlassButton>
                <PrimaryButton className="flex-1" disabled={busy === 'out'} onClick={() => void doSignOut(unsynced > 0)}>{unsynced ? t('Sign out anyway') : t('Sign out')}</PrimaryButton>
              </div>
            </div>
          )}
        </Group>
      </div>

      <div className="mt-4">
        <Group>
          {confirm !== 'del' ? (
            <Row icon={TrashIcon} iconColor="#ff5f6d" label={<span className="text-danger">{t('Delete account and cloud data')}</span>} sub={t('Data on this device will remain')} onClick={() => setConfirm('del')} />
          ) : (
            <div className="px-4 py-3.5">
              <div className="text-[15px] font-semibold text-danger">{t('Delete the account permanently?')}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-3">{t('The cloud copy will be erased irreversibly. Data on other devices will remain but will stop syncing.')}</p>
              <div className="mt-3 flex gap-2">
                <GlassButton className="flex-1" onClick={() => setConfirm(null)}>{t('Cancel')}</GlassButton>
                <PrimaryButton className="flex-1 !bg-danger" disabled={busy === 'del'} onClick={() => void doDelete()}>{t('Delete')}</PrimaryButton>
              </div>
            </div>
          )}
        </Group>
      </div>
    </div>
  )
}
