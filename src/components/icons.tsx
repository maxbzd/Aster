import {
  AirplaneIcon, BabyIcon, BookOpenIcon, BriefcaseIcon, CakeIcon, ChatCircleIcon, CoffeeIcon, ConfettiIcon,
  EnvelopeSimpleIcon, ForkKnifeIcon, GiftIcon, GlobeIcon, HandHeartIcon, HandshakeIcon, HeartIcon, InstagramLogoIcon,
  LinkedinLogoIcon, LinkIcon, MusicNotesIcon, NotePencilIcon, PawPrintIcon, PhoneIcon, SparkleIcon, StarIcon,
  TelegramLogoIcon, TrophyIcon, UsersThreeIcon, WhatsappLogoIcon, XLogoIcon, type Icon,
} from '@phosphor-icons/react'
import type { ChannelType, FactIcon, InteractionType } from '@/data/types'
import { INTERACTION_LABEL as L } from '@/lib/interactionLabels'
import { t } from '@/i18n'

export const CHANNELS: Record<ChannelType, { label: string; icon: Icon; href: (v: string) => string; placeholder: string }> = {
  telegram: { label: 'Telegram', icon: TelegramLogoIcon, href: v => `https://t.me/${v.replace(/^@|https?:\/\/t\.me\//g, '')}`, placeholder: '@username' },
  phone: { get label() { return t('Phone') }, icon: PhoneIcon, href: v => `tel:${v.replace(/[^\d+]/g, '')}`, placeholder: '+7 900 000-00-00' },
  whatsapp: { label: 'WhatsApp', icon: WhatsappLogoIcon, href: v => `https://wa.me/${v.replace(/[^\d]/g, '')}`, placeholder: '+7 900 000-00-00' },
  email: { get label() { return t('Email') }, icon: EnvelopeSimpleIcon, href: v => `mailto:${v}`, placeholder: 'name@mail.com' },
  instagram: { label: 'Instagram', icon: InstagramLogoIcon, href: v => `https://instagram.com/${v.replace(/^@/, '')}`, placeholder: 'username' },
  linkedin: { label: 'LinkedIn', icon: LinkedinLogoIcon, href: v => (v.startsWith('http') ? v : `https://linkedin.com/in/${v}`), placeholder: 'username' },
  x: { label: 'X', icon: XLogoIcon, href: v => `https://x.com/${v.replace(/^@/, '')}`, placeholder: '@username' },
  website: { get label() { return t('Website') }, icon: GlobeIcon, href: v => (v.startsWith('http') ? v : `https://${v}`), placeholder: 'site.com' },
  other: { get label() { return t('Other') }, icon: LinkIcon, href: v => v, get placeholder() { return t('link or contact') } },
}
export const CHANNEL_ACTION: Record<ChannelType, string> = {
  get telegram() { return t('Message on Telegram') }, get phone() { return t('Call') }, get whatsapp() { return t('Message on WhatsApp') }, get email() { return t('Write an email') },
  get instagram() { return t('Message on Instagram') }, get linkedin() { return t('Message on LinkedIn') }, get x() { return t('Message on X') }, get website() { return t('Open website') }, get other() { return t('Get in touch') },
}
export const CHANNEL_ORDER: ChannelType[] = ['telegram', 'phone', 'whatsapp', 'email', 'instagram', 'linkedin', 'x', 'website', 'other']

export const INTERACTIONS: Record<InteractionType, { label: string; verb: string; icon: Icon; color: string }> = {
  meeting: { label: L.meeting, get verb() { return t('Met in person') }, icon: CoffeeIcon, color: '#ffb36b' },
  call: { label: L.call, get verb() { return t('Had a call') }, icon: PhoneIcon, color: '#7fd6ff' },
  message: { label: L.message, get verb() { return t('Chatted') }, icon: ChatCircleIcon, color: '#a796ff' },
  event: { label: L.event, get verb() { return t('Saw each other at an event') }, icon: ConfettiIcon, color: '#ff7ab8' },
  favor_given: { label: L.favor_given, get verb() { return t('Your help') }, icon: HandHeartIcon, color: '#5fe3b0' },
  favor_got: { label: L.favor_got, get verb() { return t('Help for you') }, icon: HandshakeIcon, color: '#ffd27a' },
  gift: { label: L.gift, get verb() { return t('Gift') }, icon: GiftIcon, color: '#ff8f8f' },
  note: { label: L.note, get verb() { return t('Note') }, icon: NotePencilIcon, color: 'rgba(235,235,245,0.6)' },
}
export const INTERACTION_ORDER: InteractionType[] = ['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got', 'gift', 'note']

export const FACT_ICONS: Record<FactIcon, Icon> = {
  sparkle: SparkleIcon, cake: CakeIcon, globe: GlobeIcon, heart: HeartIcon, briefcase: BriefcaseIcon,
  book: BookOpenIcon, music: MusicNotesIcon, food: ForkKnifeIcon, plane: AirplaneIcon, baby: BabyIcon,
  star: StarIcon, coffee: CoffeeIcon, paw: PawPrintIcon, trophy: TrophyIcon,
}
export const FACT_ICON_KEYS = Object.keys(FACT_ICONS) as FactIcon[]

export { UsersThreeIcon }
