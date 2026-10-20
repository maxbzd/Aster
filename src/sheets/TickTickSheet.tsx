import { useState } from 'react'
import { ArrowsClockwiseIcon, CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { GlassButton, PrimaryButton } from '@/components/ui'
import { useCloud } from '@/cloud/store'
import { syncedAgo } from '@/cloud/status'
import { disconnect, startConnect, syncNow, useTick } from '@/ticktick/cycle'
import { useUI } from '@/app/store'
import { t } from '@/i18n'

/** Связка с TickTick: напоминания Aster появляются в TickTick, а «выполнено» работает в обе стороны. */
export function TickTickSheet({ onClose }: { onClose: () => void }) {
  const signedIn = useCloud(c => !!c.userId)
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const value = useTick()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connected = !!value.status?.connected

  const connect = async () => {
    setBusy(true); setError(null)
    try { await startConnect() } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  const off = async () => {
    setBusy(true)
    try { await disconnect(); toast(t('TickTick disconnected'), 'info') } finally { setBusy(false) }
  }

  return (
    <Sheet onClose={onClose} title="TickTick" subtitle={t('Reminders — into your to-do list')} glow="rgb(95 227 176 / 0.25)">
      {!signedIn ? (
        <div className="px-1 pt-1">
          <p className="text-[14.5px] leading-relaxed text-fg-3">{t('The link goes through your cloud account, so sign in to the cloud first.')}</p>
          <PrimaryButton className="mt-5 w-full" onClick={() => open({ kind: 'cloud' })}>{t('Sign in to the cloud')}</PrimaryButton>
        </div>
      ) : !value.status ? (
        <p className="px-1 pt-1 text-[14.5px] text-fg-3">{t('Checking the server…')}{value.error ? ` ${value.error}` : ''}</p>
      ) : !value.status.configured ? (
        <div className="px-1 pt-1 text-[14.5px] leading-relaxed text-fg-3">
          <p>{t("TickTick isn't set up on the server yet. Create an app at developer.ticktick.com and add to the secrets of the")}{' '}<span className="font-mono text-fg-2">ticktick</span>{' '}{t('function in Supabase the values')}{' '}<span className="font-mono text-fg-2">TICKTICK_CLIENT_ID</span>{' '}{t('and')}{' '}<span className="font-mono text-fg-2">TICKTICK_CLIENT_SECRET</span>{t('. Details are in docs/TICKTICK.md.')}</p>
        </div>
      ) : connected ? (
        <div>
          <div className="glass flex items-center gap-3 rounded-[22px] p-4">
            <CheckCircleIcon size={26} weight="fill" className="shrink-0 text-mint" />
            <div className="min-w-0 flex-1">
              <div className="text-[15.5px] font-semibold">{t('Connected')}</div>
              <div className="text-[13px] text-fg-3">{value.phase === 'syncing' || value.phase === 'checking' ? t('Syncing…') : value.lastSyncAt ? t('Synced {syncedAgo}', { syncedAgo: syncedAgo(value.lastSyncAt) }) : t('Waiting for the first exchange')}</div>
            </div>
          </div>
          <ul className="mt-4 space-y-2 px-1 text-[14px] leading-relaxed text-fg-3">
            <li>{t('• New Aster reminders appear in TickTick (in the Inbox) within a minute.')}</li>
            <li>{t('• Mark done here — the task closes in TickTick. Close it in TickTick — the reminder is marked here.')}</li>
            <li>{t("• Tasks from TickTick don't come into Aster, and reminders mirroring Orbita commitments are sent by Orbita itself.")}</li>
          </ul>
          {(error || value.error) && <div role="alert" className="mt-3 flex items-start gap-2 rounded-[16px] bg-danger/10 px-4 py-3 text-[13.5px] text-danger"><WarningCircleIcon size={17} className="mt-0.5 shrink-0" />{error ?? value.error}</div>}
          <div className="mt-5 flex gap-2">
            <PrimaryButton className="flex-1" disabled={busy || value.phase === 'syncing'} onClick={() => void syncNow()}><ArrowsClockwiseIcon size={17} className="mr-1.5 inline" />{t('Sync')}</PrimaryButton>
            <GlassButton className="flex-1" disabled={busy} onClick={off}>{t('Disconnect')}</GlassButton>
          </div>
        </div>
      ) : (
        <div className="px-1 pt-1">
          {value.expired && <div role="alert" className="mb-3 flex items-start gap-2 rounded-[16px] bg-danger/10 px-4 py-3 text-[13.5px] text-danger"><WarningCircleIcon size={17} className="mt-0.5 shrink-0" />{t('TickTick access has expired. Connect it again.')}</div>}
          <p className="text-[14.5px] leading-relaxed text-fg-3">{t('Aster reminders will appear in TickTick, and the “done” mark will work both ways. Tasks from TickTick are not imported into the app.')}</p>
          <PrimaryButton className="mt-5 w-full" disabled={busy} onClick={connect}>{t('Connect TickTick')}</PrimaryButton>
          {error && <div role="alert" className="mt-3 px-1 text-[13.5px] text-danger">{error}</div>}
        </div>
      )}
      <div className="h-4" />
    </Sheet>
  )
}
