import { describe, expect, it } from 'vitest'
import { FileReadError, templateCsv, classifyText, decodeText, parseDelimited, readContactsFile, readXlsx } from '@/lib/tabular'
import { makeXlsx } from '../zip'

const bytes = (s: string) => new TextEncoder().encode(s)
const file = (content: BlobPart, name: string) => new File([content], name)

describe('parseDelimited', () => {
  it('detects the delimiter on its own', () => {
    expect(parseDelimited('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseDelimited('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseDelimited('a\tb\tc\n1\t2\t3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseDelimited('a|b|c\n1|2|3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('quotes: a delimiter and a line break inside a cell, doubled quotes', () => {
    const rows = parseDelimited('Имя,Заметка\r\n"Иван","Любит ""кофе"", чай"\r\n"Анна","строка 1\nстрока 2"')
    expect(rows).toEqual([['Имя', 'Заметка'], ['Иван', 'Любит "кофе", чай'], ['Анна', 'строка 1\nстрока 2']])
  })
  it('commas in the text do not break a semicolon', () => {
    expect(parseDelimited('a;b\nИван, Петров;инвестор, Дубай')).toEqual([['a', 'b'], ['Иван, Петров', 'инвестор, Дубай']])
  })
  it('skips empty lines, understands CRLF and CR', () => {
    expect(parseDelimited('a,b\r\n\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseDelimited('a,b\r1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('trims spaces around values', () => {
    expect(parseDelimited('a, b ,c\n 1 ,2, 3')[1]).toEqual(['1', '2', '3'])
  })
  it('an empty input', () => {
    expect(parseDelimited('')).toEqual([])
  })
})

describe('decodeText: encodings', () => {
  it('UTF-8 and BOM', () => {
    expect(decodeText(bytes('Привет').buffer as ArrayBuffer)).toBe('Привет')
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('Привет')]).buffer as ArrayBuffer)).toBe('Привет')
  })
  it('windows-1251 (Russian Excel) is detected automatically', () => {
    // "Привет" in cp1251
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])
    expect(decodeText(cp1251.buffer as ArrayBuffer)).toBe('Привет')
  })
  it('UTF-16 LE with a BOM (Excel\'s "Unicode text")', () => {
    const u16 = new Uint8Array([0xff, 0xfe, ...[...'Hi Я'].flatMap(ch => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8])])
    expect(decodeText(u16.buffer as ArrayBuffer)).toBe('Hi Я')
  })
})

describe('classifyText: what the user pasted', () => {
  it('vCard', () => expect(classifyText('BEGIN:VCARD\nFN:A B\nEND:VCARD').kind).toBe('vcf'))
  it('cells from Excel / Google Sheets (tabs): a table', () => {
    const r = classifyText('Имя\tТелефон\nИван\t+7 900 000 00 00\nОлег\t+7 900 111 11 11')
    expect(r.kind).toBe('table')
    if (r.kind === 'table') expect(r.rows).toHaveLength(3)
  })
  it('ordinary lines: text', () => {
    expect(classifyText('Иван Петров — фонд\nАнна Ким, юрист').kind).toBe('text')
  })
  it('one line with a tab: not a table', () => {
    expect(classifyText('Иван\tПетров').kind).toBe('text')
  })
})

describe('readXlsx', () => {
  const rows = [
    ['ФИО', 'Телефон', 'Описание'],
    ['Иванов Иван', 79001234567, 'Инвестор & партнёр <fintech>'],
    ['Лебедева Анна', null, 'Юрист'],
  ]
  it('reads shared strings, numbers and XML escaping', async () => {
    const buf = (await makeXlsx(rows)).buffer as ArrayBuffer
    const out = await readXlsx(buf)
    expect(out[0]).toEqual(['ФИО', 'Телефон', 'Описание'])
    expect(out[1]).toEqual(['Иванов Иван', '79001234567', 'Инвестор & партнёр <fintech>'])
    expect(out[2]).toEqual(['Лебедева Анна', '', 'Юрист'])
  })
  it('understands inline strings (Google Sheets, openpyxl)', async () => {
    const out = await readXlsx((await makeXlsx(rows, { inline: true })).buffer as ArrayBuffer)
    expect(out[1][0]).toBe('Иванов Иван')
  })
  it('understands an uncompressed file (stored)', async () => {
    const out = await readXlsx((await makeXlsx(rows, { store: true })).buffer as ArrayBuffer)
    expect(out[2][2]).toBe('Юрист')
  })
  it('skips empty cells by coordinates instead of shifting columns', async () => {
    const out = await readXlsx((await makeXlsx([['a', null, 'c']])).buffer as ArrayBuffer)
    expect(out[0]).toEqual(['a', '', 'c'])
  })
  it('large numbers in scientific notation become ordinary digits', async () => {
    const out = await readXlsx((await makeXlsx([[7.9001234567e10]])).buffer as ArrayBuffer)
    expect(out[0][0]).toBe('79001234567')
  })
  it('a broken file: a clear error, not a crash', async () => {
    await expect(readXlsx(new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer)).rejects.toBeInstanceOf(FileReadError)
  })
})

describe('readContactsFile', () => {
  it('csv', async () => {
    const r = await readContactsFile(file('Имя;Телефон\nИван;+7 900 1', 'c.csv'))
    expect(r.kind).toBe('table')
    if (r.kind === 'table') expect(r.rows).toEqual([['Имя', 'Телефон'], ['Иван', '+7 900 1']])
  })
  it('xlsx by extension and by the zip signature', async () => {
    const data = await makeXlsx([['Имя'], ['Анна']])
    expect((await readContactsFile(file(data as BlobPart, 'list.xlsx'))).kind).toBe('table')
    expect((await readContactsFile(file(data as BlobPart, 'без-расширения'))).kind).toBe('table')
  })
  it('json: an array of objects becomes a table with headers', async () => {
    const r = await readContactsFile(file(JSON.stringify([{ name: 'Иван', phone: '1', tags: ['а', 'б'] }, { name: 'Анна', company: { n: 'Acme' } }]), 'c.json'))
    expect(r.kind).toBe('table')
    if (r.kind === 'table') {
      expect(r.rows[0]).toEqual(['name', 'phone', 'tags', 'company'])
      expect(r.rows[1]).toEqual(['Иван', '1', 'а, б', ''])
      expect(r.rows[2][3]).toBe('Acme')
    }
  })
  it('json: a list of strings and a nested array', async () => {
    const r1 = await readContactsFile(file('["Иван","Анна"]', 'a.json'))
    expect(r1.kind === 'table' && r1.rows).toEqual([['Иван'], ['Анна']])
    const r2 = await readContactsFile(file('{"contacts":[{"name":"Иван"}]}', 'b.json'))
    expect(r2.kind === 'table' && r2.rows[1]).toEqual(['Иван'])
  })
  it('vcf by extension and by content', async () => {
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
  it('empty/broken json', async () => {
    await expect(readContactsFile(file('{', 'c.json'))).rejects.toBeInstanceOf(FileReadError)
    await expect(readContactsFile(file('[]', 'c.json'))).rejects.toBeInstanceOf(FileReadError)
  })
})

describe('the table template', () => {
  it('reads back as a table with the needed columns', () => {
    const rows = parseDelimited(templateCsv().replace(/^﻿/, ''))
    expect(rows[0]).toEqual(['Имя', 'Фамилия', 'Компания', 'Должность', 'Телефон', 'Email', 'Telegram', 'Город', 'Теги', 'Чем ценен', 'Откуда'])
    expect(rows).toHaveLength(3)
    expect(rows[1][8]).toBe('Инвестор, Fintech')
  })
})
