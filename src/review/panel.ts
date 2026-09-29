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
import { previewHighlight, endPreview } from './highlight'
import { attachUi, findElement, markAsUi, mountUi } from './ui'

/** How often each row re-checks whether its element is still on the page. */
const RECHECK_MS = 1000

const panel = markAsUi(document.createElement('aside'))
panel.className = 'sr-panel'
panel.hidden = true

/** Collapsed hides the list and keeps the header, so the page stays visible. */
let collapsed = false

/** One per row on screen: re-checks that row's "Element not found" tag. */
let rowChecks: (() => void)[] = []

export function mountPanel(): void {
  mountUi(panel)
  onChange(render)
  render()

  // Elements come and go without the comments changing — a menu opens, the
  // page re-renders — so the tags are kept up to date on a timer too.
  setInterval(() => {
    if (!panel.hidden) for (const check of rowChecks) check()
  }, RECHECK_MS)
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
  // The list is rebuilt from scratch, which would jump it back to the top —
  // right after you resolve something near the bottom.
  const scrolled = panel.querySelector('.sr-panel-list')?.scrollTop ?? 0

  rowChecks = []
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
  list.scrollTop = scrolled
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
    const json = JSON.stringify(getComments(), null, 2)
    const copied = await copyText(json)
    // Not copied: the console still has it, one select-all away.
    if (!copied) console.log('[Screen Review] comments as JSON:\n' + json)
    copy.textContent = copied ? 'Copied' : 'Copy failed — see console'
    setTimeout(() => (copy.textContent = 'Copy JSON'), copied ? 1200 : 3000)
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
    // The row is gone, so it will never get its mouseleave.
    endPreview()
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
  time.dateTime = comment.createdAt
  time.textContent = formatTime(comment.createdAt)

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
  rowChecks.push(() => syncMissing(findTarget()))

  row.addEventListener('mouseenter', () => {
    const target = findTarget()
    syncMissing(target)
    if (target) previewHighlight(target, comment.selector)
  })
  row.addEventListener('mouseleave', () => endPreview())
  row.addEventListener('click', () => {
    findTarget()?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  return row
}

/** Just the time for today's comments; older ones need the date too. */
function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString()
    : date.toLocaleString()
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // No clipboard API off localhost over plain http, or the browser said
    // no. The old select-and-copy way still works in most of those cases.
    const area = markAsUi(document.createElement('textarea'))
    area.value = text
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    attachUi(area)
    area.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      area.remove()
    }
  }
}
