/**
 * Where the pill and the comments panel sit: together, in one of the
 * window's four corners, so neither ends up covering the part of the page
 * being reviewed.
 *
 * Drag the pill, or the panel by its header, and both follow the cursor. The
 * four corners light up as places to put them, the nearest one most, and
 * letting go glides them into it. A plain click on the pill still switches
 * review mode: only moving a few pixels with the button held counts as a
 * drag. The corner is remembered for the site.
 *
 * And they get out of the way on their own: an element the reviewer points
 * at that they cover a good part of makes them see-through (seeThrough), so
 * what is underneath can be seen before deciding to move them.
 */

import { mountUi, onRemoveUi, setHostState } from './ui'

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

const CORNERS: readonly Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left']

/** Kept for the site, beside its comments. */
const CORNER_KEY = 'screen-review:corner'

/** How far the pointer moves, held down, before a press becomes a drag. */
const DRAG_THRESHOLD = 5

/** How much of an element they have to cover before they turn see-through. */
const COVER_SHARE = 0.15

/** The pieces that move together: the pill and the panel. */
const pieces: HTMLElement[] = []

let corner: Corner = readCorner()

/** Shown while dragging: where the pieces can go. */
const spots = document.createElement('div')
spots.className = 'sr-dock-spots'
for (const place of CORNERS) {
  const spot = document.createElement('div')
  spot.className = 'sr-dock-spot'
  spot.dataset.corner = place
  spot.textContent = 'Move here'
  spots.append(spot)
}

export function mountDock(): void {
  mountUi(spots)
  setHostState('corner', corner)
  onRemoveUi(() => {
    pieces.length = 0
  })
}

/**
 * Lets el be dragged to another corner, taking the other pieces with it.
 * isHandle says which parts of it can be grabbed: the panel's header, say,
 * and not its list, which scrolls.
 */
export function dockPiece(el: HTMLElement, isHandle: (target: Element) => boolean): void {
  pieces.push(el)

  // Set once a drag ends, so the click that follows the release isn't taken
  // as a click: the pill would switch review mode every time it was moved.
  let dragged = false
  el.addEventListener(
    'click',
    (event) => {
      if (!dragged) return
      dragged = false
      event.preventDefault()
      event.stopImmediatePropagation()
    },
    true,
  )

  el.addEventListener('pointerdown', (event) => {
    dragged = false
    if (event.button !== 0 || !(event.target instanceof Element) || !isHandle(event.target)) {
      return
    }
    follow(event, el, () => (dragged = true))
  })
}

/**
 * Makes the pieces see-through while the element the reviewer is pointing
 * at is partly under them. Null, or an element clear of them, puts them back.
 */
export function seeThrough(el: Element | null): void {
  setHostState('see-through', el && isCovered(el) ? '' : null)
}

function isCovered(el: Element): boolean {
  const target = el.getBoundingClientRect()
  const area = target.width * target.height
  if (area === 0) return false

  let covered = 0
  for (const piece of pieces) {
    if (piece.hidden) continue
    const over = piece.getBoundingClientRect()
    const width = Math.min(target.right, over.right) - Math.max(target.left, over.left)
    const height = Math.min(target.bottom, over.bottom) - Math.max(target.top, over.top)
    if (width > 0 && height > 0) covered += width * height
  }
  // A section the size of the page always touches them; only an element
  // they hide a fair share of counts.
  return covered / area > COVER_SHARE
}

/** Follows one press: a drag once it has moved far enough, nothing before. */
function follow(start: PointerEvent, el: HTMLElement, onDragged: () => void): void {
  let dragging = false

  const move = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return
    const dx = event.clientX - start.clientX
    const dy = event.clientY - start.clientY

    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      dragging = true
      onDragged()
      // Keeps the pointer's events coming even over an iframe. Only now: set
      // on the press itself, it would stop the header's buttons being clicked.
      el.setPointerCapture(start.pointerId)
      setHostState('dragging', '')
    }

    for (const piece of pieces) piece.style.translate = `${dx}px ${dy}px`
    markNearest(nearestCorner(event.clientX, event.clientY))
  }

  const end = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
    if (!dragging) return

    setHostState('dragging', null)
    markNearest(null)
    // Cancelled, by the browser taking over a touch, say: back where it was.
    moveTo(event.type === 'pointerup' ? nearestCorner(event.clientX, event.clientY) : corner)
  }

  // On the window, and before anything else, so a page that stops pointer
  // events on their way up can't strand a drag halfway.
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
}

/** The corner whose quarter of the window the point is in. */
function nearestCorner(x: number, y: number): Corner {
  const vertical = y < window.innerHeight / 2 ? 'top' : 'bottom'
  const horizontal = x < window.innerWidth / 2 ? 'left' : 'right'
  return `${vertical}-${horizontal}`
}

function markNearest(near: Corner | null): void {
  for (const spot of spots.querySelectorAll<HTMLElement>('.sr-dock-spot')) {
    spot.toggleAttribute('data-near', spot.dataset.corner === near)
  }
}

/**
 * Settles the pieces in a corner, gliding from wherever they were let go.
 * The corner itself is plain CSS (review.css); the glide is the old position
 * subtracted from the new one, then let go of.
 */
function moveTo(next: Corner): void {
  const shown = pieces.filter((piece) => !piece.hidden)
  const before = shown.map((piece) => piece.getBoundingClientRect())

  corner = next
  setHostState('corner', next)
  writeCorner(next)

  shown.forEach((piece, i) => {
    piece.classList.remove('sr-gliding')
    piece.style.translate = ''
    const after = piece.getBoundingClientRect()
    piece.style.translate = `${before[i].left - after.left}px ${before[i].top - after.top}px`
  })
  // Reading a size makes the browser take in the starting point, or it would
  // skip straight to the end without gliding.
  void shown[0]?.offsetWidth
  for (const piece of shown) {
    piece.classList.add('sr-gliding')
    piece.style.translate = ''
    piece.addEventListener('transitionend', () => piece.classList.remove('sr-gliding'), {
      once: true,
    })
  }
}

/**
 * localStorage can throw (storage blocked, sandboxed frames); the pieces
 * then start in the usual corner and forget where they were moved.
 */
function readCorner(): Corner {
  try {
    const saved = localStorage.getItem(CORNER_KEY)
    return CORNERS.find((place) => place === saved) ?? 'bottom-right'
  } catch {
    return 'bottom-right'
  }
}

function writeCorner(place: Corner): void {
  try {
    localStorage.setItem(CORNER_KEY, place)
  } catch {
    // Not remembered; see readCorner.
  }
}
