import { motion } from 'motion/react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon } from '@phosphor-icons/react'
import { useAllInteractions, useAllPeople, useNow } from '@/data/hooks'
import { yearReview, yearsWithData } from '@/data/year'
import { t, tn } from '@/i18n'

/** Приглашение в «Итоги года»: показывает несколько цифр, чтобы захотелось открыть. */
export function YearTeaser() {
  const people = useAllPeople()
  const ints = useAllInteractions()
  const now = useNow(3_600_000)
  const year = useMemo(() => {
    const cur = new Date(now).getFullYear()
    return ints.some(i => new Date(i.date).getFullYear() === cur) ? cur : yearsWithData(ints, now)[0] ?? cur
  }, [ints, now])
  const r = useMemo(() => yearReview(year, people ?? [], ints, now), [year, people, ints, now])
  if (!r.hasData) return null
  return (
    <Link to={`/year?y=${year}`} className="press relative mt-6 block overflow-hidden rounded-[30px] p-5" style={{ background: 'linear-gradient(135deg, #3b2a9a 0%, #8a3fd0 45%, #ff7a3d 100%)' }}>
      <motion.div aria-hidden className="absolute -right-10 -top-10 h-44 w-44 rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(255 255 255 / 0.4), transparent)' }} animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }} />
      <div className="relative">
        <div className="micro text-white/75">{t('year in review')}</div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-[44px] font-extrabold leading-none tracking-[-0.05em]">{year}</div>
            <div className="mt-2 text-[14px] text-white/85">{r.total} {tn(r.total, 'contact', 'contacts')}{r.newPeople.length ? ` · +${r.newPeople.length} ${tn(r.newPeople.length, 'person', 'people')}` : ''}</div>
          </div>
          <span className="flex h-11 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-semibold text-ink">{t('View')}{' '}<ArrowRightIcon size={15} weight="bold" /></span>
        </div>
      </div>
    </Link>
  )
}
