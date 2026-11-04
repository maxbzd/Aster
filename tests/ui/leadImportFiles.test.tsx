import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '@/app/store'
import { db } from '@/data/db'
import { t } from '@/i18n'
import { renderApp, seed } from './harness'

const dialog = async () => within(await screen.findByRole('dialog', undefined, { timeout: 8000 }))
const file = (name: string, body: string, type = 'text/plain') => new File([body], name, { type })

beforeEach(() => seed({ demo: false }))

const openWith = async (props: { file?: File; text?: string } = {}) => {
  const ctx = renderApp('/reserve')
  await screen.findByRole('button', { name: t('Upload a list') })
  useUI.getState().open({ kind: 'leadImport', ...props })
  return { ...ctx, d: await dialog() }
}

describe('importing a list from a file', () => {
  it('a vCard file goes straight to the review, and "Add" puts everyone in the reserve with the file name as the source', async () => {
    const vcf = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Лев Карпов', 'ORG:Студия', 'TEL:+79001112233', 'END:VCARD', 'BEGIN:VCARD', 'VERSION:3.0', 'FN:Ида Рау', 'EMAIL:ida@example.com', 'END:VCARD'].join('\n')
    const { user, d } = await openWith({ file: file('друзья.vcf', vcf, 'text/vcard') })
    expect(await d.findByText(t('Review and add'))).toBeInTheDocument()
    await user.click(await d.findByRole('button', { name: new RegExp(t('Use “') + 'друзья') }))
    await user.click(d.getByRole('button', { name: new RegExp(t('Add {count} to reserve', { count: 2 })) }))
    await waitFor(async () => expect(await db.leads.count()).toBe(2))
    expect((await db.leads.toArray()).every(l => l.source === 'друзья')).toBe(true)
    expect(window.location.hash).toBe('#/reserve')
  })

  it('a CSV with columns shows the mapping step; the header switch and a column role can be changed', async () => {
    const csv = 'Имя,Фамилия,Компания\nАнна,Кимова,Лампа\nБорис,Лимов,Мост'
    const { user, d } = await openWith({ file: file('люди.csv', csv, 'text/csv') })
    expect(await d.findByText(t("What's in the columns?"))).toBeInTheDocument()
    expect(d.getByText(t('This is how the first ones will look'))).toBeInTheDocument()
    // without a header row the first row is a person too
    await user.click(d.getByText(t('First row is the headers')))
    expect(await d.findByRole('button', { name: new RegExp('3') })).toBeInTheDocument()
    await user.click(d.getByText(t('First row is the headers')))
    // a column can be given another meaning
    await user.click(d.getByRole('button', { name: t('Column {colName}: what is it', { colName: 'C' }) }))
    await user.click(screen.getAllByRole('option').at(-1)!) // the last role is "skip"
    // a way back from the review to the mapping, and from the mapping to the choice
    await user.click(d.getByRole('button', { name: /Далее/ }))
    expect(await d.findByText(t('Review and add'))).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: t('Back') }))
    expect(await d.findByText(t("What's in the columns?"))).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: t('Back') }))
    expect(await d.findByText(t('Upload a list'))).toBeInTheDocument()
  })

  it('a plain file with one name per line is read as a list of people', async () => {
    const { d } = await openWith({ file: file('имена.txt', 'Артём Волков, инвестор\nЯна Соколова, юрист') })
    expect(await d.findByText(t('Review and add'))).toBeInTheDocument()
    expect(await d.findByText(/Артём Волков/)).toBeInTheDocument()
  })

  it('a one-column CSV is treated as text, not as a table', async () => {
    const { d } = await openWith({ file: file('один.csv', 'Имя\nАртём Волков\nЯна Соколова', 'text/csv') })
    expect(await d.findByText(t('Review and add'))).toBeInTheDocument()
  })

  it.each([
    ['старый.xls', 'x', 'This is the old .xls format — save the spreadsheet as .xlsx or .csv and upload again'],
    ['сводка.pdf', 'x', "Contacts can't be extracted from PDF, Word and images — copy the text and paste it into the field below"],
    ['пустой.vcf', 'BEGIN:VCARD\nEND:VCARD', 'No contacts found in the file'],
  ])('%s: a message that says what to do instead', async (name, body, message) => {
    const { d } = await openWith({ file: file(name, body) })
    const text = (await d.findByText(new RegExp(t(message).slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).textContent
    expect(text).toBeTruthy()
    expect(d.getByText(t('Upload a list'))).toBeInTheDocument() // still on the first step
  })

  it('a file dropped on the box is read', async () => {
    const { d } = await openWith()
    const zone = d.getByText(t('Choose a file')).closest('div')!
    fireEvent.dragOver(zone)
    expect(await d.findByText(t('Drop the file here'))).toBeInTheDocument()
    fireEvent.dragLeave(zone)
    fireEvent.drop(zone, { dataTransfer: { files: [file('имена.txt', 'Артём Волков, инвестор')] } })
    expect(await d.findByText(t('Review and add'))).toBeInTheDocument()
  })

  it('pasted text that arrives with the sheet is parsed at once; nothing in it is an error', async () => {
    const a = await openWith({ text: 'Артём Волков, инвестор, Дубай' })
    expect(await a.d.findByText(t('Review and add'))).toBeInTheDocument()
  })

  it('the clipboard button pastes; a refused clipboard says so', async () => {
    const { user, d } = await openWith()
    const read = vi.fn().mockResolvedValueOnce('Яна Соколова, юрист').mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { readText: read }, configurable: true })
    const btn = await d.findByRole('button', { name: new RegExp(t('From clipboard')) })
    await user.click(btn)
    await waitFor(() => expect((d.getByPlaceholderText(/По человеку на строку/) as HTMLTextAreaElement).value).toBe('Яна Соколова, юрист'))
    await user.click(btn)
    await waitFor(() => expect(useUI.getState().toasts.some(x => x.text === t('No clipboard access'))).toBe(true))
  })

  it('the template can be downloaded', async () => {
    const { user, d } = await openWith()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    await user.click(await d.findByRole('button', { name: new RegExp(t('Download a table template')) }))
    await waitFor(() => expect(useUI.getState().toasts.some(x => x.text === t('Template downloaded'))).toBe(true))
    expect(click).toHaveBeenCalled()
  })

  it('review: tags for everyone, switching off the detection of tags', async () => {
    const { user, d } = await openWith({ text: 'Артём Волков, инвестор, Дубай' })
    await d.findByText(t('Review and add'))
    await user.click(d.getByText(t('Detect tags and cities')))
    const tagBox = d.getByPlaceholderText(t('Add a tag for everyone… Enter'))
    await user.type(tagBox, 'ужин{Enter}')
    await user.click(d.getByRole('button', { name: new RegExp(t('Add {count} to reserve', { count: 1 })) }))
    await waitFor(async () => expect(await db.leads.count()).toBe(1))
    const lead = (await db.leads.toArray())[0]!
    expect(lead.tags.map(x => x.toLowerCase())).toContain('ужин')
  })
})
