/**
 * The numbered markers left on the page.
 *
 * A pin is anchored to an element, not to a fixed spot on the screen: it sits
 * on that element's top-left corner and is repositioned whenever the page
 * moves, using the same approach as the highlight box (read the element's
 * bounding rectangle, write it onto a fixed-position node).
 *
 * The pins redraw themselves from the store whenever it changes, so adding or
 * deleting a comment updates them without anyone having to say so.
 */

import { getComments, isOnThisPage, onChange, type ReviewComment } from './store'
import { findElement, markAsUi, mountUi, onRemoveUi } from './ui'

/** How often the selectors are looked up again; see track. */
const RECHECK_MS = 500

const layer = markAsUi(document.createElement('div'))
layer.className = 'sr-pin-layer'

/** What to do when a pin is clicked; supplied by review.ts on mount. */
let onActivate: ((comment: ReviewComment) => void) | null = null

/**
 * Every comment, paired with the element its selector found (if any) and its
 * pin (if it has one), so the page moving doesn't mean rebuilding the DOM.
 */
const placed: {
  comment: ReviewComment
  el: Element | null
  node: HTMLElement | null
}[] = []

let frame = 0
let lastCheck = 0

export function mountPins(handler: (comment: ReviewComment) => void): void {
  onActivate = handler
  mountUi(layer)
  onChange(render)
  onRemoveUi(() => {
    cancelAnimationFrame(frame)
    frame = 0
    placed.length = 0
  })
  render()
}

function render(): void {
  layer.replaceChildren()
  placed.length = 0

  for (const comment of getComments()) {
    // A comment from another page of the site belongs to an element there.
    // Its selector may well match something here too — "main > h1" — but
    // that's a different element.
    if (!isOnThisPage(comment)) continue

    const el = findElement(comment.selector)
    // No element to pin to: the comment still exists and still shows up in the
    // panel, there is just nowhere on the page to put a marker — for now.
    const node = el ? buildPin(comment) : null
    if (node) layer.appendChild(node)
    placed.push({ comment, el, node })
  }

  repositionPins()
  lastCheck = performance.now()
  if (placed.length > 0) frame ||= requestAnimationFrame(track)
}

/**
 * Runs every frame while there are comments. Pins move with their element
 * however it moves — scrolling, but also an image loading above it or an
 * animation. And every so often the selectors are looked up again, so a pin
 * follows an element the page re-rendered, goes with one it removed, and
 * turns up for one that has only just appeared.
 */
function track(now: number): void {
  frame = 0
  if (placed.length === 0) return

  if (now - lastCheck > RECHECK_MS) {
    lastCheck = now
    if (placed.some((p) => findElement(p.comment.selector) !== p.el)) {
      render()
      return
    }
  }

  repositionPins()
  frame = requestAnimationFrame(track)
}

function buildPin(comment: ReviewComment): HTMLElement {
  const pin = document.createElement('button')
  pin.type = 'button'
  pin.className = 'sr-pin'
  // The number is the comment's id, so it reflects creation order and never
  // changes for a given comment — deleting #2 leaves 1 and 3 alone.
  pin.textContent = String(comment.id)
  pin.title = comment.comment
  // Resolved pins stay on the page but recede; the styling lives in CSS.
  pin.dataset.status = comment.status
  pin.addEventListener('click', (event) => {
    event.stopPropagation()
    onActivate?.(comment)
  })
  return pin
}

function repositionPins(): void {
  // Every rectangle first, then every write: reading after writing would
  // make the browser redo its layout once per pin.
  const rects = placed.map(({ el, node }) =>
    el && node && el.isConnected ? el.getBoundingClientRect() : null,
  )

  placed.forEach(({ node }, i) => {
    if (!node) return
    const rect = rects[i]

    // Hidden, collapsed or removed elements have no rectangle worth pinning to.
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      node.style.display = 'none'
      return
    }

    node.style.display = 'flex'
    node.style.top = `${rect.top}px`
    node.style.left = `${rect.left}px`
  })
}
