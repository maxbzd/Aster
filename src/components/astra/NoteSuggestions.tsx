import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { BellSimpleIcon, CakeIcon, ChatTeardropTextIcon, GiftIcon, HandHeartIcon, HouseLineIcon, MagnifyingGlassIcon, SparkleIcon, TagIcon, type Icon } from '@phosphor-icons/react'
import { astraNoteSuggest, quickNoteSuggestions } from '@/ai/astra'
import type { NoteSuggestions as NS } from '@/ai/schemas'
import { useAstraStatus } from '@/ai/hooks'
import { addReminder, patchPerson } from '@/data/actions'
import { usePeople } from '@/data/hooks'
import { uid } from '@/data/db'
import { dateShort, fromISODate } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { Person } from '@/data/types'
import { AstraStar } from './Astra'
import { t } from '@/i18n'

type Item = NS['items'][number]
const KIND: Record<Item['kind'], { icon: Icon; label: string; color: string }> = {
  reminder: { icon: BellSimpleIcon, get label() { return t('Remind') }, color: '#ffd27a' },
  fact: { icon: SparkleIcon, get label() { return t('Fact') }, color: '#ff8fb8' },
  topic: { icon: ChatTeardropTextIcon, get label() { return t('Ask later') }, color: '#a796ff' },
  family: { icon: HouseLineIcon, get label() { return t('Family') }, color: '#ffb36b' },
  looking_for: { icon: MagnifyingGlassIcon, get label() { return t('Looking for') }, color: '#7fd6ff' },
  can_help: { icon: HandHeartIcon, get label() { return t('Strong in') }, color: '#5fe3b0' },
  birthday: { icon: CakeIcon, get label() { return t('Birthday') }, color: '#ff8fb8' },
  interest: { icon: TagIcon, get label() { return t('Interest') }, color: '#c9c3ff' },
  gift: { icon: GiftIcon, get label() { return t('Gift') }, color: '#ff8f8f' },
}

const keyOf = (i: Item) => `${i.kind}:${i.text}`

/** Suggestions from a note: Astra sees dates, facts and topics in the text, and you save them with one tap. */
export function NoteSuggestions({ text, person }: { text: string; person: Person }) {
  const people = usePeople()
  const status = useAstraStatus()
  const toast = useUI(s => s.toast)
  const [debounced, setDebounced] = useState(text)
  const [aiItems, setAiItems] = useState<Item[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<Set<string>>(new Set())

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), 900)
    return () => clearTimeout(timer)
  }, [text])
  useEffect(() => { setAiItems(null) }, [debounced])

  const local = useMemo(() => quickNoteSuggestions(debounced, person, people ?? []).items, [debounced, person, people])
  const items = (aiItems ?? local).filter(i => !done.has(keyOf(i)))

  const apply = async (i: Item) => {
    haptic(12)
    setDone(d => new Set(d).add(keyOf(i)))
    switch (i.kind) {
      case 'reminder': await addReminder({ personId: person.id, text: i.text, dueAt: (i.due_date ? fromISODate(i.due_date) : Date.now() + 3 * 86400000) + 10 * 3600_000 }); break
      case 'fact': await patchPerson(person.id, { facts: [...person.facts, { icon: 'sparkle', text: i.text }] }); break
      case 'topic': await patchPerson(person.id, { topics: [...person.topics, { id: uid(), text: i.text, done: false }] }); break
      case 'family': await patchPerson(person.id, { family: person.family ? `${person.family}; ${i.text}` : i.text }); break
      case 'looking_for': await patchPerson(person.id, { lookingFor: i.text }); break
      case 'can_help': await patchPerson(person.id, { canHelpMe: person.canHelpMe ? `${person.canHelpMe}; ${i.text}` : i.text }); break
      case 'birthday': if (i.due_date) await patchPerson(person.id, { birthday: i.due_date }); break
      case 'interest': await patchPerson(person.id, { tags: [...new Set([...person.tags, i.text])] }); break
      case 'gift': await patchPerson(person.id, { giftIdeas: person.giftIdeas ? `${person.giftIdeas}; ${i.text}` : i.text }); break
    }
    toast(t('{label}: saved', { label: KIND[i.kind].label }))
  }

  const deep = async () => {
    setLoading(true)
    const r = await astraNoteSuggest(text, person.id)
    setAiItems(r.data.items)
    setLoading(false)
  }

  if (!items.length && !status.connected) return null
  if (!items.length && text.trim().length < 20) return null

  return (
    <div className="mt-2.5">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#ffe2c2]"><AstraStar size={12} thinking={loading} /> {items.length ? t('Astra suggests saving') : t('Analyze the note in depth?')}</span>
        {status.connected && !aiItems && text.trim().length >= 20 && (
          <button type="button" onClick={deep} disabled={loading} className="text-[12px] font-medium text-fg-3 hover:text-fg disabled:opacity-50">{loading ? t('Thinking…') : t('✦ Analyze in depth')}</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {items.map(i => {
            const k = KIND[i.kind]
            return (
              <motion.button key={keyOf(i)} type="button" layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                onClick={() => apply(i)}
                className="press flex max-w-full items-center gap-1.5 rounded-full border py-1.5 pl-2 pr-3 text-left text-[13px]"
                style={{ borderColor: `color-mix(in srgb, ${k.color} 35%, transparent)`, background: `color-mix(in srgb, ${k.color} 10%, transparent)` }}>
                <k.icon size={14} weight="bold" style={{ color: k.color }} className="shrink-0" />
                <span className="truncate"><span className="text-fg-3">{k.label}:</span> {i.kind === 'birthday' && i.due_date ? i.due_date.replace(/^--/, '').split('-').reverse().join('.') : i.text}{i.kind === 'reminder' && i.due_date ? <span className="text-fg-3"> · {dateShort(fromISODate(i.due_date))}</span> : null}</span>
                <span className="ml-0.5 shrink-0 font-semibold" style={{ color: k.color }}>+</span>
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
