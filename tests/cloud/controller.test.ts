import { afterEach, describe, expect, it } from 'vitest'
import { SyncController, type ControllerOptions } from '@/cloud/controller'
import type { CloudState } from '@/cloud/store'
import { FakeServer, makeDevice, until, type Device } from './fake'
import { personOf } from './rows'

const running: SyncController[] = []
afterEach(() => { for (const c of running.splice(0)) c.stop() })

function setup(opts: Partial<ControllerOptions> & { device?: Device; server?: FakeServer; userId?: string } = {}) {
  const device = opts.device ?? makeDevice()
  const server = opts.server ?? new FakeServer()
  const state: Partial<CloudState> = {}
  const history: string[] = []
  const ctl = new SyncController({
    remote: server.remote(),
    engine: device.engine,
    userId: opts.userId ?? 'u1',
    report: p => { Object.assign(state, p); if (p.phase) history.push(p.phase) },
    debounceMs: 15,
    pollMs: 3_600_000,
    focusThrottleMs: 0,
    backoffMs: [30],
    ...opts,
  })
  running.push(ctl)
  return { device, server, state, history, ctl }
}

describe('SyncController', () => {
  it('первый запуск на пустом устройстве: запоминает владельца и сообщает «синхронизировано»', async () => {
    const { ctl, state, device } = setup()
    await ctl.start()
    expect(state.phase).toBe('idle')
    expect(state.lastSyncAt).toBeGreaterThan(0)
    expect(await device.engine.getMeta('userId')).toBe('u1')
  })

  it('локальные данные до входа попадают в облако', async () => {
    const device = makeDevice()
    await device.db.people.bulkAdd([personOf('a'), personOf('b')])
    await device.db.outbox.clear() // как будто правки были давно, очередь не помнит
    const { ctl, server } = setup({ device })
    await ctl.start()
    expect(server.live('people').map(r => r.id).sort()).toEqual(['a', 'b'])
  })

  it('правка на устройстве уходит сама, без нажатия кнопки', async () => {
    const { ctl, server, device } = setup()
    await ctl.start()
    await device.db.people.add(personOf('p1'))
    await until(() => server.get('people', 'p1'))
  })

  it('сигнал Realtime подтягивает чужую правку', async () => {
    const other = makeDevice()
    const server = new FakeServer()
    let ping = () => {}
    const { ctl, device } = setup({ server, subscribe: p => { ping = p; return () => {} } })
    await ctl.start()
    await other.db.people.add(personOf('from-other'))
    await other.engine.syncOnce(server.remote())
    ping()
    await until(async () => device.db.people.get('from-other'))
  })

  it('нет сети: статус «offline» с числом ожидающих, при появлении сети всё уходит', async () => {
    let online = false
    const { ctl, state, device, server } = setup({ online: () => online })
    await ctl.start()
    expect(state.phase).toBe('offline')
    await device.db.people.add(personOf('p1'))
    await until(async () => (await device.db.outbox.count()) === 1)
    await ctl.syncNow()
    expect(state.pending).toBe(1)
    expect(server.get('people', 'p1')).toBeUndefined()
    online = true
    await ctl.syncNow()
    expect(state.phase).toBe('idle')
    expect(state.pending).toBe(0)
    expect(server.get('people', 'p1')).toBeDefined()
  })

  it('ошибка сервера: статус «error», данные остаются в очереди, потом само повторяет', async () => {
    const { ctl, state, device, server } = setup()
    await ctl.start()
    await device.db.people.add(personOf('p1'))
    await until(async () => (await device.db.outbox.count()) === 1)
    server.failNext = 1
    await ctl.syncNow()
    expect(state.phase).toBe('error')
    expect(state.pending).toBe(1)
    await until(() => server.get('people', 'p1')) // повтор по таймеру
    await until(() => state.phase === 'idle')
  })

  it('обрыв сети во время запроса считается «offline», а не ошибкой', async () => {
    const { ctl, state, server } = setup()
    server.online = false
    await ctl.start()
    expect(state.phase).toBe('offline')
    expect(state.error).toBeUndefined()
  })

  it('параллельные вызовы схлопываются: не больше одной синхронизации одновременно', async () => {
    const { ctl, server, device } = setup()
    await ctl.start()
    await device.db.people.add(personOf('p1'))
    await until(async () => (await device.db.outbox.count()) === 1)
    server.pushes.length = 0
    await Promise.all([ctl.syncNow(), ctl.syncNow(), ctl.syncNow(), ctl.syncNow()])
    expect(server.pushes.length).toBe(1)
  })

  it('другой аккаунт на том же устройстве: чужие данные удаляются и не смешиваются', async () => {
    const device = makeDevice()
    const server = new FakeServer()
    const first = setup({ device, server, userId: 'u1' })
    await first.ctl.start()
    await device.db.people.add(personOf('mine'))
    await first.ctl.syncNow()
    first.ctl.stop()

    const server2 = new FakeServer()
    const seed = makeDevice()
    await seed.db.people.add(personOf('theirs'))
    await seed.engine.syncOnce(server2.remote())

    const second = setup({ device, server: server2, userId: 'u2' })
    await second.ctl.start()
    expect(second.state.notice).toMatch(/другого аккаунта/)
    expect((await device.db.people.toArray()).map(p => p.id)).toEqual(['theirs'])
    expect(server2.get('people', 'mine')).toBeUndefined()
    expect(await device.engine.getMeta('userId')).toBe('u2')
  })

  it('тот же аккаунт после перезапуска: данные не трогаем', async () => {
    const device = makeDevice()
    const server = new FakeServer()
    const a = setup({ device, server })
    await a.ctl.start()
    await device.db.people.add(personOf('p1'))
    await a.ctl.syncNow()
    a.ctl.stop()
    const b = setup({ device, server })
    await b.ctl.start()
    expect(await device.db.people.get('p1')).toBeDefined()
    expect(b.state.notice).toBeUndefined()
  })

  it('после stop() синхронизации больше не запускаются', async () => {
    const { ctl, server, device } = setup()
    await ctl.start()
    ctl.stop()
    await device.db.people.add(personOf('p1'))
    await new Promise(r => setTimeout(r, 80))
    expect(server.get('people', 'p1')).toBeUndefined()
    await ctl.syncNow()
    expect(server.get('people', 'p1')).toBeUndefined()
  })

  it('полная пересинхронизация загружает локальное заново', async () => {
    const { ctl, server, device } = setup()
    await ctl.start()
    await device.db.people.add(personOf('p1'))
    await ctl.syncNow()
    server.rows.clear()
    await ctl.resync()
    expect(server.get('people', 'p1')).toBeDefined()
  })
})

describe('демо-данные и облако', () => {
  it('демо-данные при первом входе удаляются и не попадают в аккаунт', async () => {
    const device = makeDevice()
    await device.db.settings.add({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1, demo: true })
    await device.db.people.bulkAdd([personOf('fake1'), personOf('fake2')])
    const { ctl, server, state } = setup({ device })
    await ctl.start()
    expect(server.live('people')).toHaveLength(0)
    expect(server.live('settings')).toHaveLength(0)
    expect(await device.db.people.count()).toBe(0)
    expect(state.notice).toMatch(/Демо-данные удалены/)
  })

  it('настоящие данные не трогаются', async () => {
    const device = makeDevice()
    await device.db.settings.add({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1 })
    await device.db.people.add(personOf('real'))
    const { ctl, server, state } = setup({ device })
    await ctl.start()
    expect(server.get('people', 'real')).toBeDefined()
    expect(state.notice).toBeUndefined()
  })

  it('число отклонённых записей попадает в состояние', async () => {
    const device = makeDevice()
    const { ctl, server, state } = setup({ device })
    await ctl.start()
    server.poison.add('bad')
    await device.db.people.bulkAdd([personOf('ok'), personOf('bad')])
    await until(() => state.rejected === 1)
    expect(server.get('people', 'ok')).toBeDefined()
  })
})
