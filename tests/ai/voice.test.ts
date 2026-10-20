import { describe, expect, it } from 'vitest'
import { captureText, describePlan, intentOf, isNo, isYes, spokenConfirm, stripWake } from '@/voice/commands'
import { localCapture } from '@/ai/local/parse'
import { person } from '../helpers'

describe('голосовые команды', () => {
  it('обращение «Астра» распознаётся, в том числе с «эй» и без запятых', () => {
    expect(stripWake('Астра, запиши, что с Ниной договорились на пятницу')).toBe('запиши, что с Ниной договорились на пятницу')
    expect(stripWake('эй астра что я обещал Олегу')).toBe('что я обещал Олегу')
    expect(stripWake('Астра')).toBe('')
    expect(stripWake('астрономия — наука')).toBeNull()
    expect(stripWake('мы говорили про Астру')).toBeNull()
  })

  it('«да» и «нет» словами', () => {
    for (const t of ['да', 'Да, записывай', 'подтверждаю', 'ок']) expect(isYes(t)).toBe(true)
    for (const t of ['нет', 'Нет, не надо', 'отмена', 'стоп']) expect(isNo(t)).toBe(true)
    expect(isYes('надо подумать')).toBe(false)
    expect(isNo('да')).toBe(false)
  })

  it('отличает запись от вопроса и чистит текст', () => {
    expect(intentOf('запиши, что с Ниной договорились на пятницу')).toBe('record')
    expect(intentOf('напомни позвонить Олегу в среду')).toBe('record')
    expect(intentOf('что я обещал Олегу?')).toBe('ask')
    expect(captureText('запиши, что с Ниной договорились на пятницу')).toBe('с Ниной договорились на пятницу')
  })

  it('план читается простыми словами: что будет записано, без склонения имён', () => {
    const nina = person({ id: 'nina', firstName: 'Нина', lastName: 'Лебедева' })
    const plan = localCapture(captureText('запиши, что с Ниной договорились созвониться в пятницу'), [nina])
    const lines = describePlan(plan, [nina])
    expect(lines.length).toBeGreaterThan(0)
    const text = lines.join(' | ')
    expect(text).toContain('«Нина Лебедева»')
    expect(text).not.toMatch(/Завести новую карточку/)
    expect(text).toMatch(/Добавить (?:встречу|звонок|переписку|заметку|событие)|Поставить напоминание/)
  })

  it('озвучка без кавычек и с вопросом', () => {
    const s = spokenConfirm(['Добавить встречу — участники: «Нина Лебедева»'])
    expect(s).not.toMatch(/[«»]/)
    expect(s).toMatch(/Сохранить\?/)
  })
})
