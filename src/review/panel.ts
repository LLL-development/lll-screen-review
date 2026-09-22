/**
 * The live list of comments, shown in a panel on the right.
 *
 * It redraws itself whenever the store changes. Hovering a row re-highlights
 * the element that comment is about; clicking a row scrolls to it. Rows can be
 * resolved, which mutes them here and mutes their pin on the page.
 */

import {
  getComments,
  onChange,
  removeComment,
  setStatus,
  type ReviewComment,
} from './store'
import { showHighlight, hideHighlight } from './highlight'
import { findElement, markAsUi } from './ui'

const panel = markAsUi(document.createElement('aside'))
panel.className = 'sr-panel'
panel.hidden = true

/** Collapsed hides the list and keeps the header, so the page stays visible. */
let collapsed = false

export function mountPanel(): void {
  document.body.appendChild(panel)
  onChange(render)
  render()
}

export function setPanelVisible(visible: boolean): void {
  panel.hidden = !visible
}

/** True when there is something worth keeping the panel open for. */
export function hasComments(): boolean {
  return getComments().length > 0
}

function setCollapsed(next: boolean): void {
  collapsed = next
  render()
}

function render(): void {
  const comments = getComments()
  panel.replaceChildren(buildHeader(comments))

  if (collapsed) return

  if (comments.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'sr-panel-empty'
    empty.textContent =
      'No comments yet. Turn review mode on and click something on the page.'
    panel.appendChild(empty)
    return
  }

  const list = document.createElement('ul')
  list.className = 'sr-panel-list'
  // Newest first: the comment you just left should be the one you can see.
  for (const comment of [...comments].reverse()) {
    list.appendChild(buildRow(comment))
  }
  panel.appendChild(list)
}

function buildHeader(comments: readonly ReviewComment[]): HTMLElement {
  const header = document.createElement('div')
  header.className = 'sr-panel-header'

  const resolved = comments.filter((c) => c.status === 'resolved').length

  const collapse = document.createElement('button')
  collapse.type = 'button'
  collapse.className = 'sr-panel-collapse'
  collapse.setAttribute('aria-expanded', String(!collapsed))
  collapse.title = collapsed ? 'Expand the list' : 'Collapse the list'
  // Chevron pointing down when open, right when collapsed.
  collapse.textContent = collapsed ? '›' : '⌄'
  collapse.addEventListener('click', () => setCollapsed(!collapsed))

  const title = document.createElement('span')
  title.className = 'sr-panel-title'
  title.textContent = comments.length === 1 ? '1 comment' : `${comments.length} comments`

  const count = document.createElement('span')
  count.className = 'sr-panel-count'
  count.textContent = resolved > 0 ? `${resolved} resolved` : ''

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'sr-panel-copy'
  copy.textContent = 'Copy JSON'
  copy.disabled = comments.length === 0
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(getComments(), null, 2))
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy JSON'), 1200)
  })

  header.append(collapse, title, count, copy)
  return header
}

function buildRow(comment: ReviewComment): HTMLElement {
  const row = document.createElement('li')
  row.className = 'sr-row'
  // Drives the muted styling for resolved rows, in CSS rather than here.
  row.dataset.status = comment.status

  const number = document.createElement('span')
  number.className = 'sr-row-number'
  // The same number its pin shows on the page.
  number.textContent = String(comment.id)

  const selector = document.createElement('code')
  selector.className = 'sr-row-selector'
  // textContent everywhere in this file: selectors and comment text are data,
  // never markup to be executed.
  selector.textContent = comment.selector

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'sr-row-delete'
  remove.title = 'Delete this comment'
  remove.textContent = '×'
  remove.addEventListener('click', (event) => {
    event.stopPropagation()
    removeComment(comment.id)
    hideHighlight()
  })

  const head = document.createElement('div')
  head.className = 'sr-row-head'
  head.append(number, selector, remove)

  const text = document.createElement('p')
  text.className = 'sr-row-text'
  text.textContent = comment.comment

  // Both are kept: the clarified wording is what someone acts on, the original
  // note is how it was first put.
  const clarified = document.createElement('p')
  clarified.className = 'sr-row-clarified'
  clarified.textContent = comment.clarified ?? ''
  clarified.hidden = !comment.clarified

  const status = document.createElement('span')
  status.className = 'sr-row-status'
  status.textContent = comment.status === 'resolved' ? 'Resolved' : 'Open'

  // Shown when the stored selector no longer matches anything: the comment is
  // still worth reading, there is just nowhere on the page to point at.
  const missing = document.createElement('span')
  missing.className = 'sr-row-missing-tag'
  missing.textContent = 'Element not found'

  const time = document.createElement('time')
  time.className = 'sr-row-time'
  time.textContent = new Date(comment.createdAt).toLocaleTimeString()

  const resolve = document.createElement('button')
  resolve.type = 'button'
  resolve.className = 'sr-row-resolve'
  resolve.textContent = comment.status === 'resolved' ? 'Reopen' : 'Resolve'
  resolve.addEventListener('click', (event) => {
    event.stopPropagation()
    setStatus(comment.id, comment.status === 'resolved' ? 'open' : 'resolved')
  })

  const foot = document.createElement('div')
  foot.className = 'sr-row-foot'
  foot.append(status, missing, time, resolve)

  row.append(head, text, clarified, foot)

  const findTarget = () => findElement(comment.selector)

  /**
   * The page can change under us — an element may be re-rendered, removed, or
   * appear later — so the missing state is re-checked rather than decided once.
   */
  const syncMissing = (target: Element | null) => {
    row.classList.toggle('sr-row-missing', !target)
    missing.hidden = Boolean(target)
  }

  syncMissing(findTarget())

  row.addEventListener('mouseenter', () => {
    const target = findTarget()
    syncMissing(target)
    if (target) showHighlight(target, comment.selector)
  })
  row.addEventListener('mouseleave', () => hideHighlight())
  row.addEventListener('click', () => {
    findTarget()?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  return row
}
