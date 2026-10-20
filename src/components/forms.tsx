import { useEffect, useMemo, useRef, useState, type ComponentProps, type InputHTMLAttributes, type ReactNode } from 'react'
import { CheckIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { Avatar } from './Avatar'
import { usePeople } from '@/data/hooks'
import { fullName, jobLine } from '@/lib/format'
import { searchByName } from '@/lib/names'
import type { ID } from '@/data/types'
import { haptic } from '@/app/store'
import { t } from '@/i18n'

/** An Oura-style field: the label above, the value large. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  // not a <label>: it may contain suggestion buttons, and nested interactive elements are invalid.
  // A tap on the empty space and on the label still puts the cursor in the field.
  return (
    <div className="block cursor-text px-4 py-3" onClick={e => { const target2 = e.target as HTMLElement; if (target2 === e.currentTarget || target2.dataset.fieldLabel) e.currentTarget.querySelector<HTMLElement>('input, textarea')?.focus() }}>
      <span data-field-label className="micro mb-1.5 block text-fg-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-fg-4">{hint}</span>}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`field text-[16.5px] ${props.className ?? ''}`} />
}

export function TextArea(props: ComponentProps<'textarea'>) {
  return <textarea rows={3} {...props} className={`field resize-none text-[16px] leading-relaxed ${props.className ?? ''}`} />
}

export function FormGroup({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-5">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between px-1">
          {title && <span className="micro text-fg-3">{title}</span>}
          {action}
        </div>
      )}
      <div className="rows overflow-hidden rounded-[22px] border border-line bg-white/[0.04]">{children}</div>
    </div>
  )
}

/** A people picker with search. */
export function PersonPicker({ value, onChange, multi = true, exclude = [], placeholder = t('Find a person…') }: { value: ID[]; onChange: (v: ID[]) => void; multi?: boolean; exclude?: ID[]; placeholder?: string }) {
  const people = usePeople()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const query = q.trim().toLowerCase()
    const pool = (people ?? []).filter(p => !exclude.includes(p.id))
    // the name is searched with transliteration and short forms (Alexey → Алексей, Саша → Александр), the company by substring
    const byName = new Set(query ? searchByName(query, pool).map(p => p.id) : [])
    return pool
      .filter(p => !query || byName.has(p.id) || `${fullName(p)} ${p.company ?? ''}`.toLowerCase().includes(query))
      .sort((a, b) => Number(value.includes(b.id)) - Number(value.includes(a.id)) || (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0))
      .slice(0, 30)
  }, [people, q, value, exclude])
  const selected = (people ?? []).filter(p => value.includes(p.id))
  const toggle = (id: ID) => {
    haptic(5)
    if (multi) onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])
    else onChange(value.includes(id) ? [] : [id])
  }
  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {selected.map(p => (
            <button key={p.id} type="button" onClick={() => toggle(p.id)} className="press flex items-center gap-1.5 rounded-full bg-fg py-1 pl-1 pr-2.5 text-[13.5px] font-medium text-ink">
              <Avatar person={p} size={24} /> {p.firstName} <XIcon size={12} weight="bold" />
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-[20px] border border-line bg-white/[0.04]">
        <div className="flex h-11 items-center gap-2 border-b border-line px-3.5">
          <MagnifyingGlassIcon size={16} className="text-fg-3" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="field text-[15px]" />
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          {list.map(p => {
            const on = value.includes(p.id)
            return (
              <button key={p.id} type="button" onClick={() => toggle(p.id)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-white/[0.04]">
                <Avatar person={p} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px]">{fullName(p)}</span>
                  {jobLine(p) && <span className="block truncate text-[12px] text-fg-3">{jobLine(p)}</span>}
                </span>
                <span className={`grid h-5 w-5 place-items-center rounded-full border ${on ? 'border-fg bg-fg text-ink' : 'border-white/25'}`}>{on && <CheckIcon size={11} weight="bold" />}</span>
              </button>
            )
          })}
          {list.length === 0 && <div className="px-4 py-6 text-center text-[13.5px] text-fg-3">{t('No one found')}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * A field that hands its value out not on every letter but after a pause and when it loses focus.
 * Needed where "out" means a database write: otherwise the field lags behind the write and swallows characters.
 */
export function CommitInput({ value, onCommit, delay = 350, ...rest }: { value: string; onCommit: (v: string) => void; delay?: number } & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onBlur'>) {
  const [text, setText] = useState(value)
  const dirty = useRef(false)
  const timer = useRef<number>(0)
  const latest = useRef(onCommit)
  latest.current = onCommit
  useEffect(() => { if (!dirty.current) setText(value) }, [value])
  const flush = (v: string) => { window.clearTimeout(timer.current); dirty.current = false; latest.current(v) }
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  return (
    <input {...rest} value={text}
      onChange={e => { const v = e.target.value; setText(v); dirty.current = true; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => flush(v), delay) }}
      onBlur={e => { if (dirty.current) flush(e.target.value) }}
      onKeyDown={e => { rest.onKeyDown?.(e); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}
