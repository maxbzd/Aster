import { useNavigate } from 'react-router'
import { Segmented } from '@/components/ui'
import { useCounts } from '@/data/hooks'
import { t } from '@/i18n'

/** The "Network / Reserve" switch: people you are in touch with, and contacts kept in store. */
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
