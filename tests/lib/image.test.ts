import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileToAvatar, fileToPhoto, pickFile } from '@/lib/image'

/** Подменяем Image и canvas: проверяем математику обрезки и ужатия, а не декодер браузера. */
let draw: ReturnType<typeof vi.fn>
let toDataURL: ReturnType<typeof vi.fn>
let canvasSize: { width: number; height: number }
const revoke = vi.fn()

function stubImage(w: number, h: number, fail = false) {
  vi.stubGlobal('Image', class {
    naturalWidth = w
    naturalHeight = h
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_: string) { queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.())) }
  })
}

const realCreate = document.createElement.bind(document)
let onInput: ((el: HTMLInputElement) => void) | null = null

beforeEach(() => {
  draw = vi.fn()
  toDataURL = vi.fn(() => 'data:image/jpeg;base64,XYZ')
  canvasSize = { width: 0, height: 0 }
  onInput = null
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = revoke
  revoke.mockClear()
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, o?: ElementCreationOptions) => {
    const el = realCreate(tag, o)
    if (tag === 'canvas') {
      Object.defineProperties(el, {
        getContext: { value: () => ({ drawImage: draw, imageSmoothingQuality: '' }) },
        toDataURL: { value: toDataURL },
        width: { get: () => canvasSize.width, set: (v: number) => { canvasSize.width = v } },
        height: { get: () => canvasSize.height, set: (v: number) => { canvasSize.height = v } },
      })
    }
    if (tag === 'input') {
      ;(el as HTMLInputElement).click = () => undefined
      onInput?.(el as HTMLInputElement)
    }
    return el
  })
})
afterEach(() => vi.unstubAllGlobals())

const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })

describe('fileToAvatar', () => {
  it('обрезает по центру в квадрат и ужимает до 512', async () => {
    stubImage(2000, 1000)
    expect(await fileToAvatar(file)).toBe('data:image/jpeg;base64,XYZ')
    expect(draw).toHaveBeenCalledWith(expect.anything(), 500, 0, 1000, 1000, 0, 0, 512, 512)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.86)
    expect(canvasSize).toEqual({ width: 512, height: 512 })
  })
  it('маленькие фото не растягивает', async () => {
    stubImage(300, 400)
    await fileToAvatar(file)
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 50, 300, 300, 0, 0, 300, 300)
    expect(canvasSize).toEqual({ width: 300, height: 300 })
  })
  it('освобождает ссылку на файл и при ошибке чтения', async () => {
    stubImage(1, 1, true)
    await expect(fileToAvatar(file)).rejects.toThrow(/прочитать картинку/)
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})

describe('fileToPhoto', () => {
  it('сохраняет пропорции, длинная сторона не больше maxSide', async () => {
    stubImage(3000, 2000)
    await fileToPhoto(file, 1400)
    expect(canvasSize).toEqual({ width: 1400, height: 933 })
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1400, 933)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85)
  })
  it('маленькие снимки не увеличивает', async () => {
    stubImage(800, 600)
    await fileToPhoto(file)
    expect(canvasSize).toEqual({ width: 800, height: 600 })
  })
})

describe('pickFile', () => {
  const grab = () => {
    let input!: HTMLInputElement
    onInput = el => { input = el }
    return () => input
  }
  it('настраивает тип файла и камеру', () => {
    const get = grab()
    void pickFile('image/*', 'environment')
    expect(get()).toMatchObject({ type: 'file', accept: 'image/*' })
    expect(get().getAttribute('capture')).toBe('environment')
  })
  it('отдаёт выбранный файл', async () => {
    const get = grab()
    const p = pickFile('.csv')
    Object.defineProperty(get(), 'files', { value: [file] })
    get().onchange?.(new Event('change'))
    expect(await p).toBe(file)
  })
  it('нет файла — null', async () => {
    const get = grab()
    const p = pickFile('.csv')
    Object.defineProperty(get(), 'files', { value: [] })
    get().onchange?.(new Event('change'))
    expect(await p).toBeNull()
  })
  it('закрыл окно выбора — тоже null, обещание не виснет', async () => {
    const get = grab()
    const p = pickFile('.csv')
    get().dispatchEvent(new Event('cancel'))
    expect(await p).toBeNull()
  })
})
