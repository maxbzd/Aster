import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBridge } from '@/bridge/store'
import { BridgeError, type Connection } from '@/bridge/protocol'
import { useCloud } from '@/cloud/store'
import { db } from '@/data/db'
import { DAY } from '@/lib/format'
import { NOW, person } from '../helpers'
import { renderApp, seed, watchConsole } from './harness'

const svc = vi.hoisted(() => ({
  makeCode: vi.fn(async () => ({ text: 'bridge1.ABCDEF', expiresAt: '2026-10-09T12:10:00Z' })),
  enterCode: vi.fn(async (_t: string) => undefined),
  disconnect: vi.fn(async (_c: unknown) => undefined),
  changeScopes: vi.fn(async (_c: unknown, _s: string[]) => undefined),
  linkPeople: vi.fn(async (_a: string, _b: string) => undefined),
  unlinkPeople: vi.fn(async (_a: string, _b: string) => undefined),
  runBridge: vi.fn(async () => undefined),
  startBridge: vi.fn(),
  stopBridge: vi.fn(),
}))
vi.mock('@/bridge/service', () => svc)

const conn = (extra: Partial<Connection> = {}): Connection => ({ id: 'c1', peer_label: 'Орбита', scopes: ['people', 'commitments', 'captures', 'facts'], peer_url: 'https://o.test', peer_key: 'k', outbound_token: 'bt_x', created_at: '', last_read_at: null, ...extra })
const dialog = () => screen.findByRole('dialog')

beforeEach(async () => {
  vi.clearAllMocks()
  useBridge.setState({ active: false, connections: [], phase: 'idle', revoked: false, error: undefined, lastCycleAt: undefined })
  useCloud.setState({ phase: 'off', userId: undefined, email: undefined })
  await seed({ demo: false })
})

describe('Орбита: подключение', () => {
  it('без входа в облако предлагает сначала войти', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    const d = within(await dialog())
    expect(d.getByText(/сначала войди в облако/i)).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Войти в облако' }))
    expect(await within(await dialog()).findByLabelText('Почта')).toBeInTheDocument()
  })

  it('«Показать код»: код виден целиком и копируется', async () => {
    useCloud.setState({ userId: 'u1', email: 'max@mail.com', phase: 'idle' })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    const d = within(await dialog())
    await user.click(d.getByText('Показать код'))
    expect(await d.findByLabelText('Код подключения')).toHaveValue('bridge1.ABCDEF')
    expect(d.getByText(/действует 10 минут/)).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: /Скопировать/ }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('bridge1.ABCDEF'))
    expect(await d.findByRole('button', { name: /Скопировано/ })).toBeInTheDocument()
  })

  it('«Ввести код»: неверный код — понятная ошибка; верный — подключено', async () => {
    useCloud.setState({ userId: 'u1', email: 'max@mail.com', phase: 'idle' })
    svc.enterCode.mockRejectedValueOnce(new BridgeError('code-expired', 'Код неверный или уже просрочен. Создай новый.'))
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    const d = within(await dialog())
    await user.click(d.getByText('Ввести код'))
    const field = d.getByLabelText('Код из Орбиты')
    expect(d.getByRole('button', { name: 'Подключить' })).toBeDisabled()
    await user.type(field, 'bridge1.WRONG')
    await user.click(d.getByRole('button', { name: 'Подключить' }))
    expect(await d.findByRole('alert')).toHaveTextContent('Код неверный или уже просрочен')
    await user.click(d.getByRole('button', { name: 'Подключить' }))
    await waitFor(() => expect(svc.enterCode).toHaveBeenCalledTimes(2))
    expect(svc.enterCode).toHaveBeenLastCalledWith('bridge1.WRONG')
  })

  it('ошибка создания кода показывается, а не молчит', async () => {
    useCloud.setState({ userId: 'u1', email: 'max@mail.com', phase: 'idle' })
    svc.makeCode.mockRejectedValueOnce(new BridgeError('offline', 'Нет связи с интернетом'))
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    const d = within(await dialog())
    await user.click(d.getByText('Показать код'))
    expect(await d.findByRole('alert')).toHaveTextContent('Нет связи с интернетом')
  })
})

describe('Орбита: подключена', () => {
  beforeEach(() => {
    useCloud.setState({ userId: 'u1', email: 'max@mail.com', phase: 'idle' })
    useBridge.setState({ connections: [conn()], phase: 'idle', lastCycleAt: Date.now() - 120_000 })
  })

  it('карточка в профиле и статус в шторке', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/me')
    expect(await screen.findByText('Подключена · обязательства, записи и люди')).toBeInTheDocument()
    await user.click(screen.getByText('Приложение «Орбита»'))
    const d = within(await dialog())
    expect(d.getByText('Орбита подключена')).toBeInTheDocument()
    expect(d.getByRole('status')).toHaveTextContent('Синхронизировано · 2 мин назад')
    expect(bad).toEqual([])
  })

  it('переключатели разрешений сохраняются на сервере', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    const d = within(await dialog())
    const sw = d.getByRole('switch', { name: /Записи о встречах/ })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)
    await waitFor(() => expect(svc.changeScopes).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), ['people', 'commitments', 'facts']))
  })

  it('отключение требует подтверждения', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    const d = within(await dialog())
    await user.click(d.getByText('Отключить'))
    expect(svc.disconnect).not.toHaveBeenCalled()
    expect(d.getByText('Отключить Орбиту?')).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Отмена' }))
    expect(d.queryByText('Отключить Орбиту?')).not.toBeInTheDocument()
    await user.click(d.getByText('Отключить'))
    await user.click(d.getAllByRole('button', { name: 'Отключить' }).at(-1)!)
    await waitFor(() => expect(svc.disconnect).toHaveBeenCalledTimes(1))
  })

  it('если Орбита отключила подключение — предупреждение', async () => {
    useBridge.setState({ revoked: true })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    expect(await within(await dialog()).findByRole('alert')).toHaveTextContent('Орбита отключила подключение')
  })

  it('кнопка «Синхронизировать сейчас»', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    await user.click(within(await dialog()).getByRole('button', { name: 'Синхронизировать сейчас' }))
    await waitFor(() => expect(svc.runBridge).toHaveBeenCalled())
  })

  it('люди: предложение «Тот же» и «Нет», разрыв связи', async () => {
    await db.people.bulkAdd([person({ id: 'a1', firstName: 'Борис' }), person({ id: 'a2', firstName: 'Алина', lastName: 'Воронцова' })])
    await db.bridgeMeta.bulkPut([
      { key: 'peerPeople', value: { 'o-boris': { name: 'Борис Катин', aliases: [], ms: 1 }, 'o-alina': { name: 'Алина Воронцова', aliases: [], ms: 1 } } },
      { key: 'links', value: [{ local_id: 'a2', peer_id: 'o-alina', origin: 'auto', deleted: false, updated_ms: 1 }] },
    ])
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Приложение «Орбита»'))
    const d = within(await dialog())
    expect(await d.findByText(/В Орбите 2 человека, связано 1/)).toBeInTheDocument()
    expect(await d.findByText((_, el) => el?.tagName === 'DIV' && el.className.includes('truncate') && /^Борис\s*=\s*Борис Катин$/.test((el.textContent ?? '').trim()))).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Тот же' }))
    expect(svc.linkPeople).toHaveBeenCalledWith('a1', 'o-boris')
    await user.click(d.getByRole('button', { name: 'Это разные люди' }))
    expect(svc.unlinkPeople).toHaveBeenCalledWith('a1', 'o-boris')
    await user.click(d.getByText(/Показать связанных \(1\)/))
    await user.click(await d.findByRole('button', { name: 'Разорвать' }))
    expect(svc.unlinkPeople).toHaveBeenCalledWith('a2', 'o-alina')
  })
})

describe('Орбита: предложения', () => {
  beforeEach(async () => {
    useCloud.setState({ userId: 'u1', email: 'max@mail.com', phase: 'idle' })
    useBridge.setState({ connections: [conn()] })
    const day = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10)
    await db.people.add(person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }))
    await db.bridgeMeta.bulkPut([
      { key: 'links', value: [{ local_id: 'a1', peer_id: 'o-alina', origin: 'auto', deleted: false, updated_ms: 1 }] },
      { key: 'peerCaptures', value: { k1: { day, title: 'Ужин у Алины', summary: 'Обсудили инвестора', kind: 'meeting', people: [{ ref: 'o-alina', name: 'Алина' }], ms: 1 } } },
      { key: 'peerFacts', value: { f1: { title: 'Любит бег', people: [{ ref: 'o-alina', name: 'Алина' }], ms: 1 } } },
    ])
  })

  it('на «Сегодня» появляется карточка, в шторке можно добавить и скрыть', async () => {
    const { user } = renderApp('/')
    expect(await screen.findByText(/Орбита предлагает добавить 2 записи/)).toBeInTheDocument()
    await user.click(screen.getByText('Открыть'))
    const d = within(await dialog())
    expect(await d.findByText('Ужин у Алины')).toBeInTheDocument()
    await user.click(d.getAllByRole('button', { name: 'Добавить' })[0]!)
    await waitFor(async () => expect(await db.interactions.count()).toBe(1))
    expect((await db.interactions.toArray())[0]).toMatchObject({ title: 'Ужин у Алины', type: 'meeting', personIds: ['a1'] })
    await user.click(await d.findByRole('button', { name: 'Скрыть' }))
    await waitFor(async () => expect((await db.settings.get('me'))?.bridgeHandled).toContain('fact:f1:a1'))
    await waitFor(() => expect(d.queryByText('Любит бег')).not.toBeInTheDocument())
  })

  it('«Добавить все» принимает всё сразу', async () => {
    const { user } = renderApp('/')
    await user.click(await screen.findByText('Открыть'))
    await user.click(await within(await dialog()).findByRole('button', { name: 'Добавить все' }))
    await waitFor(async () => expect(await db.interactions.count()).toBe(1))
    await waitFor(async () => expect((await db.people.get('a1'))?.facts.map(f => f.text)).toEqual(['Любит бег']))
  })

  it('карточка на «Сегодня» не показывается, когда предлагать нечего', async () => {
    await db.bridgeMeta.clear()
    renderApp('/')
    await screen.findByText(/тонус сети/i, undefined, { timeout: 4000 }).catch(() => undefined)
    expect(screen.queryByText(/Орбита предлагает/)).not.toBeInTheDocument()
  })

  it('профиль человека: статистика из Орбиты', async () => {
    await db.bridgeMeta.put({ key: 'peerStats', value: { 'o-alina': { mentions: 7, lastMentionAt: NOW - DAY, openOwedToMe: 2, openIOwe: 1 } } })
    renderApp('/person/a1?tab=links')
    expect(await screen.findByText('В Орбите')).toBeInTheDocument()
    expect(screen.getByText(/упоминаний: 7/)).toBeInTheDocument()
    expect(screen.getByText(/мне должны: 2/)).toBeInTheDocument()
    expect(screen.getByText(/я должен: 1/)).toBeInTheDocument()
  })
})
