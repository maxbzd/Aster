import { useNavigate } from 'react-router'
import { Segmented } from '@/components/ui'
import { t } from '@/i18n'

export type OrbitView = 'orbit' | 'graph' | 'weak'

/** Три взгляда на сеть: кто на каких орбитах, кто кого знает, у кого скрытый потенциал. */
export function OrbitSwitch({ value }: { value: OrbitView }) {
  const nav = useNavigate()
  return (
    <Segmented<OrbitView>
      className="mt-4"
      value={value}
      onChange={v => nav(v === 'orbit' ? '/orbit' : v === 'graph' ? '/graph' : '/weak', { replace: true })}
      options={[{ value: 'orbit', label: t('Orbits') }, { value: 'graph', label: t('Links') }, { value: 'weak', label: t('Potential') }]}
    />
  )
}
