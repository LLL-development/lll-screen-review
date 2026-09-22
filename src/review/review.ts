import { finder } from '@medv/finder'
import './review.css'

/**
 * The review layer.
 *
 * Turn review mode on and the tool intercepts mouse events on the page:
 * hovering outlines the element under the cursor, clicking opens a small
 * comment box. Saving a comment records which element was clicked (as a CSS
 * selector), what was written, and the page URL.
 *
 * For now "records" means console.log. Storing comments comes later.
 */

/** Anything carrying this attribute belongs to the tool, not to the page. */
const UI_ATTR = 'data-screen-review-ui'

/** One captured piece of feedback. */
export type ReviewComment = {
  selector: string
  comment: string
  url: string
  createdAt: string
}

let reviewMode = false

/** Element currently under the cursor, or null when nothing is highlighted. */
let hovered: Element | null = null

/** The open comment box, or null when none is open. */
let popup: HTMLElement | null = null

const toggle = buildToggle()
const highlight = buildHighlight()
const highlightLabel = highlight.firstElementChild as HTMLElement

/** Mounts the tool onto the current page. Call once, on page load. */
export function startReviewTool(): void {
  document.body.append(toggle, highlight)

  // Capture phase (the `true` argument) means these run before any handler the
  // page itself registered, so we can swallow clicks before a button or link
  // reacts to them.
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)

  // The highlight box is positioned against the viewport, so it goes stale
  // when the page scrolls or resizes underneath it.
  window.addEventListener('scroll', repositionHighlight, true)
  window.addEventListener('resize', repositionHighlight)

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
    clearHighlight()
  }

  console.log(
    on
      ? '[Screen Review] review mode ON — click any element to comment (Esc to exit).'
      : '[Screen Review] review mode off.',
  )
}

// --- hovering ---------------------------------------------------------------

function onMouseMove(event: MouseEvent): void {
  // While a comment box is open the highlight stays put on the clicked
  // element, so the outline keeps showing what the comment is about.
  if (!reviewMode || popup) return

  const target = event.target as Element | null
  if (!target || isOurUi(target)) {
    clearHighlight()
    return
  }

  // finder does real work, so only recompute when the element actually changes.
  if (target !== hovered) {
    hovered = target
    highlightLabel.textContent = selectorFor(target)
  }
  drawHighlight(target)
}

function drawHighlight(el: Element): void {
  const box = el.getBoundingClientRect()
  highlight.style.display = 'block'
  highlight.style.top = `${box.top}px`
  highlight.style.left = `${box.left}px`
  highlight.style.width = `${box.width}px`
  highlight.style.height = `${box.height}px`
}

function repositionHighlight(): void {
  if (hovered) drawHighlight(hovered)
}

function clearHighlight(): void {
  hovered = null
  highlight.style.display = 'none'
}

// --- clicking ---------------------------------------------------------------

function onClick(event: MouseEvent): void {
  if (!reviewMode) return

  const target = event.target as Element | null
  if (!target) return

  // Clicks on our own toolbar and comment box behave normally.
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
  hovered = el
  drawHighlight(el)

  popup = document.createElement('div')
  popup.className = 'sr-popup'
  popup.setAttribute(UI_ATTR, '')
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

  const submit = () => {
    const text = textarea.value.trim()
    if (!text) {
      textarea.focus()
      return
    }
    capture(selector, text)
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
  clearHighlight()
}

/** For now, "saving" a comment means printing it to the console. */
function capture(selector: string, comment: string): void {
  const entry: ReviewComment = {
    selector,
    comment,
    url: window.location.href,
    createdAt: new Date().toISOString(),
  }

  console.group(
    '%c[Screen Review] comment captured',
    'color:#2f5bd7;font-weight:600',
  )
  console.log('selector:', entry.selector)
  console.log('comment :', entry.comment)
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

function isOurUi(el: Element): boolean {
  return Boolean(el.closest(`[${UI_ATTR}]`))
}

function buildToggle(): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'sr-toggle'
  button.type = 'button'
  button.setAttribute(UI_ATTR, '')
  button.dataset.on = 'false'
  button.innerHTML =
    '<span class="sr-toggle-dot"></span><span class="sr-toggle-text">Review mode: off</span>'
  button.addEventListener('click', () => setReviewMode(!reviewMode))
  return button
}

function buildHighlight(): HTMLElement {
  const box = document.createElement('div')
  box.className = 'sr-highlight'
  box.setAttribute(UI_ATTR, '')
  box.innerHTML = '<span class="sr-highlight-label"></span>'
  return box
}
