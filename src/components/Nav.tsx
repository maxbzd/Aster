import { AnimatePresence, motion } from 'motion/react'
import { useId, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import {
  BellSimpleIcon, CalendarStarIcon, ChatCircleDotsIcon, MagnifyingGlassIcon, MicrophoneIcon, PlanetIcon, PlusIcon, SunHorizonIcon,
  UserCirclePlusIcon, UserIcon, UsersThreeIcon, VaultIcon, type Icon,
} from '@phosphor-icons/react'
import { haptic, useUI } from '@/app/store'
import { t } from '@/i18n'

export const TABS: { to: string; label: string; icon: Icon }[] = [
  { to: '/', get label() { return t('Today') }, icon: SunHorizonIcon },
  { to: '/people', get label() { return t('People') }, icon: UsersThreeIcon },
  { to: '/orbit', get label() { return t('Orbit') }, icon: PlanetIcon },
  { to: '/me', get label() { return t('Me') }, icon: UserIcon },
]

/** In the sidebar the reserve is a separate item. */
const SIDE_TABS: { to: string; label: string; icon: Icon }[] = [
  TABS[0], TABS[1], { to: '/reserve', get label() { return t('Reserve') }, icon: VaultIcon }, TABS[2], TABS[3],
]

export function Logo({ size = 22 }: { size?: number }) {
  const gid = useId()
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <defs>
          <radialGradient id={gid} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" />
            <stop offset="55%" stopColor="#ffd9a8" />
            <stop offset="100%" stopColor="#a796ff" />
          </radialGradient>
        </defs>
        <path d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 16.9 7.1 12.6 1.5 12 7.1 11.4 11.4 7.1 12 1.5Z" fill={`url(#${gid})`} />
      </svg>
      <span className="display text-[26px] leading-none">Aster</span>
    </span>
  )
}

const isActive = (to: string, path: string) => (to === '/' ? path === '/' : to === '/people' ? /^\/(people|reserve)/.test(path) : path.startsWith(to))
const isActiveSide = (to: string, path: string) => (to === '/' ? path === '/' : path.startsWith(to))

function AddMenu({ onClose, desktop }: { onClose: () => void; desktop?: boolean }) {
  const open = useUI(s => s.open)
  const nav = useNavigate()
  const items = [
    { label: t('Dictate a meeting'), sub: t('Astra sorts everything into fields'), icon: MicrophoneIcon, run: () => nav('/capture'), astra: true },
    { label: t('New person'), sub: t('Save an introduction'), icon: UserCirclePlusIcon, run: () => open({ kind: 'addPerson' }) },
    { label: t('To reserve'), sub: t('A spare contact · or a list'), icon: VaultIcon, run: () => open({ kind: 'leadEdit' }) },
    { label: t('Log an interaction'), sub: t('Meeting, call, chat'), icon: ChatCircleDotsIcon, run: () => open({ kind: 'log' }) },
    { label: t('Reminder'), sub: t("Don't forget to reach out"), icon: BellSimpleIcon, run: () => open({ kind: 'reminder' }) },
    { label: t('Event mode'), sub: t('Conference, meetup, dinner'), icon: CalendarStarIcon, run: () => nav('/event') },
  ]
  return (
    <>
      <motion.div className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ background: 'radial-gradient(80% 60% at 80% 100%, rgb(0 0 0 / 0.6), rgb(0 0 0 / 0.35))' }} />
      <motion.div
        className={`glass-strong fixed z-50 w-[272px] overflow-hidden rounded-[26px] p-2 ${desktop ? 'bottom-24 left-5' : 'bottom-[calc(96px+var(--safe-bottom))] right-4'}`}
        style={{ transformOrigin: desktop ? 'bottom left' : 'bottom right' }}
        initial={{ opacity: 0, scale: 0.85, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 8 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      >
        {items.map((it, i) => (
          <motion.button
            key={it.label}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.03 * i } }}
            onClick={() => { haptic(); onClose(); it.run() }}
            className="press flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left hover:bg-white/[0.06]"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full" style={'astra' in it ? { background: 'radial-gradient(circle at 35% 30%, #fff, #ffe2bd 45%, #b8a6ff 100%)', color: '#07070b' } : { background: 'rgb(255 255 255 / 0.08)' }}><it.icon size={20} weight={'astra' in it ? 'fill' : 'regular'} /></span>
            <span>
              <span className="block text-[15px] font-medium">{it.label}</span>
              <span className="block text-[12.5px] text-fg-3">{it.sub}</span>
            </span>
          </motion.button>
        ))}
      </motion.div>
    </>
  )
}

/** A floating glass tab bar plus a separate round "+" button (Opal / Oura). */
export function TabBar() {
  const { pathname } = useLocation()
  const nav = useNavigate()
  const [menu, setMenu] = useState(false)
  const press = useRef<{ t: number; long: boolean }>({ t: 0, long: false })
  const onDown = () => {
    press.current.long = false
    press.current.t = window.setTimeout(() => { press.current.long = true; haptic(25); setMenu(false); nav('/capture') }, 450)
  }
  const onUp = () => clearTimeout(press.current.t)
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2.5 px-4 pb-[calc(14px+var(--safe-bottom))] lg:hidden">
        <div className="glass-strong flex h-[64px] min-w-0 items-center rounded-full p-1.5">
          {TABS.map(tab => {
            const on = isActive(tab.to, pathname)
            return (
              <NavLink key={tab.to} to={tab.to} onClick={() => haptic(5)} className="relative flex h-full w-[clamp(54px,16.5vw,72px)] flex-col items-center justify-center gap-[3px] rounded-full">
                {on && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-white/[0.11]" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                <tab.icon size={22} weight={on ? 'fill' : 'regular'} className={`relative transition-colors ${on ? 'text-fg' : 'text-fg-3'}`} />
                <span className={`relative text-[10.5px] font-medium transition-colors ${on ? 'text-fg' : 'text-fg-3'}`}>{tab.label}</span>
              </NavLink>
            )
          })}
        </div>
        <button
          type="button"
          aria-label={t('Add')}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          onContextMenu={e => e.preventDefault()}
          onClick={() => { if (press.current.long) return; haptic(10); setMenu(m => !m) }}
          className="press relative grid h-[64px] w-[64px] shrink-0 touch-none select-none place-items-center rounded-full text-ink"
          style={{ background: 'radial-gradient(circle at 35% 30%, #fff, #ffe2bd 45%, #b8a6ff 100%)', boxShadow: '0 10px 40px -6px rgb(255 190 130 / 0.55), 0 0 0 1px rgb(255 255 255 / 0.3) inset' }}
        >
          <motion.span animate={{ rotate: menu ? 45 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
            <PlusIcon size={26} weight="bold" />
          </motion.span>
        </button>
      </nav>
      <AnimatePresence>{menu && <AddMenu onClose={() => setMenu(false)} />}</AnimatePresence>
    </>
  )
}

/** The sidebar on wide screens. */
export function Sidebar() {
  const { pathname } = useLocation()
  const [menu, setMenu] = useState(false)
  const setSearch = useUI(s => s.setSearch)
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col border-r border-line bg-ink/90 px-4 py-6 lg:flex">
        <div className="px-2"><Logo /></div>
        <button type="button" onClick={() => setSearch(true)} className="press glass-flat mt-8 flex h-10 items-center gap-2.5 rounded-full px-3.5 text-[14px] text-fg-3">
          <MagnifyingGlassIcon size={16} />
          {t('Search')}
          <kbd className="ml-auto rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-fg-3">Ctrl K</kbd>
        </button>
        <div className="mt-6 flex flex-col gap-1">
          {SIDE_TABS.map(tab => {
            const on = isActiveSide(tab.to, pathname)
            return (
              <NavLink key={tab.to} to={tab.to} className={`relative flex h-11 items-center gap-3 rounded-full px-3.5 text-[15px] font-medium transition-colors ${on ? 'text-fg' : 'text-fg-3 hover:text-fg-2'}`}>
                {on && <motion.span layoutId="side-pill" className="absolute inset-0 rounded-full bg-white/[0.08]" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                <tab.icon size={20} weight={on ? 'fill' : 'regular'} className="relative" />
                <span className="relative">{tab.to === '/me' ? t('Profile') : tab.label}</span>
              </NavLink>
            )
          })}
        </div>
        <button type="button" onClick={() => setMenu(true)} className="press btn-primary mt-auto w-full">
          <PlusIcon size={18} weight="bold" />{' '}{t('Add')}
        </button>
      </aside>
      <AnimatePresence>{menu && <AddMenu desktop onClose={() => setMenu(false)} />}</AnimatePresence>
    </>
  )
}
