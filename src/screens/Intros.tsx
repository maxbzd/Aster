import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, ArrowsClockwiseIcon, XIcon } from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { Aurora } from '@/components/Aurora'
import { Avatar } from '@/components/Avatar'
import { AstraStar, AstraThinking, SourceBadge } from '@/components/astra/Astra'
import { IconButton, SectionTitle, Empty } from '@/components/ui'
import { astraMatches, setIntroStatus, type Result } from '@/ai/astra'
import type { MatchPair } from '@/ai/local/matches'
import { useAstraStatus, useIntros } from '@/ai/hooks'
import { usePeople } from '@/data/hooks'
import { ago, fullName } from '@/lib/format'
import { useUI } from '@/app/store'
import { t } from '@/i18n'

/** The matchmaker: whom to introduce to whom. */
export function Intros() {
  const nav = useNavigate()
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const status = useAstraStatus()
  const intros = useIntros()
  const people = usePeople(true)
  const [res, setRes] = useState<Result<MatchPair[]> | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async (force = false) => {
    setLoading(true)
    try { setRes(await astraMatches(force)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [intros.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map((people ?? []).map(p => [p.id, p]))
  const asked = intros.filter(i => i.status === 'asked')
  const done = intros.filter(i => i.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt)
  const pairs = (res?.data ?? []).filter(m => !intros.some(i => i.aId === m.a.id && i.bId === m.b.id && i.status !== 'suggested'))

  return (
    <Page>
      <Aurora colors={['rgb(127 214 255 / 0.35)', 'rgb(124 92 255 / 0.4)', 'rgb(255 200 150 / 0.25)']} className="!bottom-auto h-[480px]"
        style={{ left: '-30vw', right: '-30vw', maskImage: 'linear-gradient(to bottom, #000 50%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 50%, transparent)' }} />
      <div className="relative flex items-center justify-between pt-[calc(12px+var(--safe-top))]">
        <IconButton icon={ArrowLeftIcon} label={t('Back')} onClick={() => nav(-1)} size={42} />
        {status.connected && <IconButton icon={ArrowsClockwiseIcon} label={t('Find again')} onClick={() => load(true)} size={42} />}
      </div>

      <div className="relative mt-5">
        <div className="micro text-fg-3">{t('Matchmaker')}</div>
        <h1 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.035em]">{t('Constellations')}{' '}<span className="display font-normal text-fg-2">{t('of your network')}</span></h1>
        <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-fg-2">
          {t('The strongest networkers are those who introduce people to each other. Astra looks at who is currently')}{' '}<b className="text-fg">{t('looking for')}</b>{' '}{t('and what each is')}{' '}<b className="text-fg">{t('strong at')}</b>{t(', and finds pairs who should meet. You write to each of them — they get value, and you become someone who is valued and remembered.')}
        </p>
      </div>

      <SectionTitle count={loading ? undefined : pairs.length}>{t('Could be introduced')}</SectionTitle>
      {loading ? <AstraThinking kind="matches" /> : (
        <>
          <div className="mb-3"><SourceBadge source={res!.source} error={res!.error} /></div>
          {pairs.length === 0 ? (
            <Empty icon={XIcon} title={t('No pairs yet')} text={t("Add a “Looking for now” field to people's cards — or dictate a meeting, Astra will fill it in itself.")} />
          ) : (
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {pairs.map((m, i) => (
                  <motion.div key={`${m.a.id}-${m.b.id}`} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }} exit={{ opacity: 0, x: -40 }}
                    className="glass glow-card rounded-[28px] p-4" style={{ ['--glow' as string]: 'rgb(127 214 255 / 0.22)', ['--gx' as string]: '50%', ['--gy' as string]: '0%' }}>
                    <div className="flex items-center">
                      <Avatar person={m.a} size={48} />
                      <div className="relative mx-2 h-px flex-1">
                        <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgb(255 217 168 / 0.15), rgb(255 217 168 / 0.85), rgb(167 150 255 / 0.85), rgb(167 150 255 / 0.15))', boxShadow: '0 0 10px rgb(255 200 150 / 0.5)' }} />
                        <AstraStar size={16} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
                      </div>
                      <Avatar person={m.b} size={48} />
                    </div>
                    <div className="mt-2 flex justify-between text-[13.5px] font-semibold"><span>{fullName(m.a)}</span><span>{fullName(m.b)}</span></div>
                    <p className="mt-3 text-[15px] leading-relaxed">{m.reason}</p>
                    <p className="mt-1 text-[13px] text-fg-3">{m.value}</p>
                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={() => open({ kind: 'intro', aId: m.a.id, bId: m.b.id, reason: m.reason, value: m.value })} className="press btn-primary h-11 flex-1 text-[15px]">{t('Introduce')}</button>
                      <button type="button" aria-label={t('Not a fit')} onClick={async () => { await setIntroStatus(m, 'dismissed'); toast(t('Pair hidden'), 'info') }} className="press btn-glass h-11 w-11 !px-0"><XIcon size={16} /></button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {asked.length > 0 && (
        <>
          <SectionTitle count={asked.length}>{t('Awaiting a reply')}</SectionTitle>
          <div className="glass rows overflow-hidden rounded-[24px]">
            {asked.map(i => {
              const a = byId.get(i.aId), b = byId.get(i.bId)
              if (!a || !b) return null
              return (
                <button key={i.id} type="button" onClick={() => open({ kind: 'intro', aId: a.id, bId: b.id, reason: i.reason, value: '' })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="flex -space-x-3"><Avatar person={a} size={34} /><Avatar person={b} size={34} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{a.firstName} × {b.firstName}</span><span className="block text-[12.5px] text-fg-3">{t('awaiting reply ·')}{' '}{ago(i.updatedAt)}</span></span>
                </button>
              )
            })}
          </div>
        </>
      )}
      {done.length > 0 && (
        <>
          <SectionTitle count={done.length}>{t('Already introduced')}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {done.map(i => {
              const a = byId.get(i.aId), b = byId.get(i.bId)
              if (!a || !b) return null
              return <span key={i.id} className="glass flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[13px]"><span className="flex -space-x-2"><Avatar person={a} size={24} /><Avatar person={b} size={24} /></span>{a.firstName} × {b.firstName}</span>
            })}
          </div>
        </>
      )}
    </Page>
  )
}
