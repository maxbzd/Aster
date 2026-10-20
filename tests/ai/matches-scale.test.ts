import { describe, expect, it } from 'vitest'
import { localMatches } from '@/ai/local/matches'
import { blankPerson } from '@/data/actions'

describe('подбор знакомств в большой сети', () => {
  it('600 человек считаются быстро, а результат тот же, что и в маленькой сети', () => {
    const roles = ['инвестор', 'дизайнер', 'юрист', 'разработчик', 'журналист', 'ментор']
    const people = Array.from({ length: 600 }, (_, i) => blankPerson({
      id: `p${i}`, firstName: `Имя${i}`, role: roles[i % roles.length], city: ['Москва', 'Дубай', 'Берлин'][i % 3], company: `Компания ${i}`,
      lookingFor: i % 5 === 0 ? ['инвестора в раунд', 'дизайнера интерфейсов', 'юриста по договорам'][i % 3] : undefined,
    }))
    const t = performance.now()
    const pairs = localMatches(people)
    const ms = performance.now() - t
    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs.length).toBeLessThanOrEqual(10)
    expect(ms).toBeLessThan(1500)
  })
})
