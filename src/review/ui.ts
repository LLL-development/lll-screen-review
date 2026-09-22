/**
 * Shared marker for the tool's own DOM.
 *
 * The review layer lives inside the page it is reviewing, so it needs a way to
 * tell "this is the page" from "this is me". Every element we create gets this
 * attribute, and the mouse handlers skip anything carrying it — otherwise the
 * toolbar would try to review itself.
 */

export const UI_ATTR = 'data-screen-review-ui'

export function markAsUi<T extends Element>(el: T): T {
  el.setAttribute(UI_ATTR, '')
  return el
}

export function isOurUi(el: Element): boolean {
  return Boolean(el.closest(`[${UI_ATTR}]`))
}

/**
 * Looks an element up by a stored selector.
 *
 * Always look up fresh rather than holding a reference: the page may have
 * re-rendered since the comment was left. Returns null when the element is
 * gone, or when the selector is no longer valid CSS — callers decide what to
 * do about it, nothing here should throw.
 */
export function findElement(selector: string): Element | null {
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}
