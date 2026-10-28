import styles from './review.css?inline'

/**
 * Putting the tool on the page, and telling it apart from the page.
 *
 * Everything the tool draws lives in a shadow root on one host element. The
 * page's stylesheets can't reach inside it and its querySelectorAll can't
 * find anything in it, so a site's own CSS no longer restyles the tool's
 * buttons and text boxes. The host carries an attribute, and the mouse
 * handlers skip anything inside it — otherwise the toolbar would try to
 * review itself. Events from inside the shadow root reach the page with the
 * host as their target, so checking for the attribute is enough.
 */

export const UI_ATTR = 'data-screen-review-ui'

export function isOurUi(el: Element): boolean {
  return Boolean(el.closest(`[${UI_ATTR}]`))
}

/** The element on the page that holds the tool; see ensureRoot. */
let host: HTMLElement | null = null
let root: ShadowRoot | null = null
let watcher: MutationObserver | null = null

/** What each piece needs undone when the tool comes off the page. */
const cleanups: (() => void)[] = []

/** Registers something to undo when the tool is taken off the page. */
export function onRemoveUi(cleanup: () => void): void {
  cleanups.push(cleanup)
}

/**
 * Takes the tool off the page, and stops whatever kept its pieces up to date.
 * Only the browser extension does this, when it is switched off for a tab.
 */
export function removeUi(): void {
  watcher?.disconnect()
  watcher = null
  host?.remove()
  host = root = null
  for (const cleanup of cleanups.splice(0)) cleanup()
}

/**
 * Adds one of the tool's pieces to the page. Pieces that come and go, like
 * the comment box, are removed again by whoever added them.
 */
export function mountUi(el: Element): void {
  ensureRoot().append(el)
}

/**
 * Hides everything the tool draws while a screenshot is taken, so the
 * picture shows the page alone; screenshots.ts marks it up afterwards.
 */
export function setCapturing(on: boolean): void {
  host?.toggleAttribute('data-capturing', on)
}

/**
 * Sets, or with null clears, a data- attribute on the host, for review.css
 * to style the whole tool by: which corner it sits in, say (see dock.ts).
 */
export function setHostState(name: string, value: string | null): void {
  if (value === null) host?.removeAttribute(`data-${name}`)
  else host?.setAttribute(`data-${name}`, value)
}

/**
 * Puts the host on the page the first time a piece needs it, and puts it
 * straight back if the page throws it out.
 *
 * It goes into <html>, beside <body> rather than inside it. Plenty of sites
 * replace or empty <body> as they go — view transitions, a framework mounting
 * onto it — and would take the tool with it. A transform or zoom on <body>
 * would also shift everything the tool draws, since it is all positioned
 * against the window.
 */
function ensureRoot(): ShadowRoot {
  if (root) return root

  host = document.createElement('screen-review')
  host.setAttribute(UI_ATTR, '')
  // Open, so the tool's own DOM can be inspected and scripted while testing.
  // Closing it would keep nothing from the page worth keeping: the comments
  // are in the site's storage anyway.
  root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = styles
  root.append(style)

  // Keys typed into the tool stay in the tool. Sites listen for shortcuts on
  // the document, and an "s" or "/" typed into a comment would set them off.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    root.addEventListener(type, (event) => event.stopPropagation())
  }

  document.documentElement.appendChild(host)
  watcher = new MutationObserver(() => {
    if (host && !host.isConnected) document.documentElement.appendChild(host)
  })
  watcher.observe(document.documentElement, { childList: true })
  return root
}

/**
 * Looks an element up by a stored selector.
 *
 * Always look up fresh rather than holding a reference: the page may have
 * re-rendered since the comment was left. Returns null when the element is
 * gone, or when the selector is no longer valid CSS — callers decide what to
 * do about it, nothing here should throw.
 *
 * The tool's host never counts, should a positional selector like
 * "html > :last-child" land on it once the page's own element is gone.
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
