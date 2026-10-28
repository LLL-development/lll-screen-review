/**
 * Where the comment reader sits, and how big it is.
 *
 * The reader opens beside the element it's about, below it if there's room,
 * then above, then to either side, so it doesn't cover what it describes.
 * Only with no room anywhere does it sit on top.
 *
 * Its bottom-right corner can be dragged to make it bigger, and the size is
 * kept for the site: someone working through a long review sets it once.
 * The width is kept as it was left. The height is kept as a limit instead,
 * so a one-line comment still opens small and only a long one fills it.
 */

/** Kept for the site, beside its comments. */
const SIZE_KEY = 'screen-review:reader-size'

/** How close to the bottom-right corner a press has to be to grab it. */
const GRIP = 18

const GAP = 12

/**
 * Keeps a reader clear of rect (its element), or in the middle of the
 * window with no element to point at. Re-placed whenever it changes size,
 * except while being resized, when it only stays on screen: jumping from
 * below the element to above it would pull the corner out from under the
 * cursor. Returns what stops it.
 */
export function placeReader(box: HTMLElement, rect: DOMRect | null): () => void {
  let resizing = false

  const place = () => {
    const w = box.offsetWidth
    const h = box.offsetHeight
    const clampX = (x: number) => Math.max(GAP, Math.min(x, window.innerWidth - w - GAP))
    const clampY = (y: number) => Math.max(GAP, Math.min(y, window.innerHeight - h - GAP))

    let left: number
    let top: number
    if (resizing) {
      left = clampX(box.offsetLeft)
      top = clampY(box.offsetTop)
    } else if (!rect) {
      left = clampX((window.innerWidth - w) / 2)
      top = clampY(window.innerHeight / 3 - h / 3)
    } else if (rect.bottom + GAP + h <= window.innerHeight - GAP) {
      left = clampX(rect.left)
      top = rect.bottom + GAP
    } else if (rect.top - GAP - h >= GAP) {
      left = clampX(rect.left)
      top = rect.top - GAP - h
    } else if (rect.right + GAP + w <= window.innerWidth - GAP) {
      left = rect.right + GAP
      top = clampY(rect.top)
    } else if (rect.left - GAP - w >= GAP) {
      left = rect.left - GAP - w
      top = clampY(rect.top)
    } else {
      left = clampX(rect.left + GAP)
      top = clampY(rect.top + GAP)
    }
    box.style.left = `${left}px`
    box.style.top = `${top}px`
  }

  // The browser's own resize corner gives no event of its own, so a press
  // near that corner is taken as the start of one.
  const onPress = (event: PointerEvent) => {
    const bounds = box.getBoundingClientRect()
    if (event.clientX < bounds.right - GRIP || event.clientY < bounds.bottom - GRIP) return
    resizing = true
    // As big as the window allows while dragging, whatever it opened at.
    box.style.maxHeight = `calc(100vh - ${GAP * 2}px)`
    window.addEventListener(
      'pointerup',
      () => {
        resizing = false
        saveSize(box.offsetWidth, box.offsetHeight)
      },
      { once: true },
    )
  }

  place()
  const observer = new ResizeObserver(place)
  observer.observe(box)
  window.addEventListener('resize', place)
  box.addEventListener('pointerdown', onPress)

  return () => {
    observer.disconnect()
    window.removeEventListener('resize', place)
    box.removeEventListener('pointerdown', onPress)
  }
}

/** Opens a reader at the size it was last left at, if it was ever resized. */
export function applySavedSize(box: HTMLElement): void {
  const size = readSize()
  if (!size) return
  box.style.width = `${Math.min(size.width, window.innerWidth - GAP * 2)}px`
  box.style.maxHeight = `${Math.min(size.height, window.innerHeight - GAP * 2)}px`
}

/**
 * localStorage can throw (storage blocked, sandboxed frames); the reader
 * then opens at its usual size and forgets how it was resized.
 */
function readSize(): { width: number; height: number } | null {
  try {
    const [width, height] = (localStorage.getItem(SIZE_KEY) ?? '').split('x').map(Number)
    return width > 0 && height > 0 ? { width, height } : null
  } catch {
    return null
  }
}

function saveSize(width: number, height: number): void {
  try {
    localStorage.setItem(SIZE_KEY, `${Math.round(width)}x${Math.round(height)}`)
  } catch {
    // Not remembered; see readSize.
  }
}
