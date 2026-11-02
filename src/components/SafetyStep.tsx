import { WarningIcon } from '@phosphor-icons/react'
import { InstallGuide } from '@/components/InstallGuide'
import { haptic } from '@/app/store'
import { t } from '@/i18n'

/** Onboarding, iPhone in a Safari tab: install first, because Safari may delete a tab's data after 7 idle days. */
export default function SafetyStep({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <div className="mt-12">
        <div className="micro flex items-center gap-1.5 text-warm"><WarningIcon size={13} weight="bold" />{t('Before we start')}</div>
        <h2 className="mt-3 text-[34px] font-bold leading-tight tracking-[-0.03em]">{t('Add Aster to your Home Screen')}</h2>
        <p className="mt-3 text-[15.5px] leading-relaxed text-fg-2">{t('Safari deletes the data of websites you have not opened for 7 days. Aster keeps everything on this phone, so your people could disappear. An app on the Home Screen is exempt.')}</p>
      </div>
      <div className="mt-7"><InstallGuide /></div>
      <p className="mt-5 text-[13.5px] leading-relaxed text-fg-3">{t('Also save a backup now and then (Profile, Backup) and keep the file in iCloud Drive.')}</p>
      <div className="flex-1" />
      <button type="button" onClick={() => { haptic(5); onContinue() }} className="press mt-6 w-full text-center text-[14px] text-fg-3 underline decoration-white/20 underline-offset-4">{t('Continue without installing')}</button>
    </>
  )
}
