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

/**
 * Whether an element can actually be seen, not just whether it is there.
 *
 * Plenty of sites close a popup without removing it: they fade it out,
 * hide it, or slide it away, and it keeps its full size the whole time. A
 * pin on its button would float over nothing. And a popup that opens covers
 * whatever was pinned underneath. So this asks the browser what is on top
 * at a few points across the element, skipping the tool's own pieces.
 *
 * The element itself, or something inside it, being on top means it shows.
 * An ancestor being on top usually means the element just doesn't take
 * clicks (pointer-events: none), so then its styles decide: faded right out
 * or hidden means no. An element out of the window counts as shown, since
 * there is nothing on screen to get wrong.
 */
export function isShown(el: Element, rect = el.getBoundingClientRect()): boolean {
  if (!el.isConnected || (rect.width === 0 && rect.height === 0)) return false

  const left = Math.max(rect.left, 0)
  const right = Math.min(rect.right, window.innerWidth)
  const top = Math.max(rect.top, 0)
  const bottom = Math.min(rect.bottom, window.innerHeight)
  if (left >= right || top >= bottom) return true

  // The middle first, then a little in from each corner: a sticky header
  // over the top half still leaves the rest to see.
  const xs = [(left + right) / 2, left + (right - left) * 0.1, right - (right - left) * 0.1]
  const ys = [(top + bottom) / 2, top + (bottom - top) * 0.1, bottom - (bottom - top) * 0.1]
  const points = [
    [xs[0], ys[0]],
    [xs[1], ys[1]],
    [xs[2], ys[1]],
    [xs[1], ys[2]],
    [xs[2], ys[2]],
  ]

  let underAncestor = false
  for (const [x, y] of points) {
    const hit = document.elementsFromPoint(x, y).find((e) => !isOurUi(e))
    if (!hit) continue
    if (el === hit || el.contains(hit)) return true
    if (hit.contains(el)) underAncestor = true
  }
  return underAncestor && looksVisible(el)
}

/** Not faded out or hidden, by its own styles or a parent's. */
function looksVisible(el: Element): boolean {
  // Every browser the extension runs in has it; the test page may not.
  if (!('checkVisibility' in el)) return true
  return el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
}
