import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArchiveIcon, CheckIcon, DownloadSimpleIcon, FolderSimplePlusIcon, NotePencilIcon, PauseCircleIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { NoteSuggestions } from '@/components/astra/NoteSuggestions'
import { uid } from '@/data/db'
import { deletePerson, patchPerson } from '@/data/actions'
import { toVCard } from '@/data/vcard'
import { download } from '@/lib/ics'
import { WARMTH_COLORS } from '@/lib/colors'
import { fullName } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { Person } from '@/data/types'
import type { Icon } from '@phosphor-icons/react'
import { t } from '@/i18n'

export function RhythmBar({ ratio, color }: { ratio: number; color: string }) {
  const pos = Math.min(ratio / 2, 1) * 100
  return (
    <div className="relative mt-5 h-6">
      <div className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-white/[0.07]" />
      <motion.div className="absolute left-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full"
        initial={{ width: 0 }} animate={{ width: `${pos}%` }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        style={{ background: `linear-gradient(90deg, ${WARMTH_COLORS.hot}, ${color})`, boxShadow: `0 0 14px ${color}88` }} />
      <div className="absolute left-1/2 top-0 flex h-full -translate-x-1/2 flex-col items-center">
        <div className="h-full w-px bg-white/30" />
      </div>
      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wider text-fg-4">{t('rhythm')}</div>
    </div>
  )
}

export function InfoCard({ icon: I, color, title, text }: { icon: Icon; color: string; title: string; text: string }) {
  return (
    <div className="glass glow-card rounded-[24px] p-4" style={{ ['--glow' as string]: `color-mix(in srgb, ${color} 25%, transparent)`, ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
      <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color }}><I size={16} weight="duotone" />{title}</div>
      <p className="mt-2 text-[15px] leading-relaxed text-fg">{text}</p>
    </div>
  )
}

export function EmptyLine({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="press flex w-full items-center gap-3 rounded-[22px] border border-dashed border-white/12 px-4 py-4 text-left text-[14.5px] text-fg-3">
      <PlusIcon size={16} /> {text}
    </button>
  )
}

export function Topics({ p }: { p: Person }) {
  const [text, setText] = useState('')
  const add = async () => {
    const query = text.trim()
    if (!query) return
    haptic()
    await patchPerson(p.id, { topics: [...p.topics, { id: uid(), text: query, done: false }] })
    setText('')
  }
  const toggle = (id: string) => { haptic(10); patchPerson(p.id, { topics: p.topics.map(topic => (topic.id === id ? { ...topic, done: !topic.done } : topic)) }) }
  const remove = (id: string) => patchPerson(p.id, { topics: p.topics.filter(topic2 => topic2.id !== id) })
  const sorted = [...p.topics].sort((a, b) => Number(a.done) - Number(b.done))
  return (
    <div className="glass rows overflow-hidden rounded-[24px]">
      <AnimatePresence initial={false}>
        {sorted.map(sorted2 => (
          <motion.div key={sorted2.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="group flex items-center gap-3 px-4 py-3">
            <button type="button" onClick={() => toggle(sorted2.id)} aria-label={t('Discussed')}
              className={`hit press grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] ${sorted2.done ? 'border-mint bg-mint text-ink' : 'border-white/25'}`}>
              {sorted2.done && <CheckIcon size={12} weight="bold" />}
            </button>
            <span className={`flex-1 text-[15px] ${sorted2.done ? 'text-fg-3 line-through' : ''}`}>{sorted2.text}</span>
            <button type="button" onClick={() => remove(sorted2.id)} aria-label={t('Delete')} className="hit press text-fg-4 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 max-lg:opacity-60"><XIcon size={14} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.06] text-fg-3"><PlusIcon size={13} weight="bold" /></span>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder={t('What to ask next time…')} className="field h-9 flex-1 text-[15px]" enterKeyHint="done" />
        {text && <button type="button" onClick={add} className="hit press rounded-full bg-fg px-3.5 py-1.5 text-[13px] font-semibold text-ink">{t('Add')}</button>}
      </div>
    </div>
  )
}

export function Notes({ p }: { p: Person }) {
  const [v, setV] = useState(p.notes ?? '')
  const [saved, setSaved] = useState(true)
  const value2 = useRef<number>(0)
  useEffect(() => { setV(p.notes ?? '') }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const onChange = (s: string) => {
    setV(s)
    setSaved(false)
    clearTimeout(value2.current)
    value2.current = window.setTimeout(async () => { await patchPerson(p.id, { notes: s }); setSaved(true) }, 600)
  }
  return (
    <div className="glass relative rounded-[24px] p-4">
      <NotePencilIcon size={16} className="absolute right-4 top-4 text-fg-4" />
      <textarea value={v} onChange={e => onChange(e.target.value)} placeholder={t("Everything worth remembering: what you talked about, what they like, what they're busy with… Astra will suggest what to save")} rows={Math.max(4, v.split('\n').length + 1)} className="field resize-none pr-6 text-[15.5px] leading-relaxed" />
      <div className="mt-1 text-right text-[11.5px] text-fg-4">{saved ? t('Saved') : t('Saving…')}</div>
      <NoteSuggestions text={v} person={p} />
    </div>
  )
}

export function MoreMenu({ p, onClose }: { p: Person; onClose: () => void }) {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const open = useUI(s => s.open)
  const [confirm, setConfirm] = useState(false)
  const items = [
    { icon: PauseCircleIcon, label: p.lifeStatus ? t('Relationship status…') : t('Lost touch, paused…'), run: () => open({ kind: 'status', personId: p.id }) },
    { icon: FolderSimplePlusIcon, label: t('Add to a list…'), run: () => open({ kind: 'collectionPick', personIds: [p.id] }) },
    { icon: DownloadSimpleIcon, label: t('Export to contacts (.vcf)'), run: () => { download(`${fullName(p)}.vcf`, toVCard(p), 'text/vcard'); toast(t('Card downloaded')) } },
    { icon: ArchiveIcon, label: p.archived ? t('Restore from archive') : t('Archive'), run: async () => { await patchPerson(p.id, { archived: !p.archived }); toast(p.archived ? t('Restored from archive') : t('Moved to archive'), 'info') } },
  ]
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.9, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        className="glass-strong absolute right-0 top-[52px] z-50 w-[270px] origin-top-right overflow-hidden rounded-[22px] p-1.5">
        {items.map(it => (
          <button key={it.label} type="button" onClick={() => { it.run(); onClose() }} className="press flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-[14.5px] hover:bg-white/[0.06]">
            <it.icon size={18} className="text-fg-2" /> {it.label}
          </button>
        ))}
        <div className="my-1 h-px bg-line" />
        {!confirm ? (
          <button type="button" onClick={() => setConfirm(true)} className="press flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-[14.5px] text-danger hover:bg-danger/10">
            <TrashIcon size={18} />{' '}{t('Delete permanently')}
          </button>
        ) : (
          <button type="button" onClick={async () => { onClose(); nav('/people', { replace: true }); await deletePerson(p.id); toast(t('Card deleted'), 'info') }}
            className="press flex w-full items-center gap-3 rounded-[16px] bg-danger/15 px-3 py-2.5 text-left text-[14.5px] font-semibold text-danger">
            <TrashIcon size={18} weight="bold" />{' '}{t('Really delete?')}
          </button>
        )}
      </motion.div>
    </>
  )
}
