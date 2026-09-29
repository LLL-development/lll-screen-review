import { finder } from '@medv/finder'
import { findElement, isOurUi, markAsUi } from './ui'
import {
  mountHighlight,
  showHighlight,
  hideHighlight,
  highlightedElement,
} from './highlight'
import { addComment, loadComments, type ReviewComment } from './store'
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
   * its comments should say which site they are about — and each page keeps
   * its own list. Leave it out for a page reviewed where it lives.
   */
  pageUrl?: string
}

let reviewMode = false

/** The open comment box, or null when none is open. */
let popup: HTMLElement | null = null

/** See ReviewToolOptions.pageUrl. */
let pageUrl: string | undefined

const toggle = buildToggle()

/** Mounts the tool onto the current page. Call once, on page load. */
export function startReviewTool(options: ReviewToolOptions = {}): void {
  pageUrl = options.pageUrl
  loadComments(pageUrl)

  document.body.appendChild(toggle)
  mountHighlight()
  mountPanel()
  mountPins(openCommentReader)

  // Comments restored from a previous visit should be visible straight away,
  // without having to turn review mode on first.
  refreshPanelVisibility()

  // Capture phase (the `true` argument) means these run before any handler the
  // page itself registered, so we can swallow clicks before a button or link
  // reacts to them.
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)

  console.log(
    '[Screen Review] ready — hit "Review mode" at the bottom right to start.',
  )
}

function setReviewMode(on: boolean): void {
  reviewMode = on
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

// --- hovering ---------------------------------------------------------------

function onMouseMove(event: MouseEvent): void {
  // While a comment box is open the highlight stays put on the clicked
  // element, so the outline keeps showing what the comment is about.
  if (!reviewMode || popup) return

  const target = event.target as Element | null
  if (!target) return

  // Over our own toolbar or panel: leave the highlight alone. The panel points
  // it at the element belonging to whichever row you are hovering.
  if (isOurUi(target)) return

  // finder does real work, so only recompute when the element actually changes.
  if (target !== highlightedElement()) {
    showHighlight(target, selectorFor(target))
  }
}

// --- clicking ---------------------------------------------------------------

function onClick(event: MouseEvent): void {
  if (!reviewMode) return

  const target = event.target as Element | null
  if (!target) return

  // Clicks on our own toolbar, panel and comment box behave normally.
  if (isOurUi(target)) return

  // Everything else is a review click, not a real one: don't follow the link,
  // don't submit the form, don't let the page's own handlers see it.
  event.preventDefault()
  event.stopPropagation()

  openPopup(target, event.clientX, event.clientY)
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (popup) closePopup()
  else if (reviewMode) setReviewMode(false)
}

// --- the comment box --------------------------------------------------------

function openPopup(el: Element, clickX: number, clickY: number): void {
  closePopup()

  const selector = selectorFor(el)
  // Captured once, when the popup opens: the clarify step and the saved
  // comment then describe the same moment, even if the page changes meanwhile.
  const context = captureContext(el)
  showHighlight(el, selector)

  popup = markAsUi(document.createElement('div'))
  popup.className = 'sr-popup'
  popup.innerHTML = `
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
  const selectorEl = popup.querySelector('.sr-popup-selector') as HTMLElement
  selectorEl.textContent = selector

  const textarea = popup.querySelector('textarea') as HTMLTextAreaElement
  const saveButton = popup.querySelector('.sr-save') as HTMLButtonElement
  const cancelButton = popup.querySelector('.sr-cancel') as HTMLButtonElement
  const actions = popup.querySelector('.sr-popup-actions') as HTMLElement

  // The clarify step hides itself when no model is configured, so the popup
  // looks and behaves exactly as before when the AI is not set up.
  const clarify = createClarifySection({
    selector,
    context,
    getComment: () => textarea.value.trim(),
  })
  actions.insertBefore(clarify.button, saveButton)
  popup.insertBefore(clarify.element, actions)

  const submit = () => {
    const text = textarea.value.trim()
    if (!text) {
      textarea.focus()
      return
    }
    capture(selector, text, context, clarify.getClarified())
    closePopup()
  }

  saveButton.addEventListener('click', submit)
  cancelButton.addEventListener('click', closePopup)
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
  })

  document.body.appendChild(popup)
  placeNearClick(popup, clickX, clickY)
  textarea.focus()
}

/** Puts the box just below-right of the click, nudged to stay on screen. */
function placeNearClick(el: HTMLElement, x: number, y: number): void {
  const gap = 12
  const maxLeft = window.innerWidth - el.offsetWidth - gap
  const maxTop = window.innerHeight - el.offsetHeight - gap
  el.style.left = `${Math.max(gap, Math.min(x + gap, maxLeft))}px`
  el.style.top = `${Math.max(gap, Math.min(y + gap, maxTop))}px`
}

function closePopup(): void {
  popup?.remove()
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
  closePopup()

  const el = findElement(comment.selector)
  if (el) showHighlight(el, comment.selector)

  popup = markAsUi(document.createElement('div'))
  popup.className = 'sr-popup sr-popup-read'
  popup.innerHTML = `
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
  const number = popup.querySelector('.sr-popup-number') as HTMLElement
  number.textContent = String(comment.id)

  const selectorEl = popup.querySelector('.sr-popup-selector') as HTMLElement
  selectorEl.textContent = comment.selector

  const text = popup.querySelector('.sr-popup-text') as HTMLElement
  text.textContent = comment.comment

  // The clarified wording is the actionable version, so it is worth showing
  // right under the note it came from.
  if (comment.clarified) {
    const clarified = document.createElement('p')
    clarified.className = 'sr-popup-clarified'
    clarified.textContent = comment.clarified
    text.after(clarified)
  }

  const closeButton = popup.querySelector('.sr-cancel') as HTMLButtonElement
  closeButton.addEventListener('click', closePopup)

  document.body.appendChild(popup)

  // Anchor the reader to the element the comment is about, falling back to the
  // middle of the screen when that element is gone.
  const rect = el?.getBoundingClientRect()
  placeNearClick(
    popup,
    rect ? rect.left : window.innerWidth / 2,
    rect ? rect.top : window.innerHeight / 3,
  )
}

/** Records a comment: into the store (so the panel shows it) and the console. */
function capture(
  selector: string,
  comment: string,
  context: ElementContext,
  clarified: string,
): void {
  const entry = addComment({
    selector,
    comment,
    url: pageUrl ?? window.location.href,
    context,
    // Only present when the reviewer went through the clarify step and kept
    // the wording.
    ...(clarified ? { clarified } : {}),
  })
  refreshPanelVisibility()

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

/** A unique CSS selector for the element, e.g. `#page-title` or `.card:nth-of-type(2) > .stat`. */
function selectorFor(el: Element): string {
  try {
    return finder(el)
  } catch {
    // finder gives up on odd nodes (svg internals, detached elements, ...).
    return el.tagName.toLowerCase()
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
