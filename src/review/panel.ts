/**
 * The live list of comments, shown in a panel on the right.
 *
 * It redraws itself whenever the store changes. Hovering a row re-highlights
 * the element that comment is about; clicking a row scrolls to it.
 */

import { getComments, onChange, removeComment } from './store'
import { showHighlight, hideHighlight } from './highlight'
import { findElement, markAsUi } from './ui'

const panel = markAsUi(document.createElement('aside'))
panel.className = 'sr-panel'
panel.hidden = true

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

function render(): void {
  const comments = getComments()
  panel.replaceChildren(buildHeader(comments.length))

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

function buildHeader(count: number): HTMLElement {
  const header = document.createElement('div')
  header.className = 'sr-panel-header'

  const title = document.createElement('span')
  title.className = 'sr-panel-title'
  title.textContent = count === 1 ? '1 comment' : `${count} comments`

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'sr-panel-copy'
  copy.textContent = 'Copy JSON'
  copy.disabled = count === 0
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(getComments(), null, 2))
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy JSON'), 1200)
  })

  header.append(title, copy)
  return header
}

function buildRow(comment: {
  id: number
  selector: string
  comment: string
  createdAt: string
}): HTMLElement {
  const row = document.createElement('li')
  row.className = 'sr-row'

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
  head.append(selector, remove)

  const text = document.createElement('p')
  text.className = 'sr-row-text'
  text.textContent = comment.comment

  const time = document.createElement('time')
  time.className = 'sr-row-time'
  time.textContent = new Date(comment.createdAt).toLocaleTimeString()

  row.append(head, text, time)

  const findTarget = () => findElement(comment.selector)

  row.addEventListener('mouseenter', () => {
    const target = findTarget()
    if (target) showHighlight(target, comment.selector)
    else row.classList.add('sr-row-missing')
  })
  row.addEventListener('mouseleave', () => hideHighlight())
  row.addEventListener('click', () => {
    findTarget()?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  return row
}
