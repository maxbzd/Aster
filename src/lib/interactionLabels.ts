import type { InteractionType } from '@/data/types'
import { t } from '@/i18n'

/**
 * Подписи типов общения без иконок: их используют логика и ИИ-контекст,
 * которым не нужно тянуть за собой весь набор иконок интерфейса.
 */
export const INTERACTION_LABEL: Record<InteractionType, string> = {
  get meeting() { return t('Meeting') },
  get call() { return t('Phone call') },
  get message() { return t('Chat') },
  get event() { return t('Event') },
  get favor_given() { return t('My help') },
  get favor_got() { return t('Help for me') },
  get gift() { return t('Gift') },
  get note() { return t('Note') },
}
