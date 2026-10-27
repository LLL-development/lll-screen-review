/**
 * The live list of comments, shown in a panel on the right.
 *
 * It lists the whole site's comments: this page's first, then the ones left
 * on other pages. It redraws itself whenever the store changes. Hovering a
 * row for this page re-highlights the element that comment is about, and
 * clicking it scrolls there; clicking one for another page goes to that
 * page. Rows can be resolved, which mutes them here and mutes their pin.
 */

import {
  commentTargets,
  getComments,
  isOnThisPage,
  onChange,
  pageKey,
  removeComment,
  setStatus,
  type ReviewComment,
} from './store'
import { previewHighlight, endPreview, foundTargets } from './highlight'
import { buildName, formatName } from './describe'
import { mountUi, onRemoveUi } from './ui'

/** How often each row re-checks whether its element is still on the page. */
const RECHECK_MS = 1000

/** Fixed markup of our own, never page data, so innerHTML is fine. */
const CAMERA_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" fill-rule="evenodd" d="M5.5 2 4.3 3.5H2.5A1.5 1.5 0 0 0 1 5v7.5A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5V5a1.5 1.5 0 0 0-1.5-1.5h-1.8L10.5 2h-5ZM8 5.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>' +
  '</svg>'

const panel = document.createElement('aside')
panel.className = 'sr-panel'
panel.hidden = true

/** Collapsed hides the list and keeps the header, so the page stays visible. */
let collapsed = false

/** One per row on screen: re-checks that row's "Element not found" tag. */
let rowChecks: (() => void)[] = []

/** What clicking a comment from another page does; supplied by review.ts. */
let goTo: (comment: ReviewComment) => void = () => {}

export function mountPanel(goToComment: (comment: ReviewComment) => void): void {
  goTo = goToComment
  mountUi(panel)
  onChange(render)
  render()

  // Elements come and go without the comments changing — a menu opens, the
  // page re-renders — so the tags are kept up to date on a timer too.
  const timer = setInterval(() => {
    if (!panel.hidden) for (const check of rowChecks) check()
  }, RECHECK_MS)
  onRemoveUi(() => clearInterval(timer))
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

  // Newest first: the comment you just left should be the one you can see.
  const newestFirst = [...comments].reverse()
  const here = newestFirst.filter(isOnThisPage)
  const elsewhere = newestFirst.filter((c) => !isOnThisPage(c))

  const list = document.createElement('ul')
  list.className = 'sr-panel-list'

  // A list of this page's comments alone needs no headings.
  if (elsewhere.length > 0) list.appendChild(buildGroupHeading('This page', here.length))
  if (elsewhere.length > 0 && here.length === 0) {
    const none = document.createElement('li')
    none.className = 'sr-panel-empty'
    none.textContent = 'Nothing on this page yet.'
    list.appendChild(none)
  }
  for (const comment of here) list.appendChild(buildRow(comment))

  if (elsewhere.length > 0) list.appendChild(buildGroupHeading('Other pages', elsewhere.length))
  for (const comment of elsewhere) list.appendChild(buildRow(comment))

  panel.appendChild(list)
  list.scrollTop = scrolled
}

function buildGroupHeading(label: string, count: number): HTMLElement {
  const heading = document.createElement('li')
  heading.className = 'sr-panel-group'
  heading.textContent = `${label} · ${count}`
  return heading
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

  // The element as a person would call it. The selector is there for
  // developers on hover, and in Copy JSON.
  const targets = commentTargets(comment)
  const name = buildName(comment.context.name)
  name.classList.add('sr-row-name')
  name.title = targets.map((t) => `${formatName(t.name)}\n${t.selector}`).join('\n\n')

  // On several elements: the first by name, and how many more.
  if (targets.length > 1) {
    const more = document.createElement('span')
    more.className = 'sr-name-more'
    more.textContent = `+${targets.length - 1} more`
    const place = name.querySelector('.sr-name-place')
    if (place) place.before(' ', more)
    else name.append(' ', more)
  }

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
  head.append(number, name, remove)

  const text = document.createElement('p')
  text.className = 'sr-row-text'
  // textContent everywhere in this file: page text and comments are data,
  // never markup to be executed.
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

  // A camera when there's a picture to see; opening the comment shows it.
  const shot = document.createElement('span')
  shot.className = 'sr-row-shot'
  shot.title = 'Has a screenshot'
  shot.setAttribute('aria-label', shot.title)
  shot.innerHTML = CAMERA_ICON
  const marks = comment.screenshot ? [status, shot] : [status]

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
  row.append(head, text, clarified, foot)

  // Left on another page: its element is there, not here, so there is
  // nothing to look up or outline. The row says which page, and goes there.
  if (!isOnThisPage(comment)) {
    const page = pageLabel(comment.url)
    const where = document.createElement('span')
    where.className = 'sr-row-page'
    where.textContent = `→ ${page}`

    foot.append(...marks, where, time, resolve)
    row.classList.add('sr-row-elsewhere')
    row.title = `Go to ${page}`
    row.addEventListener('click', () => goTo(comment))
    return row
  }

  foot.append(...marks, missing, time, resolve)

  /**
   * The page can change under us — an element may be re-rendered, removed, or
   * appear later — so the missing state is re-checked rather than decided once.
   * A comment on several elements is only missing once all of them are.
   */
  const syncMissing = (found: readonly unknown[]) => {
    row.classList.toggle('sr-row-missing', found.length === 0)
    missing.hidden = found.length > 0
  }

  syncMissing(foundTargets(comment))
  rowChecks.push(() => syncMissing(foundTargets(comment)))

  row.addEventListener('mouseenter', () => {
    const found = foundTargets(comment)
    syncMissing(found)
    if (found.length > 0) previewHighlight(found)
  })
  row.addEventListener('mouseleave', () => endPreview())
  row.addEventListener('click', () => {
    foundTargets(comment)[0]?.el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  return row
}

/** A comment's page, short enough for a tag: "/about", or "Home page". */
function pageLabel(url: string): string {
  try {
    const { pathname, search, hash } = new URL(pageKey(url))
    const path = pathname + search + hash
    return path === '/' ? 'Home page' : decodeURI(path)
  } catch {
    // Not an address, or one with a stray % in it: show it as it is.
    return url
  }
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
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    mountUi(area)
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
