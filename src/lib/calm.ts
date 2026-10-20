/** Пока идёт прокрутка, фоновые анимации (`.ambient`) стоят на паузе: кадры нужны самой прокрутке. */
export function installCalm(root: HTMLElement = document.documentElement): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const onScroll = () => {
    if (!root.hasAttribute('data-calm')) root.setAttribute('data-calm', '')
    clearTimeout(timer)
    timer = setTimeout(() => root.removeAttribute('data-calm'), 160)
  }
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => {
    window.removeEventListener('scroll', onScroll, { capture: true })
    clearTimeout(timer)
    root.removeAttribute('data-calm')
  }
}
