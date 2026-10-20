import type { InteractionType } from '@/data/types'
import { t } from '@/i18n'

/**
 * Labels of interaction types without icons: they are used by the logic and the AI context,
 * which do not need to pull in the whole set of interface icons.
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
