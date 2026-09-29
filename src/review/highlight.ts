/**
 * The blue box drawn over an element.
 *
 * It is a separate floating div sized to the element's bounding rectangle,
 * rather than an outline applied to the element itself. That matters: if we
 * added a class to the page's own elements, finder would see it and bake our
 * styling class into the selectors we capture.
 *
 * Both the hover behaviour and the comments panel point it at things, which is
 * why it lives in its own module. The panel only borrows it: hovering a row
 * previews that comment's element, and leaving the row puts back whatever the
 * box was showing before — the element a comment box is open on, say.
 */

import { markAsUi, mountUi } from './ui'

type Target = { el: Element; text: string }

const box = markAsUi(document.createElement('div'))
box.className = 'sr-highlight'
box.innerHTML = '<span class="sr-highlight-label"></span>'

const label = box.firstElementChild as HTMLElement

/** What the tool is pointing at: the hovered element, or the one being commented on. */
let base: Target | null = null
/** A panel row's element, shown in place of base while the row is hovered. */
let preview: Target | null = null

let frame = 0

export function mountHighlight(): void {
  mountUi(box)
}

export function showHighlight(el: Element, text: string): void {
  base = { el, text }
  update()
}

export function hideHighlight(): void {
  base = null
  update()
}

/** Shows an element until endPreview, without losing what was shown before. */
export function previewHighlight(el: Element, text: string): void {
  preview = { el, text }
  update()
}

export function endPreview(): void {
  preview = null
  update()
}

/** The element the tool is pointing at, if any; previews don't count. */
export function highlightedElement(): Element | null {
  return base?.el ?? null
}

function update(): void {
  const target = preview ?? base
  if (!target) {
    box.style.display = 'none'
    return
  }
  label.textContent = target.text
  draw(target.el)
  frame ||= requestAnimationFrame(track)
}

/**
 * Redraws every frame while the box is up. The element can move without the
 * page scrolling — an image loading above it, an animation, a menu opening —
 * and the box has to move with it.
 */
function track(): void {
  frame = 0
  const target = preview ?? base
  if (!target) return
  draw(target.el)
  frame = requestAnimationFrame(track)
}

function draw(el: Element): void {
  // Taken out of the page (a re-render, say): nothing left to outline.
  if (!el.isConnected) {
    box.style.display = 'none'
    return
  }

  const rect = el.getBoundingClientRect()
  box.style.display = 'block'
  box.style.top = `${rect.top}px`
  box.style.left = `${rect.left}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`

  // The label normally sits above the box, which is off screen for anything
  // at the very top; tuck it inside instead.
  label.classList.toggle('sr-highlight-label-inside', rect.top < 24)
}
