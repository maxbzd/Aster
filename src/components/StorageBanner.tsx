import { useEffect } from 'react'
import { WarningIcon, XIcon } from '@phosphor-icons/react'
import { useUI } from '@/app/store'
import { freeUpSpace } from '@/data/actions'
import { dismissNotice, refreshEstimate, resolveFull, storageLevel, useStorageHealth } from '@/lib/storageHealth'
import { t } from '@/i18n'

/**
 * Tells the person, at once and plainly, when the device has no room left for their data: a change that was refused
 * is NOT saved, and silence there would turn into a missing record weeks later. Before that, a softer notice from 90 % of
 * the browser's allowance. Both offer the two things that help: a backup, and clearing what can be rebuilt.
 */
export function StorageBanner() {
  const health = useStorageHealth()
  const level = storageLevel(health)
  const toast = useUI(s => s.toast)
  const open = useUI(s => s.open)

  // look at the room now, and again whenever the app comes back to the front
  useEffect(() => {
    void refreshEstimate()
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshEstimate() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (level === 'ok' || (health.dismissed && level !== 'full')) return null
  const full = level === 'full'
  return (
    <div role={full ? 'alert' : 'status'} className="fixed inset-x-0 top-[calc(8px+var(--safe-top))] z-[65] flex justify-center px-3">
      <div className="glass-strong w-full max-w-[560px] rounded-[22px] py-3 pl-4 pr-3">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${full ? 'bg-danger/20 text-danger' : 'bg-warm/15 text-warm'}`}><WarningIcon size={17} weight="bold" /></span>
          <div className="min-w-0 flex-1 text-[13.5px] leading-snug text-fg-2">
            <div className="font-semibold text-fg">{full ? t('Storage is full') : t('Storage is almost full')}</div>
            <p className="mt-0.5">{full ? t('The last change was not saved. Nothing saved earlier is lost. Make a backup, free some space and try again.') : t('Aster is close to the space your browser allows. Make a backup and free some space before it runs out.')}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" onClick={() => open({ kind: 'backup' })} className="press hit rounded-full bg-fg px-3.5 py-2 text-[13px] font-semibold text-ink">{t('Make a backup')}</button>
              <button
                type="button"
                onClick={() => { void freeUpSpace().then(async () => { await refreshEstimate(); resolveFull(); toast(t('Space freed')) }).catch(() => toast(t("Couldn't free space"), 'info')) }}
                className="press hit rounded-full bg-white/[0.1] px-3.5 py-2 text-[13px] font-semibold text-fg"
              >{t('Free up space')}</button>
            </div>
          </div>
          <button type="button" aria-label={t('Close')} onClick={dismissNotice} className="press hit grid h-8 w-8 shrink-0 place-items-center rounded-full text-fg-3"><XIcon size={14} /></button>
        </div>
      </div>
    </div>
  )
}
