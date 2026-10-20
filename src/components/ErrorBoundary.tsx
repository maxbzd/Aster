import { Component, type ReactNode } from 'react'
import { backupToFile } from '@/data/actions'
import { t } from '@/i18n'

/** Страховка от «белого экрана»: показывает спокойное сообщение и даёт сохранить данные. */
export class ErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, { error: Error | null; saved: boolean }> {
  state = { error: null as Error | null, saved: false }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error(error) }

  render() {
    if (!this.state.error) return this.props.children
    const { inline } = this.props
    return (
      <div className={`grid place-items-center px-6 ${inline ? 'min-h-[70dvh]' : 'min-h-dvh bg-ink'}`}>
        <div className="glass w-full max-w-[380px] rounded-[30px] p-7 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-white/[0.07] text-[26px]">🪐</div>
          <div className="text-[20px] font-semibold tracking-[-0.01em]">{t('Something went wrong')}</div>
          <p className="mt-2 text-[14.5px] leading-relaxed text-fg-3">{t("Your data is safe — it's stored on this device. Reload the app. If the error keeps happening, save a copy of your data.")}</p>
          <div className="mt-6 flex flex-col gap-2.5">
            <button type="button" onClick={() => window.location.reload()} className="press btn-primary">{t('Reload')}</button>
            <button type="button" onClick={async () => { try { await backupToFile(); this.setState({ saved: true }) } catch { /* noop */ } }} className="press btn-glass h-[48px]">
              {this.state.saved ? t('Copy saved ✓') : t('Save a copy of my data')}
            </button>
            {inline && <a href="#/" onClick={() => this.setState({ error: null })} className="press mt-1 text-[14px] text-fg-2">{t('Go home')}</a>}
          </div>
          <p className="mt-5 break-words text-[11.5px] text-fg-4">{this.state.error.message.slice(0, 140)}</p>
        </div>
      </div>
    )
  }
}
