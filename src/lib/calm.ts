/** While scrolling, background animations (`.ambient`) are paused: the frames are needed by the scrolling itself. */
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
