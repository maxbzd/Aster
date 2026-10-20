import type { PaletteKey } from '@/data/types'
import { t } from '@/i18n'

export interface Palette { name: string; from: string; to: string; glow: string }

/** Circle palettes: every circle has its own "liquid" gradient (Revolut-style). */
export const PALETTES: Record<PaletteKey, Palette> = {
  aurora: { get name() { return t('Aurora') }, from: '#7c5cff', to: '#45c8ff', glow: 'rgb(124 92 255 / 0.45)' },
  ember:  { get name() { return t('Ember') },    from: '#ff5e3a', to: '#ffb547', glow: 'rgb(255 110 60 / 0.42)' },
  rose:   { get name() { return t('Rose') },   from: '#ff3d7f', to: '#ff9d8a', glow: 'rgb(255 70 130 / 0.40)' },
  jade:   { get name() { return t('Jade') }, from: '#14c08f', to: '#8af5cf', glow: 'rgb(40 210 160 / 0.38)' },
  ocean:  { get name() { return t('Ocean') },  from: '#2563ff', to: '#5fd0ff', glow: 'rgb(50 110 255 / 0.45)' },
  gold:   { get name() { return t('Gold') }, from: '#f0a500', to: '#ffe28a', glow: 'rgb(245 180 20 / 0.38)' },
  orchid: { get name() { return t('Orchid') },from: '#a43dff', to: '#ff7ae0', glow: 'rgb(170 70 255 / 0.42)' },
  ice:    { get name() { return t('Ice') },    from: '#6f8fb5', to: '#d8ebff', glow: 'rgb(150 190 240 / 0.30)' },
}
export const PALETTE_KEYS = Object.keys(PALETTES) as PaletteKey[]

/** Pairs for avatars and profile headers: every person has their own colour. */
const PERSON_GRADIENTS: [string, string, string][] = [
  ['#6d4dff', '#ff6fd8', '#2a1a8a'],
  ['#ff6a3d', '#ffc14d', '#7a1f0a'],
  ['#1fb3ff', '#7b5cff', '#0b2a6b'],
  ['#ff3f8e', '#ff9f6b', '#6b0f3a'],
  ['#12c29a', '#3d7bff', '#063d3a'],
  ['#b44dff', '#4dd2ff', '#3b0f6b'],
  ['#ffb000', '#ff4f6d', '#6b3a00'],
  ['#3d6bff', '#21e6c1', '#0b1f5b'],
  ['#ff5ab4', '#7c5cff', '#5b0f4a'],
  ['#5c7cff', '#c3a6ff', '#1a2366'],
]

export function hashString(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function personGradient(seed: string) {
  const [a, b, deep] = PERSON_GRADIENTS[hashString(seed) % PERSON_GRADIENTS.length]
  return { a, b, deep }
}

export const WARMTH_COLORS = {
  hot: '#ff9a52',
  warm: '#ffd27a',
  cooling: '#a796ff',
  cold: '#74a6ff',
  none: 'rgba(235,235,245,0.35)',
} as const
