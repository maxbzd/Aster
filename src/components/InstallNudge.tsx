import { motion } from 'motion/react'
import { useState } from 'react'
import { WarningIcon, XIcon } from '@phosphor-icons/react'
import { stagger } from '@/components/ui'
import { InstallGuide } from '@/components/InstallGuide'
import { snoozeInstallNudge } from '@/lib/storage'
import { t } from '@/i18n'

/** The reminder on the home screen for iPhone in a Safari tab: where the browser may delete the data after a week. */
export default function InstallNudge({ onSnooze }: { onSnooze: () => void }) {
  const [howOpen, setHowOpen] = useState(false)
  return (
    <motion.div variants={stagger.item} className="glass mt-5 rounded-[22px] py-3 pl-4 pr-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warm/15 text-warm"><WarningIcon size={18} /></span>
        <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-fg-2"><span className="font-semibold text-fg">{t('Safari may delete your data')}</span>{' '}{t('Add Aster to your Home Screen so it keeps your people safe.')}</span>
        <button type="button" aria-expanded={howOpen} onClick={() => setHowOpen(o => !o)} className="press hit rounded-full bg-fg px-3.5 py-2 text-[13px] font-semibold text-ink">{t('How')}</button>
        <button type="button" aria-label={t('Remind me later')} onClick={() => { snoozeInstallNudge(); onSnooze() }} className="press hit grid h-8 w-8 shrink-0 place-items-center rounded-full text-fg-3"><XIcon size={14} /></button>
      </div>
      {howOpen && <div className="mt-3 pr-1"><InstallGuide /></div>}
    </motion.div>
  )
}
