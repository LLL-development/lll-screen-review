import {
  findElement,
  isOurUi,
  isRendered,
  isShown,
  mountUi,
  removeUi,
  setHostState,
} from './ui'
import { selectorFor } from './selector'
import {
  mountHighlight,
  showHighlight,
  hideHighlight,
  highlightedElement,
  showCandidate,
  foundTargets,
  flashHighlight,
  type HighlightTarget,
} from './highlight'
import { describeWayIn, doorOf, mountReveal, notePress, reveal, wayInFor } from './reveal'
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
import { describeElement, formatName } from './describe'
import { createClarifySection } from './clarify-ui'
import { mountPanel, setPanelVisible, hasComments } from './panel'
import { mountPins } from './pins'
import { dockPiece, mountDock, seeThrough } from './dock'
import { buildTargets, createPicker } from './targets'
import { applySavedSize, placeReader } from './reader'
import { buildCommentEditor, buildEditedNote, type CommentEditor } from './edit'
import { escapeTicketReview, openTicketReview } from './tickets'
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
  /** Handles Esc itself, short of closing, when it returns true. */
  escape?: () => boolean
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

const toggle = buildToggle()

/** Mounts the tool onto the current page. Call once, on page load. */
export function startReviewTool(options: ReviewToolOptions = {}): void {
  running = true
  pageUrl = options.pageUrl ?? location.href
  if (options.goToPage) goToPage = options.goToPage
  loadComments(pageUrl)

  mountUi(toggle)
  mountHighlight()
  mountPanel(goToComment, openTickets, showComment)
  mountPins(showComment)
  mountDock()
  mountReveal()
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
  window.addEventListener('keyup', onKeyUp, true)
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
  window.removeEventListener('keyup', onKeyUp, true)
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
  const target = event.target
  if (!(target instanceof Element)) return

  // Moving with Shift held, while a comment takes elements, is reaching for
  // one: the box, the panel and the pill let clicks through to whatever
  // they're over. Not on Shift alone, or typing a capital would flicker.
  setPicking(event.shiftKey && Boolean(popup?.group))

  // Out of review mode the page is the reviewer's to use. With a comment
  // taking elements, what a Shift+click would do shows while Shift is held.
  if (!reviewMode) {
    if (popup?.group) pointAt(event.shiftKey && !isOurUi(target) ? target : null)
    return
  }

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

let picking = false

/** See onMouseMove; the look is in review.css. */
function setPicking(on: boolean): void {
  if (on === picking) return
  picking = on
  setHostState('picking', on ? '' : null)
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key === 'Shift') setPicking(false)
}

/** Shows what a Shift+click on el would do to the comment being written. */
function pointAt(el: Element | null): void {
  const hint = el && popup?.group?.hint(el)
  showCandidate(el && hint ? { el, text: hint } : null)
}

// --- clicking ---------------------------------------------------------------

/**
 * The page element a review-mode click or press landed on, or null when it
 * is none of our business. Out of review mode only Shift+clicks are, and
 * only while a comment being written or edited is taking elements.
 */
function reviewTarget(event: MouseEvent): Element | null {
  if (!reviewMode && !(event.shiftKey && popup?.group)) return null

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
  else if (event.type === 'pointerdown') remember(event)
}

/**
 * Notes a press of the reviewer's own on the page, out of review mode. What
 * opens a popup is worth knowing, should a comment be left inside it; see
 * reveal.ts.
 */
function remember(event: MouseEvent): void {
  const target = event.target
  if (!reviewMode && event.isTrusted && target instanceof Element && !isOurUi(target)) {
    notePress(target, pageUrl)
  }
}

function onClick(event: MouseEvent): void {
  const target = reviewTarget(event)

  // Shift+click adds to the comment being written or edited, or takes back
  // off it, review mode or not.
  if (target && event.shiftKey && popup?.group) {
    swallow(event)
    popup.group.toggle(target)
    pointAt(target)
    return
  }

  if (!reviewMode) {
    // Enter on a focused button clicks it without any press first.
    remember(event)
    // A comment being read closes when you click anywhere else on the page,
    // and the click carries on as normal. One being edited stays open: the
    // page may need opening up to reach what's to be added to it.
    const clicked = event.target
    if (popup && !popup.group && event.isTrusted && clicked instanceof Element && !isOurUi(clicked)) {
      closePopup()
    }
    return
  }

  if (!target) return
  swallow(event)

  // A stray click shouldn't cost a half-written comment, or one open for
  // editing: a click meant as a Shift+click shouldn't close the editor.
  if (popup?.hasDraft() || (popup?.group && popup.commentId !== null)) {
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

  if (escapeTicketReview()) {
    // The ticket review is on top of everything else, so it goes first.
  } else if (popup?.escape?.()) {
    // Handled; see the popup's escape.
  } else if (popup) closePopup()
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
  // And what opens the popup it's in, if it is in one, while it's open.
  const openWith = wayInFor(el, page)

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

  const ask = () => {
    const count = picker.picked().length
    textarea.placeholder =
      count > 1 ? `What should change about these ${count}?` : 'What should change about this?'
  }
  /**
   * What the comment is about. The element clicked stays first: the comment
   * hangs on it, and its context is the one saved. Shift+click adds more.
   */
  const picker = createPicker([{ el, selector, name: context.name }], {
    keepFirst: true,
    onChange: () => {
      ask()
      textarea.focus()
    },
  })
  targets.append(picker.element)
  ask()

  // The clarify step hides itself when no model is configured, so the popup
  // looks and behaves exactly as before when the AI is not set up.
  const clarify = createClarifySection({
    selector,
    context,
    getComment: () => textarea.value.trim(),
    getOthers: () =>
      picker
        .picked()
        .slice(1)
        .map((s) => formatName(s.name)),
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

    const picked = picker.picked()
    const others = picked.slice(1).map(({ selector, name }) => ({ selector, name }))
    const clarified = clarify.getClarified()

    // A picture of the page without the element in it says little. Scrolled
    // straight there: a smooth scroll would still be moving when it's taken.
    const first = picked[0].el
    if (canTakeScreenshots() && first?.isConnected && !isInView(first)) {
      first.scrollIntoView({ block: 'center', behavior: 'instant' })
    }

    // Taken before saving, while the page still shows what the comment is
    // about. The comment is saved with or without one.
    const shot = await takeScreenshot(picked.flatMap((s) => (s.el ? [s.el] : [])))
    const entry = capture({ selector, comment: text, context, clarified, url: page, others, openWith })
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
      Boolean(textarea.value.trim() || clarify.getClarified() || picker.picked().length > 1),
    stopPlacing: keepNear(box, clickX, clickY),
    group: { toggle: picker.toggle, hint: picker.hint },
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
  setPicking(false)
}

/**
 * Opens a saved comment for reading; see showComment, which is how a click
 * on its pin or its panel row gets here.
 *
 * This works whether or not review mode is on: pins stay on the page, so
 * reading back what was said should not require arming the tool first.
 * revealFailed says its way in was just pressed and didn't bring the
 * element back.
 */
function openCommentReader(
  comment: ReviewComment,
  { revealFailed = false }: { revealFailed?: boolean } = {},
): void {
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
    <div class="sr-reader-body">
      <p class="sr-popup-text"></p>
    </div>
    <div class="sr-popup-actions">
      <div class="sr-reader-nav">
        <button type="button" class="sr-reader-step" data-step="-1" title="Previous comment (←)" aria-label="Previous comment">‹</button>
        <span class="sr-reader-position"></span>
        <button type="button" class="sr-reader-step" data-step="1" title="Next comment (→)" aria-label="Next comment">›</button>
      </div>
      <button type="button" class="sr-reader-edit" title="Reword it, or change what it's about, keeping its number">Edit</button>
      <button type="button" class="sr-reader-expand"></button>
      <button type="button" class="sr-cancel">Close</button>
    </div>
  `

  // Everything below is page data or user text, so it goes in as text.
  const number = box.querySelector('.sr-popup-number') as HTMLElement
  number.textContent = String(comment.id)
  const about = buildTargets(commentTargets(comment))
  number.after(about)

  const body = box.querySelector('.sr-reader-body') as HTMLElement
  const text = box.querySelector('.sr-popup-text') as HTMLElement
  text.textContent = comment.comment

  // The clarified wording is the actionable version, so it is worth showing
  // right under the note it came from.
  if (comment.clarified) {
    const clarified = document.createElement('p')
    clarified.className = 'sr-popup-clarified'
    clarified.textContent = comment.clarified
    body.append(clarified)
  }

  if (comment.acceptance) {
    const acceptance = document.createElement('p')
    acceptance.className = 'sr-reader-acceptance'
    const label = document.createElement('strong')
    label.textContent = 'Done when: '
    acceptance.append(label, comment.acceptance)
    body.append(acceptance)
  }

  // How to get there next time, for a developer opening it on their own.
  if (comment.openWith) {
    const way = document.createElement('p')
    way.className = 'sr-reader-way'
    way.textContent = `To see it, click ${describeWayIn(comment.openWith)}.`
    body.append(way)
  }

  const edited = buildEditedNote(comment)
  if (edited) body.append(edited)

  // Nothing outlined: say where the element has got to, before anything else.
  if (seen.length === 0) body.prepend(buildWhereNote(comment, found, revealFailed))

  const actions = box.querySelector('.sr-popup-actions') as HTMLElement
  if (comment.screenshot) {
    box.insertBefore(buildScreenshot(comment.screenshot, comment.id), actions)
  }

  const closeButton = box.querySelector('.sr-cancel') as HTMLButtonElement
  closeButton.addEventListener('click', closePopup)

  // Editing swaps the words and the buttons for a form, in the same reader:
  // the screenshot stays in view, and the elements are outlined and listed in
  // the form, where Shift+clicking the page adds to them or takes them off.
  let editor: CommentEditor | null = null
  const stopEditing = () => {
    editor?.el.remove()
    editor = null
    body.hidden = actions.hidden = about.hidden = false
    if (popup?.el === box) popup.group = undefined
    // Back to outlining what it's about as saved.
    pointAt(null)
    showHighlight(foundTargets(comment).filter((t) => isShown(t.el)))
  }
  const startEditing = () => {
    if (editor) return
    editor = buildCommentEditor(
      comment,
      {
        onSaved: ({ elementsChanged }) => {
          stopEditing()
          const saved = getComments().find((c) => c.id === comment.id)
          if (!saved) return
          openCommentReader(saved)
          if (elementsChanged) void retakeScreenshot(saved.id)
        },
        onCancel: stopEditing,
      },
      { pickElements: true },
    )
    body.hidden = actions.hidden = about.hidden = true
    body.after(editor.el)
    if (popup?.el === box) popup.group = editor.group
    editor.focus()
  }
  ;(box.querySelector('.sr-reader-edit') as HTMLButtonElement).addEventListener(
    'click',
    startEditing,
  )

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
    hasDraft: () => editor?.hasChanges() ?? false,
    stopPlacing: () => {
      stopPlacing()
      stopWatching()
    },
    // Esc while editing goes back to reading, not out of the reader.
    escape: () => {
      if (!editor) return false
      stopEditing()
      return true
    },
  }
}

/**
 * Said at the top of a comment whose element can't be seen, so the reader
 * isn't left wondering what it's about: where the element has got to, and
 * how to bring it back.
 */
function buildWhereNote(
  comment: ReviewComment,
  found: readonly HighlightTarget[],
  revealFailed: boolean,
): HTMLElement {
  const note = document.createElement('div')
  note.className = 'sr-reader-where'
  const text = document.createElement('p')
  note.append(text)

  const door = doorOf(comment)
  // What opens it is there, but something is open on top of that too.
  const coveredDoor = door
    ? null
    : comment.openWith?.find((step) => {
        const el = findElement(step.selector)
        return el !== null && isRendered(el)
      })
  if (coveredDoor) {
    text.textContent = `It’s inside something closed, and what opens it, ${formatName(coveredDoor.name)}, is covered by something open on the page. Close that, then come back to this comment.`
  } else if (door && comment.openWith) {
    const way = describeWayIn(comment.openWith.slice(door.index))
    text.textContent = revealFailed
      ? `Clicking ${way} didn’t bring it back. Open it on the page and its pin comes back.`
      : 'It’s inside something closed right now.'
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'sr-reader-open'
    open.textContent = revealFailed ? 'Try again' : 'Open it'
    open.title = `Clicks ${way} for you`
    open.addEventListener('click', () => void showComment(comment))
    note.append(open)
  } else if (found.some((t) => isRendered(t.el))) {
    text.textContent =
      'Something open on the page is covering it right now, like a popup. Close that and its pin comes back.'
  } else if (found.length > 0) {
    text.textContent =
      'It’s inside something closed right now, like a popup or a menu. Open that on the page and its pin comes back.'
  } else {
    text.textContent =
      'Its element isn’t on the page any more. Press Edit, then Shift+click the right one to point the comment at it.'
  }
  return note
}

/** This page's comments, in the order of their numbers. */
function commentsInOrder(): ReviewComment[] {
  return getComments()
    .filter(isOnThisPage)
    .sort((a, b) => a.id - b.id)
}

/**
 * Moves the open reader on to the next comment on the page (1) or back to
 * the previous one (-1); see showComment.
 */
function stepReader(direction: number): void {
  const id = popup?.commentId
  if (id == null) return
  const onPage = commentsInOrder()
  const next = onPage[onPage.findIndex((c) => c.id === id) + direction]
  if (next) void showComment(next)
}

/** Bumped by every showComment, so only the latest gets to open its reader. */
let showing = 0

/**
 * Takes the reviewer to a comment: its element scrolled into view, and the
 * comment open beside it. An element inside something closed, a popup or a
 * menu, is brought back first by clicking its way in, as the reviewer did
 * (see reveal.ts); one that isn't there to bring back opens its reader
 * anyway, saying so. Clicking its pin or its panel row, or stepping to it in
 * the reader, all end up here.
 */
async function showComment(comment: ReviewComment): Promise<void> {
  // Not at the cost of a comment still being written.
  if (popup?.hasDraft()) {
    nudgePopup()
    return
  }
  const turn = ++showing

  let el = firstShown(comment) ?? scrolledIntoSight(comment)
  let revealed = false
  let revealFailed = false
  if (!el && comment.openWith && doorOf(comment)) {
    // Out of the way while the page opens up.
    closePopup()
    el = await reveal(comment.openWith, () => firstShown(comment))
    revealed = el !== null
    revealFailed = !revealed
    // Switched off, gone on to another comment or another page, or started
    // writing one, while it opened.
    if (!running || turn !== showing || !isOnThisPage(comment) || popup?.hasDraft()) return
  }

  const moved = el !== null && !isInView(el)
  if (moved) el?.scrollIntoView({ block: 'center', behavior: 'instant' })
  openCommentReader(comment, { revealFailed })
  if (moved || revealed) flashHighlight()
}

/** The first of a comment's elements that can be seen, or null. */
function firstShown(comment: ReviewComment): Element | null {
  return foundTargets(comment).find((t) => isShown(t.el))?.el ?? null
}

/**
 * The first of a comment's elements that shows once scrolled to: one in a
 * long menu or a table that scrolls by itself, cut off where its box ends.
 */
function scrolledIntoSight(comment: ReviewComment): Element | null {
  const drawn = foundTargets(comment).find((t) => isRendered(t.el))
  if (!drawn) return null
  drawn.el.scrollIntoView({ block: 'center', behavior: 'instant' })
  return isShown(drawn.el) ? drawn.el : null
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
    // Not while it's being edited: the reviewer may well be opening up
    // another part of the page, to pick something from it.
    if (popup?.commentId === comment.id && !popup.group && !seen()) closePopup()
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

/** Opens the ticket review from the panel, in place of any reader. */
function openTickets(): void {
  // Not at the cost of a comment still being written.
  if (popup?.hasDraft()) {
    nudgePopup()
    return
  }
  closePopup()
  openTicketReview()
}

/**
 * Opens the comment goToComment came here for, once its element is on the
 * page, or the first step of its way in is (see showComment). Plenty of
 * pages build themselves after loading, so they get a few seconds to turn
 * up; if they never do, the comment opens anyway, with nothing to point at.
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

    const ready =
      firstShown(comment) ?? (comment.openWith ? doorOf(comment) : findElement(comment.selector))
    if (!ready && performance.now() - started < ARRIVAL_WAIT_MS) {
      setTimeout(attempt, 250)
      return
    }
    void showComment(comment)
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
function capture(input: {
  selector: string
  comment: string
  context: ElementContext
  clarified: string
  url: string
  others: CommentTarget[]
  openWith: CommentTarget[]
}): ReviewComment {
  const { others, clarified, openWith } = input
  const entry = addComment({
    selector: input.selector,
    comment: input.comment,
    url: input.url,
    context: input.context,
    // Only present for a comment on more than one element.
    ...(others.length > 0 ? { others } : {}),
    // Only present for elements inside something that opens.
    ...(openWith.length > 0 ? { openWith } : {}),
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
  if (entry.openWith) console.log('opens by:', describeWayIn(entry.openWith))
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

/**
 * A new picture for a comment whose elements were just changed, marking
 * the ones it's about now. Only taken with them on screen; otherwise the
 * old one stays. A reader left open on the comment shows the new one.
 */
async function retakeScreenshot(id: number): Promise<void> {
  const comment = getComments().find((c) => c.id === id)
  if (!comment || !canTakeScreenshots()) return
  const shown = foundTargets(comment)
    .filter((t) => isShown(t.el))
    .map((t) => t.el)
  if (shown.length === 0) return
  if (!isInView(shown[0])) shown[0].scrollIntoView({ block: 'center', behavior: 'instant' })

  const shot = await takeScreenshot(shown)
  const current = getComments().find((c) => c.id === id)
  if (!shot || !current) return
  const old = current.screenshot
  await attachScreenshot(current, shot)

  const updated = getComments().find((c) => c.id === id)
  if (old && updated?.screenshot !== old) deleteScreenshot(old)
  if (updated && popup?.commentId === id && !popup.group) openCommentReader(updated)
}

// --- helpers ----------------------------------------------------------------

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
