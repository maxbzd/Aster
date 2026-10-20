import { Fragment, type ReactNode } from 'react'
import { t, useLocale, type Vars } from './index'

/**
 * Like `t`, but placeholders may be React elements: `tx('Connected · {model}', { model: <b>Claude</b> })`.
 * Plain values are substituted as text.
 */
export function tx(key: string, vars: Record<string, ReactNode>, ctx?: string): ReactNode {
  const plain: Vars = {}
  for (const [k, v] of Object.entries(vars)) if (typeof v === 'string' || typeof v === 'number') plain[k] = v
  const text = t(key, undefined, ctx)
  const parts = text.split(/(\{\w+\})/g)
  return parts.map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p)
    if (!m || !(m[1]! in vars)) return <Fragment key={i}>{p}</Fragment>
    const v = vars[m[1]!]
    return <Fragment key={i}>{typeof v === 'string' || typeof v === 'number' ? plain[m[1]!] : v}</Fragment>
  })
}

/** Remounts its children when the language changes, so every screen re-renders in the new language. */
export function LocaleRoot({ children }: { children: ReactNode }) {
  const locale = useLocale()
  return <Fragment key={locale}>{children}</Fragment>
}
