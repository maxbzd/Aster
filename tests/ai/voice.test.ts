import { describe, expect, it } from 'vitest'
import { captureText, describePlan, intentOf, isNo, isYes, spokenConfirm, stripWake } from '@/voice/commands'
import { localCapture } from '@/ai/local/parse'
import { person } from '../helpers'

describe('voice commands', () => {
  it('the address "Астра" is recognised, also with "эй" and without commas', () => {
    expect(stripWake('Астра, запиши, что с Ниной договорились на пятницу')).toBe('запиши, что с Ниной договорились на пятницу')
    expect(stripWake('эй астра что я обещал Олегу')).toBe('что я обещал Олегу')
    expect(stripWake('Астра')).toBe('')
    expect(stripWake('астрономия — наука')).toBeNull()
    expect(stripWake('мы говорили про Астру')).toBeNull()
  })

  it('"да" and "нет" as words', () => {
    for (const t of ['да', 'Да, записывай', 'подтверждаю', 'ок']) expect(isYes(t)).toBe(true)
    for (const t of ['нет', 'Нет, не надо', 'отмена', 'стоп']) expect(isNo(t)).toBe(true)
    expect(isYes('надо подумать')).toBe(false)
    expect(isNo('да')).toBe(false)
  })

  it('tells a log request from a question and cleans the text', () => {
    expect(intentOf('запиши, что с Ниной договорились на пятницу')).toBe('record')
    expect(intentOf('напомни позвонить Олегу в среду')).toBe('record')
    expect(intentOf('что я обещал Олегу?')).toBe('ask')
    expect(captureText('запиши, что с Ниной договорились на пятницу')).toBe('с Ниной договорились на пятницу')
  })

  it('the plan is read in plain words: what will be recorded, without declining names', () => {
    const nina = person({ id: 'nina', firstName: 'Нина', lastName: 'Лебедева' })
    const plan = localCapture(captureText('запиши, что с Ниной договорились созвониться в пятницу'), [nina])
    const lines = describePlan(plan, [nina])
    expect(lines.length).toBeGreaterThan(0)
    const text = lines.join(' | ')
    expect(text).toContain('«Нина Лебедева»')
    expect(text).not.toMatch(/Завести новую карточку/)
    expect(text).toMatch(/Добавить (?:встречу|звонок|переписку|заметку|событие)|Поставить напоминание/)
  })

  it('speech output with no quotes and with a question', () => {
    const s = spokenConfirm(['Добавить встречу — участники: «Нина Лебедева»'])
    expect(s).not.toMatch(/[«»]/)
    expect(s).toMatch(/Сохранить\?/)
  })
})
