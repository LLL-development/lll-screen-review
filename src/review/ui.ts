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

/** Pieces that stay on the page for good; see mountUi. */
const mounted = new Set<Element>()
let watcher: MutationObserver | null = null

/**
 * Adds one of the tool's pieces to the page, for as long as the page lasts.
 *
 * If the page throws it out anyway, it is put straight back.
 */
export function mountUi(el: Element): void {
  mounted.add(el)
  attachUi(el)

  if (!watcher) {
    watcher = new MutationObserver(() => {
      for (const node of mounted) {
        if (!node.isConnected) document.documentElement.appendChild(node)
      }
    })
    watcher.observe(document.documentElement, { childList: true })
  }
}

/**
 * Adds one of the tool's pieces to the page, for the caller to remove again.
 *
 * It goes into <html>, beside <body> rather than inside it. Plenty of sites
 * replace or empty <body> as they go — view transitions, a framework mounting
 * onto it — and would take the tool with it. A transform or zoom on <body>
 * would also shift everything the tool draws, since it is all positioned
 * against the window.
 */
export function attachUi(el: Element): void {
  // Keys typed into the tool stay in the tool. Sites listen for shortcuts on
  // the document, and an "s" or "/" typed into a comment would set them off.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    el.addEventListener(type, (event) => event.stopPropagation())
  }
  document.documentElement.appendChild(el)
}

/**
 * Looks an element up by a stored selector.
 *
 * Always look up fresh rather than holding a reference: the page may have
 * re-rendered since the comment was left. Returns null when the element is
 * gone, or when the selector is no longer valid CSS — callers decide what to
 * do about it, nothing here should throw.
 *
 * The tool's own elements never count. A selector as plain as "textarea" was
 * unique when it was taken, but once the page's one is gone it would match
 * the comment box's instead.
 */
export function findElement(selector: string): Element | null {
  try {
    for (const el of document.querySelectorAll(selector)) {
      if (!isOurUi(el)) return el
    }
    return null
  } catch {
    return null
  }
}
