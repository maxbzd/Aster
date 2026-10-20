import { useState } from 'react'
import { Segmented } from '@/components/ui'
import { changeLocalePref, getLocalePref, LOCALES, t, useLocale, type LocalePref } from '@/i18n'

/** Auto (follows the browser) plus every supported language, each named in itself. */
export function LanguagePicker({ className = '' }: { className?: string }) {
  useLocale()
  const [pref, setPref] = useState<LocalePref>(getLocalePref)
  const options: { value: LocalePref; label: string }[] = [
    { value: 'auto', label: t('Auto') },
    ...LOCALES.map(l => ({ value: l.id as LocalePref, label: l.native })),
  ]
  return (
    <Segmented options={options} value={pref} className={className} onChange={v => { setPref(v); void changeLocalePref(v) }} />
  )
}
