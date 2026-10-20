import { describe, expect, it } from 'vitest'
import { FileReadError, templateCsv, classifyText, decodeText, parseDelimited, readContactsFile, readXlsx } from '@/lib/tabular'
import { makeXlsx } from '../zip'

const bytes = (s: string) => new TextEncoder().encode(s)
const file = (content: BlobPart, name: string) => new File([content], name)

describe('parseDelimited', () => {
  it('определяет разделитель сам', () => {
    expect(parseDelimited('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseDelimited('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseDelimited('a\tb\tc\n1\t2\t3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseDelimited('a|b|c\n1|2|3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('кавычки: разделитель и перенос строки внутри ячейки, удвоенные кавычки', () => {
    const rows = parseDelimited('Имя,Заметка\r\n"Иван","Любит ""кофе"", чай"\r\n"Анна","строка 1\nстрока 2"')
    expect(rows).toEqual([['Имя', 'Заметка'], ['Иван', 'Любит "кофе", чай'], ['Анна', 'строка 1\nстрока 2']])
  })
  it('запятые в тексте не ломают точку с запятой', () => {
    expect(parseDelimited('a;b\nИван, Петров;инвестор, Дубай')).toEqual([['a', 'b'], ['Иван, Петров', 'инвестор, Дубай']])
  })
  it('пустые строки пропускает, CRLF и CR понимает', () => {
    expect(parseDelimited('a,b\r\n\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseDelimited('a,b\r1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('обрезает пробелы вокруг значений', () => {
    expect(parseDelimited('a, b ,c\n 1 ,2, 3')[1]).toEqual(['1', '2', '3'])
  })
  it('пустой ввод', () => {
    expect(parseDelimited('')).toEqual([])
  })
})

describe('decodeText — кодировки', () => {
  it('UTF-8 и BOM', () => {
    expect(decodeText(bytes('Привет').buffer as ArrayBuffer)).toBe('Привет')
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('Привет')]).buffer as ArrayBuffer)).toBe('Привет')
  })
  it('windows-1251 (русский Excel) определяется автоматически', () => {
    // «Привет» в cp1251
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])
    expect(decodeText(cp1251.buffer as ArrayBuffer)).toBe('Привет')
  })
  it('UTF-16 LE с BOM («Юникод-текст» из Excel)', () => {
    const u16 = new Uint8Array([0xff, 0xfe, ...[...'Hi Я'].flatMap(ch => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8])])
    expect(decodeText(u16.buffer as ArrayBuffer)).toBe('Hi Я')
  })
})

describe('classifyText — что вставил пользователь', () => {
  it('vCard', () => expect(classifyText('BEGIN:VCARD\nFN:A B\nEND:VCARD').kind).toBe('vcf'))
  it('ячейки из Excel / Google Таблиц (табуляция) — таблица', () => {
    const r = classifyText('Имя\tТелефон\nИван\t+7 900 000 00 00\nОлег\t+7 900 111 11 11')
    expect(r.kind).toBe('table')
    if (r.kind === 'table') expect(r.rows).toHaveLength(3)
  })
  it('обычные строки — текст', () => {
    expect(classifyText('Иван Петров — фонд\nАнна Ким, юрист').kind).toBe('text')
  })
  it('одна строка с табуляцией — не таблица', () => {
    expect(classifyText('Иван\tПетров').kind).toBe('text')
  })
})

describe('readXlsx', () => {
  const rows = [
    ['ФИО', 'Телефон', 'Описание'],
    ['Иванов Иван', 79001234567, 'Инвестор & партнёр <fintech>'],
    ['Лебедева Анна', null, 'Юрист'],
  ]
  it('читает общие строки, числа и экранирование XML', async () => {
    const buf = (await makeXlsx(rows)).buffer as ArrayBuffer
    const out = await readXlsx(buf)
    expect(out[0]).toEqual(['ФИО', 'Телефон', 'Описание'])
    expect(out[1]).toEqual(['Иванов Иван', '79001234567', 'Инвестор & партнёр <fintech>'])
    expect(out[2]).toEqual(['Лебедева Анна', '', 'Юрист'])
  })
  it('понимает inline-строки (Google Таблицы, openpyxl)', async () => {
    const out = await readXlsx((await makeXlsx(rows, { inline: true })).buffer as ArrayBuffer)
    expect(out[1][0]).toBe('Иванов Иван')
  })
  it('понимает файл без сжатия (stored)', async () => {
    const out = await readXlsx((await makeXlsx(rows, { store: true })).buffer as ArrayBuffer)
    expect(out[2][2]).toBe('Юрист')
  })
  it('пропускает пустые ячейки по координатам, а не сдвигает колонки', async () => {
    const out = await readXlsx((await makeXlsx([['a', null, 'c']])).buffer as ArrayBuffer)
    expect(out[0]).toEqual(['a', '', 'c'])
  })
  it('большие числа в научной нотации превращаются в обычные цифры', async () => {
    const out = await readXlsx((await makeXlsx([[7.9001234567e10]])).buffer as ArrayBuffer)
    expect(out[0][0]).toBe('79001234567')
  })
  it('битый файл — понятная ошибка, не падение', async () => {
    await expect(readXlsx(new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer)).rejects.toBeInstanceOf(FileReadError)
  })
})

describe('readContactsFile', () => {
  it('csv', async () => {
    const r = await readContactsFile(file('Имя;Телефон\nИван;+7 900 1', 'c.csv'))
    expect(r.kind).toBe('table')
    if (r.kind === 'table') expect(r.rows).toEqual([['Имя', 'Телефон'], ['Иван', '+7 900 1']])
  })
  it('xlsx по расширению и по сигнатуре zip', async () => {
    const data = await makeXlsx([['Имя'], ['Анна']])
    expect((await readContactsFile(file(data as BlobPart, 'list.xlsx'))).kind).toBe('table')
    expect((await readContactsFile(file(data as BlobPart, 'без-расширения'))).kind).toBe('table')
  })
  it('json: массив объектов превращается в таблицу с заголовками', async () => {
    const r = await readContactsFile(file(JSON.stringify([{ name: 'Иван', phone: '1', tags: ['а', 'б'] }, { name: 'Анна', company: { n: 'Acme' } }]), 'c.json'))
    expect(r.kind).toBe('table')
    if (r.kind === 'table') {
      expect(r.rows[0]).toEqual(['name', 'phone', 'tags', 'company'])
      expect(r.rows[1]).toEqual(['Иван', '1', 'а, б', ''])
      expect(r.rows[2][3]).toBe('Acme')
    }
  })
  it('json: список строк и вложенный массив', async () => {
    const r1 = await readContactsFile(file('["Иван","Анна"]', 'a.json'))
    expect(r1.kind === 'table' && r1.rows).toEqual([['Иван'], ['Анна']])
    const r2 = await readContactsFile(file('{"contacts":[{"name":"Иван"}]}', 'b.json'))
    expect(r2.kind === 'table' && r2.rows[1]).toEqual(['Иван'])
  })
  it('vcf по расширению и по содержимому', async () => {
    expect((await readContactsFile(file('BEGIN:VCARD\nFN:A B\nEND:VCARD', 'x.vcf'))).kind).toBe('vcf')
    expect((await readContactsFile(file('BEGIN:VCARD\nFN:A B\nEND:VCARD', 'x.txt'))).kind).toBe('vcf')
  })
  it('txt', async () => {
    expect((await readContactsFile(file('Иван Петров\nАнна Ким', 'x.txt'))).kind).toBe('text')
  })
  it.each([
    ['старый.xls', 'xls'], ['doc.docx', 'Word'], ['scan.pdf', 'PDF'], ['data.numbers', 'Numbers'],
  ])('неподдерживаемый формат %s — понятная подсказка', async (name, hint) => {
    await expect(readContactsFile(file('x', name))).rejects.toThrow(new RegExp(hint, 'i'))
  })
  it('пустой/битый json', async () => {
    await expect(readContactsFile(file('{', 'c.json'))).rejects.toBeInstanceOf(FileReadError)
    await expect(readContactsFile(file('[]', 'c.json'))).rejects.toBeInstanceOf(FileReadError)
  })
})

describe('шаблон таблицы', () => {
  it('сам читается как таблица с нужными колонками', () => {
    const rows = parseDelimited(templateCsv().replace(/^﻿/, ''))
    expect(rows[0]).toEqual(['Имя', 'Фамилия', 'Компания', 'Должность', 'Телефон', 'Email', 'Telegram', 'Город', 'Теги', 'Чем ценен', 'Откуда'])
    expect(rows).toHaveLength(3)
    expect(rows[1][8]).toBe('Инвестор, Fintech')
  })
})
