import { t } from '@/i18n'
/** Reads an image, crops it to a centred square and shrinks it to a ~512px JPEG. */
export async function fileToAvatar(file: File, size = 512): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error(t("Couldn't read the image")))
      i.src = url
    })
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    const sx = (img.naturalWidth - s) / 2
    const sy = (img.naturalHeight - s) / 2
    const canvas = document.createElement('canvas')
    const out = Math.min(size, s)
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, s, s, 0, 0, out, out)
    return canvas.toDataURL('image/jpeg', 0.86)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A photo of a document (business card, badge): no cropping, the long side up to maxSide. */
export async function fileToPhoto(file: File, maxSide = 1400): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error(t("Couldn't read the image")))
      i.src = url
    })
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * k)
    canvas.height = Math.round(img.naturalHeight * k)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function pickFile(accept: string, capture?: 'environment' | 'user'): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    if (capture) input.setAttribute('capture', capture)
    input.onchange = () => resolve(input.files?.[0] ?? null)
    // the picker closed with no file: otherwise the promise would hang forever
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}
