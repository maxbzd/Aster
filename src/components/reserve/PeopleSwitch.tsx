import { useNavigate } from 'react-router'
import { Segmented } from '@/components/ui'
import { useCounts } from '@/data/hooks'
import { t } from '@/i18n'

/** Переключатель «Сеть / Резерв»: люди, с которыми общаешься, и контакты про запас. */
export function PeopleSwitch({ value }: { value: 'people' | 'reserve' }) {
  const nav = useNavigate()
  const c = useCounts()
  return (
    <Segmented
      className="mt-3"
      value={value}
      onChange={v => nav(v === 'people' ? '/people' : '/reserve', { replace: true })}
      options={[{ value: 'people', label: t('Network · {people}', { people: c.people }) }, { value: 'reserve', label: t('Reserve · {leads}', { leads: c.leads }) }]}
    />
  )
}
