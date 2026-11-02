import { DeviceMobileIcon, ExportIcon, PlusSquareIcon } from '@phosphor-icons/react'
import { t } from '@/i18n'

/** The three taps that move the app out of Safari's reach: numbered, with the icon of what to tap. */
export function InstallGuide() {
  const steps = [
    { icon: ExportIcon, text: t('Tap Share, the square with an arrow') },
    { icon: PlusSquareIcon, text: t('Choose “Add to Home Screen”') },
    { icon: DeviceMobileIcon, text: t('Open Aster from the new icon and set it up there. The Home Screen app has its own storage.') },
  ]
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((s, i) => (
        <li key={i} className="glass flex items-center gap-3.5 rounded-[20px] py-3 pl-3.5 pr-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warm/15 text-warm"><s.icon size={20} weight="bold" /></span>
          <span className="min-w-0 flex-1 text-[14.5px] leading-snug text-fg-2"><span className="tnum mr-1.5 font-semibold text-fg">{i + 1}.</span>{s.text}</span>
        </li>
      ))}
    </ol>
  )
}
