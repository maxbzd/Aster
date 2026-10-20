import { useState } from 'react'
import { PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { CHANNEL_ORDER, CHANNELS } from '@/components/icons'
import { canonTag } from '@/data/leadParse'
import { PALETTES, PALETTE_KEYS, hashString } from '@/lib/colors'
import type { Channel } from '@/data/types'
import { t } from '@/i18n'

/** У каждого тега — свой оттенок, одинаковый везде. */
export const tagColor = (tag: string) => PALETTES[PALETTE_KEYS[hashString(tag.toLowerCase()) % PALETTE_KEYS.length]].to

export function TagPill({ tag, className = '' }: { tag: string; className?: string }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-white/[0.07] px-2 text-[11.5px] font-medium text-fg-2 ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tagColor(tag), boxShadow: `0 0 6px ${tagColor(tag)}` }} />
      {tag}
    </span>
  )
}

/** Теги: выбранные + поле ввода + подсказки одним тапом. */
export function TagInput({ value, onChange, suggestions = [], placeholder = t('Investor, lawyer… Enter') }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[]; placeholder?: string }) {
  const [text, setText] = useState('')
  const add = (raw: string) => {
    const value2 = canonTag(raw)
    if (!value2) return
    if (!value.some(x => x.toLowerCase() === value2.toLowerCase())) onChange([...value, value2])
    setText('')
  }
  const rest = suggestions.filter(s => !value.some(x => x.toLowerCase() === s.toLowerCase())).slice(0, 10)
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map(value3 => (
          <button key={value3} type="button" onClick={() => onChange(value.filter(x => x !== value3))} className="press flex h-8 items-center gap-1.5 rounded-full bg-white/[0.09] pl-2.5 pr-2 text-[13.5px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: tagColor(value3) }} /> {value3} <XIcon size={11} className="text-fg-3" />
          </button>
        ))}
        <input value={text} onChange={e => setText(e.target.value)} placeholder={value.length ? t('more…') : placeholder}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); add(text) } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)) }}
          onBlur={() => text.trim() && add(text)} className="field h-8 min-w-[110px] flex-1 px-1 text-[15px]" />
      </div>
      {rest.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {rest.map(s => (
            <button key={s} type="button" onClick={() => add(s)} className="press flex h-7 items-center gap-1 rounded-full border border-dashed border-white/18 px-2.5 text-[12.5px] text-fg-3 hover:text-fg-2">
              <PlusIcon size={10} weight="bold" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const QUICK: Channel['type'][] = ['telegram', 'phone', 'email', 'linkedin', 'instagram', 'whatsapp']

/** Контакты: по строке на канал. */
export function ChannelsEditor({ value, onChange }: { value: Channel[]; onChange: (v: Channel[]) => void }) {
  return (
    <>
      {value.map((c, i) => {
        const meta = CHANNELS[c.type]
        return (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]"><meta.icon size={17} /></span>
            <div className="min-w-0 flex-1">
              <div className="micro mb-1 text-fg-4">{meta.label}</div>
              <input value={c.value} autoFocus={!c.value} onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder={meta.placeholder} className="field text-[16px]" inputMode={c.type === 'phone' || c.type === 'whatsapp' ? 'tel' : c.type === 'email' ? 'email' : 'text'} />
            </div>
            <button type="button" aria-label={t('Delete')} onClick={() => onChange(value.filter((_, j) => j !== i))} className="hit press text-fg-4 hover:text-danger"><TrashIcon size={16} /></button>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-1.5 px-3 py-3">
        {(value.length ? CHANNEL_ORDER : QUICK).map(item => (
          <button key={item} type="button" onClick={() => onChange([...value, { type: item, value: '' }])} className="press flex h-8 items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-3 text-[13px] text-fg-2">
            <PlusIcon size={12} weight="bold" /> {CHANNELS[item].label}
          </button>
        ))}
      </div>
    </>
  )
}

/** Переключатель в стиле iOS — как в напоминаниях. */
export function Switch({ on }: { on: boolean }) {
  return (
    <span className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${on ? 'bg-mint' : 'bg-white/15'}`}>
      <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
    </span>
  )
}
