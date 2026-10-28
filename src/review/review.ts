import { finder } from '@medv/finder'
import { findElement, isOurUi, isShown, mountUi, removeUi } from './ui'
import {
  mountHighlight,
  showHighlight,
  hideHighlight,
  highlightedElement,
  showCandidate,
  foundTargets,
} from './highlight'
import {
  addComment,
  commentTargets,
  getComments,
  isOnThisPage,
  loadComments,
  onChange,
  pageKey,
  setPage,
  setScreenshot,
  unloadComments,
  type CommentTarget,
  type ReviewComment,
} from './store'
import { captureContext, type ElementContext } from './context'
import { buildName, describeElement, formatName } from './describe'
import { createClarifySection } from './clarify-ui'
import { mountPanel, setPanelVisible, hasComments } from './panel'
import { mountPins } from './pins'
import { dockPiece, mountDock, seeThrough } from './dock'
import { findSimilar } from './similar'
import { applySavedSize, placeReader } from './reader'
import {
  buildScreenshot,
  canTakeScreenshots,
  deleteScreenshot,
  keepScreenshot,
  takeScreenshot,
  type Screenshot,
} from './screenshots'
import './page.css'

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

let reviewMode = false

/** Whether the comment reader is in its bigger view; kept until changed. */
let readerExpanded = false

/** The open comment box or comment reader, or null when neither is open. */
let popup: {
  el: HTMLElement
  /** The comment a reader is showing; null for a new comment. */
  commentId: number | null
  /** True when closing it would throw away something the reviewer wrote. */
  hasDraft: () => boolean
  /** Stops keeping the box on screen. */
  stopPlacing: () => void
  /**
   * For a comment being written, which can be about several elements:
   * Shift+click adds one to it, or takes it off again. hint says what a
   * Shift+click on el would do, or null when it would do nothing.
   */
  group?: {
    toggle: (el: Element) => void
    hint: (el: Element) => string | null
  }
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

/**
 * Whether comment boxes show the CSS selector under the element's name.
 * Remembered per tab, so a developer who wants it opens it once.
 */
const SELECTOR_KEY = 'screen-review:show-selector'
let showSelector = readSession(SELECTOR_KEY) === 'on'

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
  mountDock()
  dockPiece(toggle, () => true)

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
    seeThrough(null)
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
  if (!reviewMode) return

  const target = event.target
  if (!(target instanceof Element)) return

  // While a comment box is open the highlight stays put on its elements, so
  // the outline keeps showing what the comment is about. The element under
  // the cursor gets a dashed box beside them, saying Shift+click adds it.
  if (popup) {
    pointAt(isOurUi(target) ? null : target)
    return
  }

  // Over our own toolbar or panel: leave the highlight alone. The panel points
  // it at the element belonging to whichever row you are hovering. Reaching
  // for them makes them solid again, if they had gone see-through.
  if (isOurUi(target)) {
    seeThrough(null)
    return
  }

  // Naming reads the page's text and layout, so only when the element changes.
  if (target !== highlightedElement()) {
    showHighlight([{ el: target, text: formatName(describeElement(target)) }])
    // The pill and panel fade when they hide part of what's pointed at.
    seeThrough(target)
  }
}

/** Shows what a Shift+click on el would do to the comment being written. */
function pointAt(el: Element | null): void {
  const hint = el && popup?.group?.hint(el)
  showCandidate(el && hint ? { el, text: hint } : null)
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

  // Shift+click adds to the comment being written, or takes back off it.
  if (event.shiftKey && popup?.group) {
    popup.group.toggle(target)
    pointAt(target)
    return
  }

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
  if (event.isComposing) return

  // ← and → step through comments while one is being read. Not with a
  // modifier: Alt+← is the browser's Back.
  const arrow = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  if (arrow && popup?.commentId != null && !hasModifier(event) && !isTyping(event)) {
    stepReader(arrow)
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }

  if (event.key !== 'Escape') return

  if (popup) closePopup()
  else if (reviewMode) setReviewMode(false)
  else return

  // Ours: the page shouldn't also close its own menu or dialog on it.
  event.stopImmediatePropagation()
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
}

/** Keys typed into a text box, ours or the page's, are text. */
function isTyping(event: KeyboardEvent): boolean {
  // The real target: from inside the tool, event.target is just its host.
  const target = event.composedPath()[0]
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
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

  /**
   * What the comment is about. The element clicked stays first: the comment
   * hangs on it, and its context is the one saved. Shift+click adds more.
   */
  const selected: (CommentTarget & { el: Element })[] = [
    { el, selector, name: context.name },
  ]
  // Looked for now, while the page is as the reviewer saw it when clicking.
  const similar = findSimilar(el)

  const box = document.createElement('div')
  box.className = 'sr-popup'
  box.innerHTML = `
    <div class="sr-popup-targets"></div>
    <textarea></textarea>
    <div class="sr-popup-actions">
      <button type="button" class="sr-cancel">Cancel</button>
      <button type="button" class="sr-save">Save comment</button>
    </div>
    <div class="sr-popup-hint">Shift+click to add more &middot; Ctrl/Cmd + Enter to save &middot; Esc to cancel</div>
  `

  const targets = box.querySelector('.sr-popup-targets') as HTMLElement
  const textarea = box.querySelector('textarea') as HTMLTextAreaElement
  const saveButton = box.querySelector('.sr-save') as HTMLButtonElement
  const cancelButton = box.querySelector('.sr-cancel') as HTMLButtonElement
  const actions = box.querySelector('.sr-popup-actions') as HTMLElement

  const add = (other: Element) => {
    selected.push({ el: other, selector: selectorFor(other), name: describeElement(other) })
    // The rest in page order, however they were picked, so the list reads
    // top to bottom.
    const [first, ...rest] = selected
    rest.sort((a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    selected.splice(0, selected.length, first, ...rest)
  }
  const remove = (index: number) => {
    selected.splice(index, 1)
    showSelected()
    textarea.focus()
  }

  /** Lists the elements in the box, and outlines them on the page. */
  const showSelected = () => {
    targets.replaceChildren(buildTarget(selected, remove))

    // The rest of the cards in the grid, say: one click takes them all in.
    const unpicked = similar.filter(
      (other) => other.isConnected && !selected.some((s) => s.el === other),
    )
    if (unpicked.length > 0) {
      const takeAll = document.createElement('button')
      takeAll.type = 'button'
      takeAll.className = 'sr-similar'
      takeAll.textContent = `+ Add ${unpicked.length} more like ${selected.length > 1 ? 'these' : 'this'}`
      takeAll.addEventListener('click', () => {
        for (const other of unpicked) add(other)
        showSelected()
        textarea.focus()
      })
      targets.append(takeAll)
    }

    textarea.placeholder =
      selected.length > 1
        ? `What should change about these ${selected.length}?`
        : 'What should change about this?'
    showHighlight(selected.map((s) => ({ el: s.el, text: formatName(s.name) })))
  }
  showSelected()

  // The clarify step hides itself when no model is configured, so the popup
  // looks and behaves exactly as before when the AI is not set up.
  const clarify = createClarifySection({
    selector,
    context,
    getComment: () => textarea.value.trim(),
    getOthers: () => selected.slice(1).map((s) => formatName(s.name)),
  })
  actions.insertBefore(clarify.button, saveButton)
  box.insertBefore(clarify.element, actions)

  let saving = false
  const submit = async () => {
    const text = textarea.value.trim()
    if (!text) {
      textarea.focus()
      return
    }
    // Pressed again while the screenshot is being taken: one comment, not two.
    if (saving) return
    saving = true
    saveButton.disabled = true

    const others = selected.slice(1).map(({ selector, name }) => ({ selector, name }))
    const clarified = clarify.getClarified()

    // A picture of the page without the element in it says little. Scrolled
    // straight there: a smooth scroll would still be moving when it's taken.
    const first = selected[0].el
    if (canTakeScreenshots() && first.isConnected && !isInView(first)) {
      first.scrollIntoView({ block: 'center', behavior: 'instant' })
    }

    // Taken before saving, while the page still shows what the comment is
    // about. The comment is saved with or without one.
    const shot = await takeScreenshot(selected.map((s) => s.el))
    const entry = capture(selector, text, context, clarified, page, others)
    // Esc can close the box while the picture is being taken.
    if (popup?.el === box) closePopup()
    // Marked up with the number the comment has just been given.
    if (shot) void attachScreenshot(entry, shot)
  }

  saveButton.addEventListener('click', () => void submit())
  cancelButton.addEventListener('click', closePopup)
  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
  })

  mountUi(box)
  popup = {
    el: box,
    commentId: null,
    // Picking out several elements is work worth keeping too.
    hasDraft: () =>
      Boolean(textarea.value.trim() || clarify.getClarified() || selected.length > 1),
    stopPlacing: keepNear(box, clickX, clickY),
    group: {
      toggle: (other) => {
        const index = selected.findIndex((s) => s.el === other)
        // The first is what the comment hangs on; it stays.
        if (index === 0) return
        if (index > 0) selected.splice(index, 1)
        else add(other)
        showSelected()
      },
      hint: (other) => {
        const index = selected.findIndex((s) => s.el === other)
        if (index === 0) return null
        return index > 0 ? 'Shift+click to take this off' : 'Shift+click to add this'
      },
    },
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
  if (hint) hint.textContent = 'Save or cancel this comment first, or Shift+click to add to it.'

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

  const found = foundTargets(comment)
  // Outlining an element in a closed popup would draw a box round nothing.
  const seen = found.filter((t) => isShown(t.el))
  showHighlight(seen)

  const box = document.createElement('div')
  box.className = 'sr-popup sr-popup-read'
  box.innerHTML = `
    <div class="sr-popup-head">
      <span class="sr-popup-number"></span>
    </div>
    <p class="sr-popup-text"></p>
    <div class="sr-popup-actions">
      <div class="sr-reader-nav">
        <button type="button" class="sr-reader-step" data-step="-1" title="Previous comment (←)" aria-label="Previous comment">‹</button>
        <span class="sr-reader-position"></span>
        <button type="button" class="sr-reader-step" data-step="1" title="Next comment (→)" aria-label="Next comment">›</button>
      </div>
      <button type="button" class="sr-reader-expand"></button>
      <button type="button" class="sr-cancel">Close</button>
    </div>
  `

  // Everything below is page data or user text, so it goes in as text.
  const number = box.querySelector('.sr-popup-number') as HTMLElement
  number.textContent = String(comment.id)
  number.after(buildTarget(commentTargets(comment)))

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

  const actions = box.querySelector('.sr-popup-actions') as HTMLElement
  if (comment.screenshot) {
    box.insertBefore(buildScreenshot(comment.screenshot, comment.id), actions)
  }

  const closeButton = box.querySelector('.sr-cancel') as HTMLButtonElement
  closeButton.addEventListener('click', closePopup)

  // Working through a review means reading one comment after another, so
  // the reader steps through this page's comments in number order.
  const onPage = commentsInOrder()
  const at = onPage.findIndex((c) => c.id === comment.id)
  const nav = box.querySelector('.sr-reader-nav') as HTMLElement
  nav.hidden = onPage.length < 2 || at === -1
  ;(box.querySelector('.sr-reader-position') as HTMLElement).textContent =
    `${at + 1} of ${onPage.length}`
  for (const step of box.querySelectorAll<HTMLButtonElement>('.sr-reader-step')) {
    const direction = Number(step.dataset.step)
    step.disabled = !onPage[at + direction]
    step.addEventListener('click', () => stepReader(direction))
  }

  // Expanded stays expanded from one comment to the next.
  const expand = box.querySelector('.sr-reader-expand') as HTMLButtonElement
  const syncExpanded = () => {
    box.classList.toggle('sr-popup-expanded', readerExpanded)
    expand.textContent = readerExpanded ? 'Shrink' : 'Expand'
    expand.title = readerExpanded ? 'Back to the small reader' : 'Read it in a bigger view'
  }
  syncExpanded()
  expand.addEventListener('click', () => {
    readerExpanded = !readerExpanded
    syncExpanded()
  })

  applySavedSize(box)
  mountUi(box)

  // Beside the element the comment is about, or in the middle of the screen
  // when that element is gone or can't be seen.
  const stopPlacing = placeReader(box, seen[0]?.el.getBoundingClientRect() ?? null)
  const stopWatching = closeWhenUnseen(comment)
  popup = {
    el: box,
    commentId: comment.id,
    hasDraft: () => false,
    stopPlacing: () => {
      stopPlacing()
      stopWatching()
    },
  }
}

/** This page's comments, in the order of their numbers. */
function commentsInOrder(): ReviewComment[] {
  return getComments()
    .filter(isOnThisPage)
    .sort((a, b) => a.id - b.id)
}

/**
 * Moves the open reader on to the next comment on the page (1) or back to
 * the previous one (-1), scrolling its element into view first.
 */
function stepReader(direction: number): void {
  const id = popup?.commentId
  if (id == null) return
  const onPage = commentsInOrder()
  const next = onPage[onPage.findIndex((c) => c.id === id) + direction]
  if (!next) return
  foundTargets(next)
    .find((t) => isShown(t.el))
    ?.el.scrollIntoView({ block: 'center' })
  openCommentReader(next)
}

/**
 * Closes a comment's reader once its elements go out of sight: the site's
 * popup they were in has been closed, say. Left open, the reader would be
 * talking about something no longer there. A reader opened on an element
 * that was never in sight stays open, since that is what was asked for.
 */
function closeWhenUnseen(comment: ReviewComment): () => void {
  const seen = () => foundTargets(comment).some((t) => isShown(t.el))
  if (!seen()) return () => {}
  const timer = setInterval(() => {
    if (popup?.commentId === comment.id && !seen()) closePopup()
  }, 500)
  return () => clearInterval(timer)
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
  others: CommentTarget[],
): ReviewComment {
  const entry = addComment({
    selector,
    comment,
    url,
    context,
    // Only present for a comment on more than one element.
    ...(others.length > 0 ? { others } : {}),
    // Only present when the reviewer went through the clarify step and kept
    // the wording.
    ...(clarified ? { clarified } : {}),
  })

  console.group(
    '%c[Screen Review] comment captured',
    'color:#2f5bd7;font-weight:600',
  )
  console.log('name    :', formatName(entry.context.name))
  console.log('selector:', entry.selector)
  if (entry.others) {
    console.log('also on :', entry.others.map((o) => formatName(o.name)).join(' · '))
  }
  console.log('comment :', entry.comment)
  console.log('element :', `<${entry.context.tagName}> ${entry.context.text}`)
  console.log('nearby  :', entry.context.nearbyText)
  if (entry.clarified) console.log('clarified:', entry.clarified)
  console.log('url     :', entry.url)
  console.log('object  :', entry)
  console.groupEnd()
  return entry
}

/**
 * Marks up a comment's picture with its number and words, keeps it, and
 * attaches it to the comment; see screenshots.ts.
 */
async function attachScreenshot(entry: ReviewComment, shot: Screenshot): Promise<void> {
  const [first, ...rest] = commentTargets(entry)
  const id = await keepScreenshot(shot, {
    number: entry.id,
    comment: entry.comment,
    about: formatName(first.name) + (rest.length > 0 ? ` + ${rest.length} more` : ''),
    url: entry.url,
    when: entry.createdAt,
  })
  if (!id) return

  if (setScreenshot(entry.id, id)) {
    console.log(`[Screen Review] screenshot kept for comment ${entry.id}, id ${id}`)
  } else {
    // Deleted while its picture was being marked up.
    deleteScreenshot(id)
  }
}

// --- helpers ----------------------------------------------------------------

/**
 * What a comment is about, as a person would say it, with the CSS selector
 * one click away for anyone who wants it. Several elements are counted and
 * listed; give onRemove and each but the first can be taken off.
 */
function buildTarget(
  targets: readonly CommentTarget[],
  onRemove?: (index: number) => void,
): HTMLElement {
  const target = document.createElement('div')
  target.className = 'sr-target'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'sr-target-toggle'
  toggle.textContent = '</>'

  // textContent, not innerHTML: a selector can contain characters that came
  // from the page's own markup, and we never want to run those as HTML.
  const code = document.createElement('code')
  code.className = 'sr-target-selector'
  code.textContent = targets.map((t) => t.selector).join('\n')

  const show = (open: boolean) => {
    code.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.title = open ? 'Hide the CSS selector' : 'Show the CSS selector'
    toggle.setAttribute('aria-label', toggle.title)
  }
  show(showSelector)

  toggle.addEventListener('click', () => {
    showSelector = !showSelector
    writeSession(SELECTOR_KEY, showSelector ? 'on' : 'off')
    show(showSelector)
  })

  if (targets.length === 1) {
    target.append(buildName(targets[0].name), toggle, code)
    return target
  }

  const count = document.createElement('span')
  count.className = 'sr-target-count'
  count.textContent = `${targets.length} elements`

  const list = document.createElement('ul')
  list.className = 'sr-target-list'
  targets.forEach(({ name }, index) => {
    const item = document.createElement('li')
    item.append(buildName(name))

    if (onRemove && index > 0) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'sr-target-remove'
      remove.textContent = '×'
      remove.title = 'Leave this one out'
      remove.setAttribute('aria-label', `Leave out ${formatName(name)}`)
      remove.addEventListener('click', () => onRemove(index))
      item.append(remove)
    }
    list.append(item)
  })

  target.append(count, toggle, list, code)
  return target
}

/** Whether any of the element is inside the window. */
function isInView(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  )
}

/**
 * A unique CSS selector for the element, e.g. `#page-title` or
 * `.card:nth-of-type(2) > .stat`.
 *
 * On a big page finder can spend up to a second looking for a short one.
 * That's once per click, never while hovering: the label shows the
 * element's name instead.
 */
function selectorFor(el: Element): string {
  try {
    return finder(el, { timeoutMs: 1000 })
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
  const button = document.createElement('button')
  button.className = 'sr-toggle'
  button.type = 'button'
  button.dataset.on = 'false'
  button.title = 'Click to switch review mode on or off. Drag to move it to another corner.'
  button.innerHTML =
    '<span class="sr-toggle-dot"></span><span class="sr-toggle-text">Review mode: off</span>'
  button.addEventListener('click', () => setReviewMode(!reviewMode))
  return button
}
