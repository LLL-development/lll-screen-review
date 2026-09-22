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
