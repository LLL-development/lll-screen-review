/**
 * The blue boxes drawn over elements.
 *
 * Each is a separate floating div sized to its element's bounding rectangle,
 * rather than an outline applied to the element itself. That matters: if we
 * added a class to the page's own elements, finder would see it and bake our
 * styling class into the selectors we capture.
 *
 * Usually there is one box: the element under the cursor, or the one a
 * comment is about. A comment on several elements outlines them all, and
 * while one is being written, the element under the cursor gets a dashed box
 * of its own, saying what a Shift+click there would do.
 *
 * Both the hover behaviour and the comments panel point it at things, which is
 * why it lives in its own module. The panel only borrows it: hovering a row
 * previews that comment's elements, and leaving the row puts back whatever was
 * shown before — the elements a comment box is open on, say.
 */

import { formatName } from './describe'
import { commentTargets, type ReviewComment } from './store'
import { findElement, mountUi, onRemoveUi } from './ui'

export type HighlightTarget = { el: Element; text: string }

const layer = document.createElement('div')
layer.className = 'sr-highlight-layer'

/** One per box on screen, kept for reuse once drawn. */
const boxes: HTMLElement[] = []

/** What the tool is pointing at: the hovered element, or the ones being commented on. */
let base: readonly HighlightTarget[] = []
/** A panel row's elements, shown in place of base while the row is hovered. */
let preview: readonly HighlightTarget[] | null = null
/** The element under the cursor while a comment is being written. */
let candidate: HighlightTarget | null = null

let frame = 0

export function mountHighlight(): void {
  mountUi(layer)
  onRemoveUi(() => {
    cancelAnimationFrame(frame)
    frame = 0
    base = []
    preview = candidate = null
  })
}

export function showHighlight(targets: readonly HighlightTarget[]): void {
  base = targets
  update()
}

export function hideHighlight(): void {
  base = []
  candidate = null
  update()
}

/** Shows elements until endPreview, without losing what was shown before. */
export function previewHighlight(targets: readonly HighlightTarget[]): void {
  preview = targets
  update()
}

export function endPreview(): void {
  preview = null
  update()
}

/**
 * Outlines one more element, dashed, beside the ones shown: the element a
 * Shift+click would add to a comment. Null takes it away.
 */
export function showCandidate(target: HighlightTarget | null): void {
  if (target?.el === candidate?.el && target?.text === candidate?.text) return
  candidate = target
  update()
}

/** The element the tool is pointing at, if any; previews don't count. */
export function highlightedElement(): Element | null {
  return base[0]?.el ?? null
}

/** A comment's elements that are on the page now, ready to outline. */
export function foundTargets(comment: ReviewComment): HighlightTarget[] {
  return commentTargets(comment).flatMap(({ selector, name }) => {
    const el = findElement(selector)
    return el ? [{ el, text: formatName(name) }] : []
  })
}

/**
 * Everything to outline right now. The candidate goes beside the rest, or in
 * place of its own box when it is one of them already, saying what a
 * Shift+click would do instead of its name.
 */
function shown(): HighlightTarget[] {
  if (preview) return [...preview]
  const now = candidate
  if (!now) return [...base]
  const at = base.findIndex((t) => t.el === now.el)
  return at === -1 ? [...base, now] : base.map((t, i) => (i === at ? now : t))
}

function update(): void {
  const targets = shown()
  while (boxes.length < targets.length) boxes.push(buildBox())

  targets.forEach((target, i) => {
    const box = boxes[i]
    box.classList.toggle('sr-highlight-candidate', target === candidate)
    labelOf(box).textContent = target.text
  })
  draw(targets)
  if (targets.length > 0) frame ||= requestAnimationFrame(track)
}

/**
 * Redraws every frame while anything is outlined. An element can move
 * without the page scrolling — an image loading above it, an animation, a
 * menu opening — and its box has to move with it.
 */
function track(): void {
  frame = 0
  const targets = shown()
  if (targets.length === 0) return
  draw(targets)
  frame = requestAnimationFrame(track)
}

function draw(targets: readonly HighlightTarget[]): void {
  // Every rectangle first, then every write: reading after writing would
  // make the browser redo its layout once per box.
  const rects = targets.map(({ el }) => (el.isConnected ? el.getBoundingClientRect() : null))

  boxes.forEach((box, i) => {
    const rect = rects[i]
    // A spare box, or an element taken out of the page: nothing to outline.
    if (!rect) {
      box.style.display = 'none'
      return
    }

    box.style.display = 'block'
    box.style.top = `${rect.top}px`
    box.style.left = `${rect.left}px`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`

    // The label normally sits above the box, which is off screen for anything
    // at the very top; tuck it inside instead.
    labelOf(box).classList.toggle('sr-highlight-label-inside', rect.top < 24)
  })
}

function buildBox(): HTMLElement {
  const box = document.createElement('div')
  box.className = 'sr-highlight'
  box.innerHTML = '<span class="sr-highlight-label"></span>'
  layer.append(box)
  return box
}

function labelOf(box: HTMLElement): HTMLElement {
  return box.firstElementChild as HTMLElement
}
