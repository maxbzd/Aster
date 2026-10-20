import { blankPerson } from '@/data/actions'
import type { Circle, Person } from '@/data/types'

export const personOf = (id: string, p: Partial<Person> = {}): Person =>
  blankPerson({ id, firstName: 'Иван', createdAt: 1_000, updatedAt: 1_000, ...p })

export const circleOf = (id: string, c: Partial<Circle> = {}): Circle => ({ id, name: 'Друзья', emoji: '🙂', palette: 'aurora', order: 0, ...c })
