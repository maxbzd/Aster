import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { AddressBookIcon, ArrowLeftIcon, CameraIcon, FlaskIcon, SparkleIcon } from '@phosphor-icons/react'
import { SpaceBackground } from '@/components/Page'
import { Aurora } from '@/components/Aurora'
import { Avatar } from '@/components/Avatar'
import { Logo } from '@/components/Nav'
import { PrimaryButton } from '@/components/ui'
import { LanguagePicker } from '@/components/LanguagePicker'
import { cloudEnabled } from '@/cloud/config'
import { DEFAULT_CIRCLES, saveSettings, setCircles } from '@/data/actions'
import { PALETTES } from '@/lib/colors'
import { fileToAvatar, pickFile } from '@/lib/image'
import { haptic, useUI } from '@/app/store'
import { t, msg } from '@/i18n'

const FAKE = [msg('Alina'), msg('Marc'), msg('Nina'), msg('Timur'), msg('Sofia'), msg('Ilya'), msg('Eve'), msg('Oleg'), msg('Kira'), msg('Daniel')].map((n, i) => ({ id: `f${i * 7919}`, firstName: n }))

export function Onboarding() {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [photo, setPhoto] = useState<string>()
  const [chosen, setChosen] = useState<string[]>(DEFAULT_CIRCLES.slice(0, 5).map(c => c.name))
  const [busy, setBusy] = useState(false)
  const open = useUI(s => s.open)

  const next = () => { haptic(10); setStep(s => s + 1) }

  const finish = async (mode: 'demo' | 'import' | 'empty') => {
    setBusy(true)
    let importText: string | null = null
    if (mode === 'import') {
      const f = await pickFile('.vcf,text/vcard,text/x-vcard')
      if (!f) { setBusy(false); return }
      importText = await f.text()
    }
    if (mode === 'demo') await (await import('@/data/demo')).loadDemo()
    else await setCircles(DEFAULT_CIRCLES.filter(c => chosen.includes(c.name)))
    await saveSettings({ name: name.trim(), photo, onboarded: true, createdAt: Date.now(), demo: mode === 'demo' })
    if (importText) setTimeout(() => open({ kind: 'importVcf', text: importText! }), 500)
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      <SpaceBackground />
      <Aurora colors={['rgb(124 92 255 / 0.45)', 'rgb(255 130 90 / 0.3)', 'rgb(60 120 255 / 0.3)']} />

      <div className="relative mx-auto flex min-h-[100dvh] max-w-[480px] flex-col px-6 pb-[calc(28px+var(--safe-bottom))] pt-[calc(20px+var(--safe-top))]">
        <div className="flex h-10 items-center justify-between">
          {step > 0 ? (
            <button type="button" aria-label={t('Back')} onClick={() => setStep(s => s - 1)} className="press glass grid h-10 w-10 place-items-center rounded-full"><ArrowLeftIcon size={18} /></button>
          ) : <Logo />}
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map(i => <motion.span key={i} animate={{ width: i === step ? 22 : 6, opacity: i <= step ? 1 : 0.3 }} className="h-1.5 rounded-full bg-fg" />)}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="flex flex-1 flex-col"
          >
            {step === 0 && (
              <>
                <LanguagePicker className="mt-2 self-center" />
                <div className="flex flex-1 items-center justify-center py-6"><HeroOrbit /></div>
                <h1 className="display text-[52px] leading-[0.98]">{t('People —')}{' '}<br />{t('your universe')}</h1>
                <p className="mt-4 text-[16.5px] leading-relaxed text-fg-2">
                  {t("Aster remembers everyone: how you met, what you talked about, what matters — and tells you when it's time to reach out.")}
                </p>
                <PrimaryButton className="mt-8 w-full" onClick={next}>{t('Get started')}</PrimaryButton>
                {cloudEnabled() ? (
                  <>
                    <button type="button" onClick={() => open({ kind: 'cloud' })} className="press mt-3 w-full text-center text-[14px] text-fg-2">{t('Already have an account?')}{' '}<span className="underline decoration-white/30 underline-offset-4">{t('Sign in')}</span></button>
                    <p className="mt-2 text-center text-[12.5px] text-fg-4">{t("Your data stays on your device, and with an account it's in the cloud too")}</p>
                  </>
                ) : (
                  <p className="mt-3 text-center text-[12.5px] text-fg-4">{t('Your data stays on your device. No account needed.')}</p>
                )}
              </>
            )}

            {step === 1 && (
              <>
                <div className="mt-12">
                  <div className="micro text-fg-3">{t('Step 1 of 3')}</div>
                  <h2 className="mt-3 text-[34px] font-bold leading-tight tracking-[-0.03em]">{t("What's your name?")}</h2>
                  <p className="mt-2 text-[15.5px] text-fg-3">{t('You are the center of your orbit.')}</p>
                </div>
                <div className="mt-10 flex items-center gap-4">
                  <button type="button" onClick={async () => { const f = await pickFile('image/*'); if (f) setPhoto(await fileToAvatar(f)) }} className="press relative shrink-0" aria-label={t('Photo')}>
                    <Avatar person={{ id: 'me', firstName: name || '?', photo }} size={76} />
                    <span className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-ink bg-fg text-ink"><CameraIcon size={13} weight="bold" /></span>
                  </button>
                  <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name.trim() && next()} placeholder={t('First name')}
                    className="field border-b border-line-2 pb-2 text-[30px] font-semibold tracking-[-0.02em] focus:border-white/40" />
                </div>
                <div className="flex-1" />
                <PrimaryButton className="w-full" disabled={!name.trim()} onClick={next}>{t('Continue')}</PrimaryButton>
              </>
            )}

            {step === 2 && (
              <>
                <div className="mt-12">
                  <div className="micro text-fg-3">{t('Step 2 of 3')}</div>
                  <h2 className="mt-3 text-[34px] font-bold leading-tight tracking-[-0.03em]">{t('Your circles')}</h2>
                  <p className="mt-2 text-[15.5px] text-fg-3">{t('Groups of people. Each has its own color — you can change it anytime.')}</p>
                </div>
                <div className="mt-8 grid grid-cols-2 gap-2.5">
                  {DEFAULT_CIRCLES.map(c => {
                    const on = chosen.includes(c.name)
                    const pal = PALETTES[c.palette]
                    return (
                      <motion.button key={c.name} type="button" whileTap={{ scale: 0.96 }}
                        onClick={() => { haptic(5); setChosen(x => (on ? x.filter(n => n !== c.name) : [...x, c.name])) }}
                        className={`glass glow-card flex items-center gap-3 rounded-[22px] p-3.5 text-left transition-opacity ${on ? '!border-white/30' : 'opacity-55'}`}
                        style={{ ['--glow' as string]: on ? pal.glow : 'transparent', ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
                        <span className="grid h-10 w-10 place-items-center rounded-full text-[19px]" style={{ background: `linear-gradient(135deg, ${pal.from}88, ${pal.to}33)` }}>{c.emoji}</span>
                        <span className="text-[15px] font-semibold">{c.name}</span>
                      </motion.button>
                    )
                  })}
                </div>
                <div className="flex-1" />
                <PrimaryButton className="mt-8 w-full" onClick={next}>{t('Continue')}</PrimaryButton>
              </>
            )}

            {step === 3 && (
              <>
                <div className="mt-12">
                  <div className="micro text-fg-3">{t('Step 3 of 3')}</div>
                  <h2 className="mt-3 text-[34px] font-bold leading-tight tracking-[-0.03em]">{t('Where do we start,')}{' '}{name.trim().split(' ')[0]}?</h2>
                </div>
                <div className="mt-8 flex flex-col gap-2.5">
                  <StartOption disabled={busy} icon={FlaskIcon} glow="rgb(255 160 100 / 0.35)" title={t('See an example')} text={t('32 fictional people with history — everything can be deleted with one button')} onClick={() => finish('demo')} />
                  <StartOption disabled={busy} icon={AddressBookIcon} glow="rgb(95 227 176 / 0.3)" title={t('Import your contacts')} text={t('A .vcf file from iPhone, Android or Google Contacts')} onClick={() => finish('import')} />
                  <StartOption disabled={busy} icon={SparkleIcon} glow="rgb(157 140 255 / 0.35)" title={t('Start from scratch')} text={t('Add people one by one, as you meet them')} onClick={() => finish('empty')} />
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="grain" />
    </div>
  )
}

function StartOption({ icon: I, title, text, onClick, glow, disabled }: { icon: typeof FlaskIcon; title: string; text: string; onClick: () => void; glow: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => { haptic(10); onClick() }} className="press glass glow-card flex items-center gap-4 rounded-[26px] p-4 text-left disabled:opacity-50"
      style={{ ['--glow' as string]: glow, ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/[0.08]"><I size={23} weight="duotone" /></span>
      <span>
        <span className="block text-[16.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[13.5px] leading-snug text-fg-3">{text}</span>
      </span>
    </button>
  )
}

/** A mini orbit for the welcome. */
function HeroOrbit() {
  const rings = [{ r: 62, n: 3, dur: 26, s: 30 }, { r: 104, n: 4, dur: 38, s: 26 }, { r: 146, n: 3, dur: 52, s: 22 }]
  let k = 0
  return (
    <div className="relative h-[310px] w-[310px]">
      {rings.map(ring => (
        <div key={ring.r} className="absolute rounded-full border border-white/[0.08]" style={{ left: 155 - ring.r, top: 155 - ring.r, width: ring.r * 2, height: ring.r * 2 }} />
      ))}
      <div className="absolute left-1/2 top-1/2 h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle at 34% 28%, #ffe3c4 0%, #ffa25e 22%, #ff5a5f 48%, #c92a7f 72%, #4b1470 100%)', boxShadow: '0 0 60px rgb(255 110 90 / 0.6), inset -8px -10px 18px rgb(40 0 60 / 0.5)', animation: 'breathe 6s ease-in-out infinite' }} />
      {rings.map((ring, ri) => (
        <div key={ri} className="absolute inset-0" style={{ animation: `${ri % 2 ? 'spin-rev' : 'spin'} ${ring.dur}s linear infinite` }}>
          {Array.from({ length: ring.n }, (_, i) => {
            const fake = FAKE[k++ % FAKE.length]!
            const p = { ...fake, firstName: t(fake.firstName) }
            const a = (i / ring.n) * Math.PI * 2 + ri
            return (
              <div key={i} className="absolute" style={{ left: 155 + Math.cos(a) * ring.r - ring.s / 2, top: 155 + Math.sin(a) * ring.r - ring.s / 2 }}>
                <div style={{ animation: `${ri % 2 ? 'spin' : 'spin-rev'} ${ring.dur}s linear infinite` }}>
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + k * 0.08, type: 'spring', stiffness: 300, damping: 18 }}>
                    <Avatar person={p} size={ring.s} />
                  </motion.div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
