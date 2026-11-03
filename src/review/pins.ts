/**
 * The numbered markers left on the page.
 *
 * A pin is anchored to an element, not to a fixed spot on the screen: it sits
 * on that element's top-left corner and is repositioned whenever the page
 * moves, using the same approach as the highlight box (read the element's
 * bounding rectangle, write it onto a fixed-position node). A comment on
 * several elements has a pin on each, all with its number.
 *
 * The pins redraw themselves from the store whenever it changes, so adding or
 * deleting a comment updates them without anyone having to say so.
 *
 * A pin only shows while its element can be seen. An element inside a popup
 * the site has faded out, or underneath one it has opened, still has a
 * rectangle, and its pin would otherwise float over nothing; see isShown.
 *
 * Comments closed away inside a popup aren't left without a trace, though:
 * what opens the popup gets a hollow pin with their numbers, on its other
 * corner, so a closed dialog with feedback in it doesn't look like one
 * without. Clicking it opens the popup at the first of them; see reveal.ts.
 */

import {
  commentTargets,
  getComments,
  isOnThisPage,
  onChange,
  type ReviewComment,
} from './store'
import { findElement, isShown, mountUi, onRemoveUi } from './ui'
import { doorOf } from './reveal'

/** How often the selectors are looked up again, and pins checked for being seen; see track. */
const RECHECK_MS = 500

const layer = document.createElement('div')
layer.className = 'sr-pin-layer'

/** What to do when a pin is clicked; supplied by review.ts on mount. */
let onActivate: ((comment: ReviewComment) => void) | null = null

/**
 * Every element of every comment, paired with what its selector found (if
 * anything) and its pin (if it has one), so the page moving doesn't mean
 * rebuilding the DOM.
 */
const placed: {
  comment: ReviewComment
  selector: string
  el: Element | null
  node: HTMLElement | null
  /** Whether the element could be seen at the last check. */
  shown: boolean
}[] = []

/**
 * The hollow pins: one on each element that opens a popup with comments
 * closed away inside it, and those comments, in number order.
 */
const doors: { el: Element; comments: ReviewComment[]; node: HTMLElement }[] = []

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
    doors.length = 0
  })
  render()
}

function render(): void {
  layer.replaceChildren()
  placed.length = 0
  doors.length = 0

  for (const comment of getComments()) {
    // A comment from another page of the site belongs to an element there.
    // Its selector may well match something here too — "main > h1" — but
    // that's a different element.
    if (!isOnThisPage(comment)) continue

    for (const { selector } of commentTargets(comment)) {
      const el = findElement(selector)
      // No element to pin to: the comment still exists and still shows up in
      // the panel, there is just nowhere on the page to put a marker — for now.
      const node = el ? buildPin(comment) : null
      if (node) layer.appendChild(node)
      placed.push({ comment, selector, el, node, shown: true })
    }
  }

  checkShown()
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
    if (placed.some((p) => findElement(p.selector) !== p.el)) {
      render()
      return
    }
    checkShown()
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

/**
 * Asking the browser what's on top is too much to do every frame, so it's
 * done on the recheck: a pin lags a popup closing by half a second at most.
 */
function checkShown(): void {
  for (const p of placed) p.shown = p.el !== null && isShown(p.el)
  checkDoors()
}

/**
 * Puts a hollow pin on whatever opens a popup with comments closed away
 * inside it, and takes it off again once the popup is open and their own
 * pins show. Rebuilt only when which comments sit behind which element has
 * changed.
 */
function checkDoors(): void {
  const found = new Map<Element, ReviewComment[]>()
  for (const comment of getComments()) {
    if (!comment.openWith || !isOnThisPage(comment)) continue
    if (placed.some((p) => p.comment.id === comment.id && p.shown)) continue
    const door = doorOf(comment)
    if (door) found.set(door.el, [...(found.get(door.el) ?? []), comment])
  }

  const ids = (comments: readonly ReviewComment[] | undefined) =>
    (comments ?? []).map((c) => c.id).join(' ')
  if (found.size === doors.length && doors.every((d) => ids(found.get(d.el)) === ids(d.comments))) {
    return
  }

  for (const door of doors) door.node.remove()
  doors.length = 0
  for (const [el, comments] of found) {
    comments.sort((a, b) => a.id - b.id)
    const node = buildDoor(comments)
    layer.append(node)
    doors.push({ el, comments, node })
  }
}

function buildDoor(comments: readonly ReviewComment[]): HTMLElement {
  // The first still open is the one worth going to.
  const first = comments.find((c) => c.status === 'open') ?? comments[0]
  const numbers = comments.map((c) => c.id).join(', ')

  const pin = document.createElement('button')
  pin.type = 'button'
  pin.className = 'sr-pin sr-pin-door'
  pin.textContent = comments.length > 1 ? `${first.id} +${comments.length - 1}` : String(first.id)
  pin.title =
    comments.length > 1
      ? `Comments ${numbers} are inside what this opens. Click to see ${first.id}.`
      : `Comment ${first.id} is inside what this opens. Click to see it.`
  pin.dataset.status = comments.some((c) => c.status === 'open') ? 'open' : 'resolved'
  pin.addEventListener('click', (event) => {
    event.stopPropagation()
    onActivate?.(first)
  })
  return pin
}

function repositionPins(): void {
  // Every rectangle first, then every write: reading after writing would
  // make the browser redo its layout once per pin.
  const rects = placed.map(({ el, node }) =>
    el && node && el.isConnected ? el.getBoundingClientRect() : null,
  )
  const doorRects = doors.map(({ el }) => (el.isConnected ? el.getBoundingClientRect() : null))

  doors.forEach(({ node }, i) => {
    const rect = doorRects[i]
    node.style.display = rect ? 'flex' : 'none'
    if (!rect) return
    // The element's top-right corner: the top-left is for a pin of its own.
    node.style.top = `${rect.top}px`
    node.style.left = `${rect.right}px`
  })

  placed.forEach(({ node, shown }, i) => {
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
    // Faded rather than taken away, so it comes back the same way.
    node.toggleAttribute('data-unseen', !shown)
  })
}
