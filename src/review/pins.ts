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

import { getComments, onChange, type ReviewComment } from './store'
import { findElement, markAsUi } from './ui'

const layer = markAsUi(document.createElement('div'))
layer.className = 'sr-pin-layer'

/** What to do when a pin is clicked; supplied by review.ts on mount. */
let onActivate: ((comment: ReviewComment) => void) | null = null

/**
 * The pins currently on screen, paired with the element each one follows, so
 * scrolling can move them without rebuilding the DOM.
 */
const placed: { el: Element; node: HTMLElement }[] = []

export function mountPins(handler: (comment: ReviewComment) => void): void {
  onActivate = handler
  document.body.appendChild(layer)
  onChange(render)

  window.addEventListener('scroll', repositionPins, true)
  window.addEventListener('resize', repositionPins)

  render()
}

function render(): void {
  layer.replaceChildren()
  placed.length = 0

  for (const comment of getComments()) {
    const el = findElement(comment.selector)
    // No element to pin to: the comment still exists and still shows up in the
    // panel, there is just nowhere on the page to put a marker.
    if (!el) continue

    const node = buildPin(comment)
    layer.appendChild(node)
    placed.push({ el, node })
  }

  repositionPins()
}

function buildPin(comment: ReviewComment): HTMLElement {
  const pin = document.createElement('button')
  pin.type = 'button'
  pin.className = 'sr-pin'
  // The number is the comment's id, so it reflects creation order and never
  // changes for a given comment — deleting #2 leaves 1 and 3 alone.
  pin.textContent = String(comment.id)
  pin.title = comment.comment
  pin.addEventListener('click', (event) => {
    event.stopPropagation()
    onActivate?.(comment)
  })
  return pin
}

function repositionPins(): void {
  for (const { el, node } of placed) {
    const rect = el.getBoundingClientRect()

    // Hidden or collapsed elements have no rectangle worth pinning to.
    if (rect.width === 0 && rect.height === 0) {
      node.style.display = 'none'
      continue
    }

    node.style.display = 'flex'
    node.style.top = `${rect.top}px`
    node.style.left = `${rect.left}px`
  }
}
