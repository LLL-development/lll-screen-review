import { finder } from '@medv/finder'
import { attachUi, findElement, isOurUi, markAsUi, mountUi, removeUi } from './ui'
import {
  mountHighlight,
  showHighlight,
  hideHighlight,
  highlightedElement,
} from './highlight'
import {
  addComment,
  getComments,
  isOnThisPage,
  loadComments,
  onChange,
  pageKey,
  setPage,
  unloadComments,
  type ReviewComment,
} from './store'
import { captureContext, type ElementContext } from './context'
import { createClarifySection } from './clarify-ui'
import { mountPanel, setPanelVisible, hasComments } from './panel'
import { mountPins } from './pins'
import './review.css'

/**
 * The review layer.
 *
 * Turn review mode on and the tool intercepts mouse events on the page:
 * hovering outlines the element under the cursor, clicking opens a comment box.
 * Saved comments go into the store, which makes them show up in the panel on
 * the right (and, for now, in the console too).
 */

export type ReviewToolOptions = {
  /**
   * The real address of the page under review, when the address bar says
   * something else. A page loaded through the proxy lives at localhost, but
   * its comments should say which site and page they are about. Leave it out
   * for a page reviewed where it lives.
   */
  pageUrl?: string
  /**
   * Opens another page of the site, to go to a comment left there. Loads the
   * address in this tab unless told otherwise; the proxy loads it through
   * itself instead, or you'd end up on the real site without the tool.
   */
  goToPage?: (url: string) => void
}

/**
 * The half of a click that plenty of controls act on before the click itself
 * arrives: menus that open on pointerdown, a <select> that opens on
 * mousedown, inputs that take focus, text that starts selecting. Review mode
 * swallows these too, or the page would react to a review click.
 */
const PRESS_EVENTS = [
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'dblclick',
  'auxclick',
] as const

/** Hovering asks finder for a quick answer; see selectorFor. */
const HOVER_SELECTOR_MS = 50

let reviewMode = false

/** The open comment box or comment reader, or null when neither is open. */
let popup: {
  el: HTMLElement
  /** The comment a reader is showing; null for a new comment. */
  commentId: number | null
  /** True when closing it would throw away something the reviewer wrote. */
  hasDraft: () => boolean
  /** Stops keeping the box on screen. */
  stopPlacing: () => void
} | null = null

/** The page under review, with any #fragment; see ReviewToolOptions.pageUrl. */
let pageUrl = ''

/** See ReviewToolOptions.goToPage. */
let goToPage = (url: string) => location.assign(url)

/** False once the tool has been taken off the page; see stopReviewTool. */
let running = false

/**
 * Remembered per tab, so review mode stays as it was from one page of the
 * site to the next.
 */
const MODE_KEY = 'screen-review:review-mode'

/**
 * The comment to open once the page it was left on has loaded; see
 * goToComment.
 */
const OPEN_KEY = 'screen-review:open-comment'

/** How long a page just opened gets to show a comment's element. */
const ARRIVAL_WAIT_MS = 5000

const toggle = buildToggle()

/** Mounts the tool onto the current page. Call once, on page load. */
export function startReviewTool(options: ReviewToolOptions = {}): void {
  running = true
  pageUrl = options.pageUrl ?? location.href
  if (options.goToPage) goToPage = options.goToPage
  loadComments(pageUrl)

  mountUi(toggle)
  mountHighlight()
  mountPanel(goToComment)
  mountPins(openCommentReader)

  // Comments restored from a previous visit should be visible straight away,
  // without having to turn review mode on first.
  refreshPanelVisibility()
  onChange(onCommentsChanged)

  // Capture phase on window: these run before any handler the page put on
  // the document or its elements, so we can swallow clicks before a button or
  // link reacts to them.
  window.addEventListener('mousemove', onMouseMove, true)
  window.addEventListener('click', onClick, true)
  for (const type of PRESS_EVENTS) window.addEventListener(type, onPress, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('beforeunload', onBeforeUnload)

  console.log(
    '[Screen Review] ready — hit "Review mode" at the bottom right to start.',
  )

  if (readSession(MODE_KEY) === 'on') setReviewMode(true)
  openRequestedComment()
}

/**
 * The page under review changed without a new one loading, as single-page
 * apps do. The pins and the panel switch to that page's comments.
 */
export function setPageUrl(url: string): void {
  if (!running) return
  const samePage = pageKey(url) === pageKey(pageUrl)
  pageUrl = url
  if (samePage) return

  // A comment being read belongs to the page just left. One being written
  // stays: it already knows which page it is about.
  if (popup && !popup.hasDraft()) closePopup()
  setPage(url)
}

/**
 * Takes the tool off the page: every piece of it, every listener, every
 * timer. The browser extension does this when switched off for a tab; this
 * copy can't be started again afterwards, so the extension puts a fresh one
 * on instead.
 */
export function stopReviewTool(): void {
  if (!running) return
  running = false

  closePopup()
  window.removeEventListener('mousemove', onMouseMove, true)
  window.removeEventListener('click', onClick, true)
  for (const type of PRESS_EVENTS) window.removeEventListener(type, onPress, true)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.documentElement.classList.remove('sr-active')

  removeUi()
  unloadComments()
  console.log('[Screen Review] switched off for this page.')
}

/** Same as pressing the Review mode pill. */
export function setReviewMode(on: boolean): void {
  if (!running) return
  reviewMode = on
  writeSession(MODE_KEY, on ? 'on' : 'off')
  document.documentElement.classList.toggle('sr-active', on)
  toggle.dataset.on = String(on)

  const label = toggle.querySelector('.sr-toggle-text') as HTMLElement
  label.textContent = `Review mode: ${on ? 'on' : 'off'}`

  if (!on) {
    closePopup()
    hideHighlight()
  }

  refreshPanelVisibility()

  console.log(
    on
      ? '[Screen Review] review mode ON — click any element to comment (Esc to exit).'
      : '[Screen Review] review mode off.',
  )
}

/** The panel stays up while reviewing, and afterwards if it has anything in it. */
function refreshPanelVisibility(): void {
  setPanelVisible(reviewMode || hasComments())
}

function onCommentsChanged(): void {
  // Deleting the last comment takes the panel away again; so does a list
  // emptied from another tab.
  refreshPanelVisibility()

  // A comment deleted while it is being read takes its reader with it.
  const reading = popup?.commentId
  if (reading != null && !getComments().some((c) => c.id === reading)) {
    closePopup()
  }
}

// --- hovering ---------------------------------------------------------------

function onMouseMove(event: MouseEvent): void {
  // While a comment box is open the highlight stays put on the clicked
  // element, so the outline keeps showing what the comment is about.
  if (!reviewMode || popup) return

  const target = event.target
  if (!(target instanceof Element)) return

  // Over our own toolbar or panel: leave the highlight alone. The panel points
  // it at the element belonging to whichever row you are hovering.
  if (isOurUi(target)) return

  // finder does real work, so only recompute when the element actually changes.
  if (target !== highlightedElement()) {
    showHighlight(target, selectorFor(target, HOVER_SELECTOR_MS))
  }
}

// --- clicking ---------------------------------------------------------------

/**
 * The page element a review-mode click or press landed on, or null when it
 * is none of our business.
 */
function reviewTarget(event: MouseEvent): Element | null {
  if (!reviewMode) return null

  // Clicks a page's own script makes — a slider advancing itself, say — are
  // the page's business. Opening a comment box for one would also throw away
  // whatever the reviewer was typing.
  if (!event.isTrusted) return null

  const target = event.target
  // Clicks on our own toolbar, panel and comment box behave normally.
  if (!(target instanceof Element) || isOurUi(target)) return null
  return target
}

/**
 * A review click or press, not a real one: don't follow the link, don't
 * submit the form, don't let the page's own handlers see it.
 */
function swallow(event: Event): void {
  event.preventDefault()
  event.stopImmediatePropagation()
}

function onPress(event: MouseEvent): void {
  if (reviewTarget(event)) swallow(event)
}

function onClick(event: MouseEvent): void {
  if (!reviewMode) {
    // A comment being read closes when you click anywhere else on the page,
    // and the click carries on as normal.
    const target = event.target
    if (popup && event.isTrusted && target instanceof Element && !isOurUi(target)) {
      closePopup()
    }
    return
  }

  const target = reviewTarget(event)
  if (!target) return
  swallow(event)

  // A stray click shouldn't cost a half-written comment.
  if (popup?.hasDraft()) {
    nudgePopup()
    return
  }

  // Enter on a focused link or button fires a click too, but one that
  // happened nowhere in particular (0, 0): open by the element instead.
  if (event.detail === 0) {
    const rect = target.getBoundingClientRect()
    openPopup(target, rect.left, rect.bottom)
  } else {
    openPopup(target, event.clientX, event.clientY)
  }
}

function onKeyDown(event: KeyboardEvent): void {
  // With an input method (Japanese, Chinese…), Esc cancels the characters
  // being composed. The comment is not what it means to throw away.
  if (event.key !== 'Escape' || event.isComposing) return

  if (popup) closePopup()
  else if (reviewMode) setReviewMode(false)
  else return

  // Ours: the page shouldn't also close its own menu or dialog on it.
  event.stopImmediatePropagation()
}

// --- the comment box --------------------------------------------------------

function openPopup(el: Element, clickX: number, clickY: number): void {
  closePopup()

  const selector = selectorFor(el)
  // Captured once, when the popup opens: the clarify step and the saved
  // comment then describe the same moment, even if the page changes meanwhile
  // — a single-page app can move on to another page under an open box.
  const context = captureContext(el)
  const page = pageUrl
  showHighlight(el, selector)

  const box = markAsUi(document.createElement('div'))
  box.className = 'sr-popup'
  box.innerHTML = `
    <div class="sr-popup-selector"></div>
    <textarea placeholder="What should change about this?"></textarea>
    <div class="sr-popup-actions">
      <button type="button" class="sr-cancel">Cancel</button>
      <button type="button" class="sr-save">Save comment</button>
    </div>
    <div class="sr-popup-hint">Ctrl/Cmd + Enter to save &middot; Esc to cancel</div>
  `

  // textContent, not innerHTML: a selector can contain characters that came
  // from the page's own markup, and we never want to run those as HTML.
  const selectorEl = box.querySelector('.sr-popup-selector') as HTMLElement
  selectorEl.textContent = selector

  const textarea = box.querySelector('textarea') as HTMLTextAreaElement
  const saveButton = box.querySelector('.sr-save') as HTMLButtonElement
  const cancelButton = box.querySelector('.sr-cancel') as HTMLButtonElement
  const actions = box.querySelector('.sr-popup-actions') as HTMLElement

  // The clarify step hides itself when no model is configured, so the popup
  // looks and behaves exactly as before when the AI is not set up.
  const clarify = createClarifySection({
    selector,
    context,
    getComment: () => textarea.value.trim(),
  })
  actions.insertBefore(clarify.button, saveButton)
  box.insertBefore(clarify.element, actions)

  const submit = () => {
    const text = textarea.value.trim()
    if (!text) {
      textarea.focus()
      return
    }
    capture(selector, text, context, clarify.getClarified(), page)
    closePopup()
  }

  saveButton.addEventListener('click', submit)
  cancelButton.addEventListener('click', closePopup)
  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
  })

  attachUi(box)
  popup = {
    el: box,
    commentId: null,
    hasDraft: () => Boolean(textarea.value.trim() || clarify.getClarified()),
    stopPlacing: keepNear(box, clickX, clickY),
  }
  textarea.focus()
}

/**
 * Keeps the box just below-right of a point, nudged to stay on screen — and
 * keeps it there as it grows (the clarify step adds a question, then a
 * draft) or the window shrinks. Returns a function that stops.
 */
function keepNear(el: HTMLElement, x: number, y: number): () => void {
  const place = () => {
    const gap = 12
    const maxLeft = window.innerWidth - el.offsetWidth - gap
    const maxTop = window.innerHeight - el.offsetHeight - gap
    el.style.left = `${Math.max(gap, Math.min(x + gap, maxLeft))}px`
    el.style.top = `${Math.max(gap, Math.min(y + gap, maxTop))}px`
  }

  place()
  const observer = new ResizeObserver(place)
  observer.observe(el)
  window.addEventListener('resize', place)

  return () => {
    observer.disconnect()
    window.removeEventListener('resize', place)
  }
}

/** Draws the eye back to a box with unsaved text, instead of replacing it. */
function nudgePopup(): void {
  if (!popup) return
  const { el } = popup

  const hint = el.querySelector('.sr-popup-hint')
  if (hint) hint.textContent = 'Save or cancel this comment first.'

  // Removing and re-adding the class restarts the animation; reading
  // offsetWidth in between makes the browser notice it was ever removed.
  el.classList.remove('sr-popup-nudge')
  void el.offsetWidth
  el.classList.add('sr-popup-nudge')

  el.querySelector('textarea')?.focus()
}

function closePopup(): void {
  popup?.stopPlacing()
  popup?.el.remove()
  popup = null
  hideHighlight()
}

/**
 * Opens a saved comment for reading, triggered by clicking its pin.
 *
 * This works whether or not review mode is on: pins stay on the page, so
 * reading back what was said should not require arming the tool first.
 */
function openCommentReader(comment: ReviewComment): void {
  // Not at the cost of a comment still being written.
  if (popup?.hasDraft()) {
    nudgePopup()
    return
  }
  closePopup()

  const el = findElement(comment.selector)
  if (el) showHighlight(el, comment.selector)

  const box = markAsUi(document.createElement('div'))
  box.className = 'sr-popup sr-popup-read'
  box.innerHTML = `
    <div class="sr-popup-head">
      <span class="sr-popup-number"></span>
      <div class="sr-popup-selector"></div>
    </div>
    <p class="sr-popup-text"></p>
    <div class="sr-popup-actions">
      <button type="button" class="sr-cancel">Close</button>
    </div>
  `

  // Everything below is page data or user text, so it goes in as text.
  const number = box.querySelector('.sr-popup-number') as HTMLElement
  number.textContent = String(comment.id)

  const selectorEl = box.querySelector('.sr-popup-selector') as HTMLElement
  selectorEl.textContent = comment.selector

  const text = box.querySelector('.sr-popup-text') as HTMLElement
  text.textContent = comment.comment

  // The clarified wording is the actionable version, so it is worth showing
  // right under the note it came from.
  if (comment.clarified) {
    const clarified = document.createElement('p')
    clarified.className = 'sr-popup-clarified'
    clarified.textContent = comment.clarified
    text.after(clarified)
  }

  const closeButton = box.querySelector('.sr-cancel') as HTMLButtonElement
  closeButton.addEventListener('click', closePopup)

  attachUi(box)

  // Anchor the reader to the element the comment is about, falling back to the
  // middle of the screen when that element is gone.
  const rect = el?.getBoundingClientRect()
  popup = {
    el: box,
    commentId: comment.id,
    hasDraft: () => false,
    stopPlacing: keepNear(
      box,
      rect ? rect.left : window.innerWidth / 2,
      rect ? rect.top : window.innerHeight / 3,
    ),
  }
}

/**
 * Goes to the page a comment was left on, and opens it there; see
 * openRequestedComment. Clicking a comment from another page in the panel
 * does this.
 */
function goToComment(comment: ReviewComment): void {
  // Not at the cost of a comment still being written.
  if (popup?.hasDraft()) {
    nudgePopup()
    return
  }
  writeSession(OPEN_KEY, String(comment.id))
  goToPage(comment.url)
}

/**
 * Opens the comment goToComment came here for, once its element is on the
 * page. Plenty of pages build themselves after loading, so the element gets
 * a few seconds to turn up; if it never does, the comment opens anyway, with
 * nothing to point at.
 */
function openRequestedComment(): void {
  const id = Number(readSession(OPEN_KEY))
  removeSession(OPEN_KEY)
  const comment = getComments().find((c) => c.id === id && isOnThisPage(c))
  if (!comment) return

  const started = performance.now()
  const attempt = () => {
    // Switched off, moved on, or busy with something else in the meantime.
    if (!running || popup || !isOnThisPage(comment)) return

    const el = findElement(comment.selector)
    if (!el && performance.now() - started < ARRIVAL_WAIT_MS) {
      setTimeout(attempt, 250)
      return
    }
    el?.scrollIntoView({ block: 'center' })
    openCommentReader(comment)
  }
  attempt()
}

/**
 * Leaving the page — Back, a script moving it on, closing the tab — would
 * throw away a comment still being written. The browser asks first.
 */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (popup?.hasDraft()) event.preventDefault()
}

/** Records a comment: into the store (so the panel shows it) and the console. */
function capture(
  selector: string,
  comment: string,
  context: ElementContext,
  clarified: string,
  url: string,
): void {
  const entry = addComment({
    selector,
    comment,
    url,
    context,
    // Only present when the reviewer went through the clarify step and kept
    // the wording.
    ...(clarified ? { clarified } : {}),
  })

  console.group(
    '%c[Screen Review] comment captured',
    'color:#2f5bd7;font-weight:600',
  )
  console.log('selector:', entry.selector)
  console.log('comment :', entry.comment)
  console.log('element :', `<${entry.context.tagName}> ${entry.context.text}`)
  console.log('nearby  :', entry.context.nearbyText)
  if (entry.clarified) console.log('clarified:', entry.clarified)
  console.log('url     :', entry.url)
  console.log('object  :', entry)
  console.groupEnd()
}

// --- helpers ----------------------------------------------------------------

/**
 * A unique CSS selector for the element, e.g. `#page-title` or
 * `.card:nth-of-type(2) > .stat`.
 *
 * Hovering asks for a quick answer: it runs for every new element under the
 * mouse, and on a big page finder can spend its full default second on one,
 * freezing the cursor. When it runs out of time it settles for a longer
 * selector, which is fine for a label. The click asks again, with time to
 * find a better one.
 */
function selectorFor(el: Element, timeoutMs = 1000): string {
  try {
    return finder(el, { timeoutMs })
  } catch {
    // finder gives up on odd nodes (svg internals, detached elements, ...).
    return pathTo(el)
  }
}

/**
 * The element's exact position from the top of the document, e.g.
 * `html > body:nth-child(2) > div:nth-child(3)`. Brittle — any change above
 * it breaks it — but it can only ever match this one element. A bare tag name
 * like "div" would pin the comment to the first div on the page instead.
 */
function pathTo(el: Element): string {
  const steps: string[] = []
  for (
    let node: Element | null = el;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    const index = node.parentElement
      ? Array.prototype.indexOf.call(node.parentElement.children, node) + 1
      : 1
    steps.unshift(`${CSS.escape(node.localName)}:nth-child(${index})`)
  }
  return ['html', ...steps].join(' > ')
}

/**
 * sessionStorage belongs to this tab and this site, and survives moving
 * between the site's pages. It can throw (storage blocked, sandboxed
 * frames), in which case these just remember nothing.
 */
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Nothing remembered; see readSession.
  }
}

function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Nothing to forget; see readSession.
  }
}

function buildToggle(): HTMLButtonElement {
  const button = markAsUi(document.createElement('button'))
  button.className = 'sr-toggle'
  button.type = 'button'
  button.dataset.on = 'false'
  button.innerHTML =
    '<span class="sr-toggle-dot"></span><span class="sr-toggle-text">Review mode: off</span>'
  button.addEventListener('click', () => setReviewMode(!reviewMode))
  return button
}
