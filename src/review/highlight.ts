/**
 * The blue box drawn over an element.
 *
 * It is a separate floating div sized to the element's bounding rectangle,
 * rather than an outline applied to the element itself. That matters: if we
 * added a class to the page's own elements, finder would see it and bake our
 * styling class into the selectors we capture.
 *
 * Both the hover behaviour and the comments panel point it at things, which is
 * why it lives in its own module.
 */

import { markAsUi } from './ui'

const box = markAsUi(document.createElement('div'))
box.className = 'sr-highlight'
box.innerHTML = '<span class="sr-highlight-label"></span>'

const label = box.firstElementChild as HTMLElement

let current: Element | null = null

export function mountHighlight(): void {
  document.body.appendChild(box)

  // The box is positioned against the viewport, so it goes stale when the page
  // scrolls or resizes underneath it.
  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)
}

export function showHighlight(el: Element, text: string): void {
  current = el
  label.textContent = text
  reposition()
}

export function hideHighlight(): void {
  current = null
  box.style.display = 'none'
}

/** The element the box is currently drawn over, if any. */
export function highlightedElement(): Element | null {
  return current
}

function reposition(): void {
  if (!current) return
  const rect = current.getBoundingClientRect()
  box.style.display = 'block'
  box.style.top = `${rect.top}px`
  box.style.left = `${rect.left}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}
