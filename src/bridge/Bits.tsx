import { PlugsConnectedIcon } from '@phosphor-icons/react'
import { Group, Row, SectionTitle } from '@/components/ui'
import { useUI } from '@/app/store'
import { agoShort } from '@/lib/format'
import { usePeerStats, useSuggestions } from './hooks'
import { t, tn } from '@/i18n'

/** A card on the "Today" screen: Orbita suggests adding something. Not shown without a connection. */
export function OrbitaSuggestionsCard() {
  const list = useSuggestions()
  const open = useUI(s => s.open)
  if (!list.length) return null
  return (
    <button type="button" onClick={() => open({ kind: 'bridge' })} className="press glass mt-5 flex w-full items-center gap-3 rounded-[22px] py-3 pl-4 pr-4 text-left">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#a796ff]/15 text-[#a796ff]"><PlugsConnectedIcon size={18} /></span>
      <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-fg-2">{t('Orbita suggests adding')}{' '}{tn(list.length, '{n} record', '{n} records')}{' '}{t('about people from your network')}</span>
      <span className="text-[13px] font-semibold text-fg">{t('Open')}</span>
    </button>
  )
}

/** A block in a person's profile: what Orbita knows about them. Only for linked people. */
export function PersonOrbita({ personId }: { personId: string }) {
  const s = usePeerStats(personId)
  const open = useUI(st => st.open)
  if (!s) return null
  const parts = [
    s.mentions != null ? t('mentions: {mentions}', { mentions: s.mentions }) : '',
    s.lastMentionAt ? t('last {agoShort}', { agoShort: agoShort(s.lastMentionAt) }) : '',
    s.openOwedToMe ? t('owed to me: {openOwedToMe}', { openOwedToMe: s.openOwedToMe }) : '',
    s.openIOwe ? t('I owe: {openIOwe}', { openIOwe: s.openIOwe }) : '',
  ].filter(Boolean)
  return (
    <>
      <SectionTitle>{t('In Orbita')}</SectionTitle>
      <Group>
        <Row icon={PlugsConnectedIcon} iconColor="#a796ff" label={parts.length ? parts.join(' · ') : t('Linked with Orbita')} sub={t('Data from the Orbita journal')} onClick={() => open({ kind: 'bridge' })} />
      </Group>
    </>
  )
}
