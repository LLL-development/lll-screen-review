/**
 * Checking comments before they go out as tickets.
 *
 * A vague note becomes a vague ticket, and a developer then has to come back
 * and ask what was meant: the very back-and-forth this tool is meant to
 * save. So before anything is copied out, every comment on the site is laid
 * out as the ticket it would become, with what's missing pointed out (no
 * clarified requirement, a few words only, nothing saying when it's done).
 * Each one can be fixed right there, and only the ones ticked are copied.
 *
 * What's copied is Markdown, one ticket after another, ready to paste into
 * Lorely or any other tracker. Creating tickets straight from here waits on
 * a server: the tracker's key can't live in the page. Copying is remembered
 * per comment, so the list says what has gone out already, and editing one
 * afterwards warns that its ticket won't follow.
 */

import { copyText } from './clipboard'
import { formatName } from './describe'
import { buildCommentEditor, type CommentEditor } from './edit'
import { pageLabel } from './panel'
import { canTakeScreenshots } from './screenshots'
import { commentTargets, getComments, markCopiedForTicket, type ReviewComment } from './store'
import { mountUi } from './ui'

/** Under this many characters, a note is probably too thin to act on. */
const SHORT_NOTE = 15

/** How long a ticket title gets before it's cut. */
const TITLE_LIMIT = 80

let sheet: HTMLElement | null = null
let backdrop: HTMLElement | null = null
/** The comments ticked to copy, kept as the list redraws. */
let picked = new Set<number>()
/** The comment being edited in the list, and its form. */
let editing: { id: number; editor: CommentEditor } | null = null

export function openTicketReview(): void {
  if (sheet) return
  // Open and not copied yet: what's waiting to go out.
  picked = new Set(
    getComments()
      .filter((c) => c.status === 'open' && !c.copiedForTicketAt)
      .map((c) => c.id),
  )

  backdrop = document.createElement('div')
  backdrop.className = 'sr-sheet-backdrop'
  backdrop.addEventListener('click', () => {
    if (!closeTicketReview()) nudge()
  })

  sheet = document.createElement('div')
  sheet.className = 'sr-sheet'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-label', 'Prepare tickets')

  mountUi(backdrop)
  mountUi(sheet)
  render()
}

/**
 * Closes the review, unless an edit in it would be thrown away. False when
 * it stayed open for that reason, or wasn't open.
 */
export function closeTicketReview(): boolean {
  if (!sheet) return false
  if (editing?.editor.hasChanges()) return false
  sheet.remove()
  backdrop?.remove()
  sheet = backdrop = null
  editing = null
  return true
}

/**
 * What Esc does while the review is open: leaves an edit, then closes. True
 * when it did something, so review.ts leaves Esc alone.
 */
export function escapeTicketReview(): boolean {
  if (!sheet) return false
  if (editing) {
    editing = null
    render()
  } else {
    closeTicketReview()
  }
  return true
}

function nudge(): void {
  if (!sheet) return
  sheet.classList.remove('sr-popup-nudge')
  void sheet.offsetWidth
  sheet.classList.add('sr-popup-nudge')
}

function render(): void {
  if (!sheet) return
  const list = sheet.querySelector('.sr-sheet-list')
  const scrolled = list?.scrollTop ?? 0
  // Only a form just opened takes the focus; ticking a box mustn't pull it back.
  const newForm = editing !== null && !editing.editor.el.isConnected

  const comments = [...getComments()].sort((a, b) => a.id - b.id)
  // Gone in the meantime, from another tab, say.
  picked = new Set([...picked].filter((id) => comments.some((c) => c.id === id)))

  sheet.innerHTML = `
    <div class="sr-sheet-head">
      <h2>Prepare tickets</h2>
      <p>Check what each ticket will say and fix anything unclear. Then copy the
      ones ticked, as Markdown for Lorely or any other tracker.</p>
    </div>
    <ul class="sr-sheet-list"></ul>
    <div class="sr-sheet-foot">
      <label class="sr-sheet-all"><input type="checkbox"> All</label>
      <span class="sr-sheet-status" role="status"></span>
      <button type="button" class="sr-cancel">Close</button>
      <button type="button" class="sr-save sr-sheet-copy"></button>
    </div>
  `

  const items = sheet.querySelector('.sr-sheet-list') as HTMLElement
  for (const comment of comments) items.append(buildTicket(comment))
  items.scrollTop = scrolled

  const all = sheet.querySelector('.sr-sheet-all input') as HTMLInputElement
  all.checked = comments.length > 0 && picked.size === comments.length
  all.indeterminate = picked.size > 0 && picked.size < comments.length
  all.addEventListener('change', () => {
    picked = new Set(all.checked ? comments.map((c) => c.id) : [])
    render()
  })

  const copy = sheet.querySelector('.sr-sheet-copy') as HTMLButtonElement
  copy.textContent = picked.size === 1 ? 'Copy 1 ticket' : `Copy ${picked.size} tickets`
  copy.disabled = picked.size === 0
  copy.addEventListener('click', () => void copyPicked(comments))

  const close = sheet.querySelector('.sr-sheet-foot .sr-cancel') as HTMLButtonElement
  close.addEventListener('click', () => {
    if (!closeTicketReview()) nudge()
  })

  if (editing && newForm) {
    editing.editor.focus()
    editing.editor.el.scrollIntoView({ block: 'nearest' })
  }
}

async function copyPicked(comments: readonly ReviewComment[]): Promise<void> {
  const chosen = comments.filter((c) => picked.has(c.id))
  const markdown = chosen.map(ticketMarkdown).join('\n\n---\n\n') + '\n'
  const copied = await copyText(markdown)
  if (!copied) {
    // The console still has it, one select-all away.
    console.log('[Screen Review] tickets as Markdown:\n' + markdown)
  } else {
    markCopiedForTicket(chosen.map((c) => c.id))
  }
  render()
  const status = sheet?.querySelector('.sr-sheet-status')
  if (status) {
    status.textContent = copied
      ? `Copied ${chosen.length} as Markdown. Paste them into the tracker.`
      : 'Copy failed. The Markdown is in the console.'
  }
}

function buildTicket(comment: ReviewComment): HTMLElement {
  const item = document.createElement('li')
  item.className = 'sr-ticket'
  item.dataset.status = comment.status
  item.classList.toggle('sr-ticket-picked', picked.has(comment.id))

  const pick = document.createElement('input')
  pick.type = 'checkbox'
  pick.className = 'sr-ticket-pick'
  pick.checked = picked.has(comment.id)
  pick.setAttribute('aria-label', `Copy comment ${comment.id}`)
  pick.addEventListener('change', () => {
    if (pick.checked) picked.add(comment.id)
    else picked.delete(comment.id)
    render()
  })

  const main = document.createElement('div')
  main.className = 'sr-ticket-main'

  const head = document.createElement('div')
  head.className = 'sr-ticket-head'
  const number = document.createElement('span')
  number.className = 'sr-popup-number'
  number.textContent = String(comment.id)
  const title = document.createElement('strong')
  title.className = 'sr-ticket-title'
  title.textContent = ticketTitle(comment)
  const page = document.createElement('span')
  page.className = 'sr-ticket-page'
  page.textContent = pageLabel(comment.url)
  head.append(number, title, page)

  main.append(head, buildHints(comment))

  if (editing?.id === comment.id) {
    main.append(editing.editor.el)
  } else {
    main.append(buildPreview(comment), buildTicketActions(comment))
  }

  item.append(pick, main)
  return item
}

/** What's missing, and what's worth knowing, before it goes out. */
function buildHints(comment: ReviewComment): HTMLElement {
  const hints = document.createElement('div')
  hints.className = 'sr-ticket-hints'
  const add = (text: string, kind: 'warn' | 'info', title = '') => {
    const hint = document.createElement('span')
    hint.className = `sr-ticket-hint sr-ticket-hint-${kind}`
    hint.textContent = text
    hint.title = title
    hints.append(hint)
  }

  if (!comment.clarified) {
    add('No clarified requirement', 'warn', 'The ticket will use the note as it was left.')
  }
  if ((comment.clarified ?? comment.comment).trim().length < SHORT_NOTE) {
    add('Very short', 'warn', 'A few words may not be enough for someone to act on.')
  }
  if (!comment.acceptance) {
    add('No “done when”', 'info', 'Nothing says what to check to call it fixed.')
  }
  if (!comment.screenshot && canTakeScreenshots()) add('No screenshot', 'info')
  if (comment.status === 'resolved') add('Resolved', 'info')
  if (comment.copiedForTicketAt) {
    add(`Copied ${new Date(comment.copiedForTicketAt).toLocaleDateString()}`, 'info')
  }
  return hints
}

/** The ticket as it will read, without the Markdown. */
function buildPreview(comment: ReviewComment): HTMLElement {
  const preview = document.createElement('dl')
  preview.className = 'sr-ticket-preview'
  const row = (label: string, value: string) => {
    const term = document.createElement('dt')
    term.textContent = label
    const detail = document.createElement('dd')
    detail.textContent = value
    preview.append(term, detail)
  }

  row('Requirement', requirementOf(comment))
  if (comment.clarified) row('Reviewer’s note', comment.comment)
  if (comment.acceptance) row('Done when', comment.acceptance)
  row(
    commentTargets(comment).length > 1 ? 'Elements' : 'Element',
    commentTargets(comment)
      .map((t) => formatName(t.name))
      .join(', '),
  )
  return preview
}

function buildTicketActions(comment: ReviewComment): HTMLElement {
  const actions = document.createElement('div')
  actions.className = 'sr-ticket-actions'

  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'sr-ticket-edit'
  edit.textContent = 'Edit'
  edit.addEventListener('click', () => {
    // One at a time, and not at the cost of changes to another.
    if (editing?.editor.hasChanges()) {
      nudge()
      return
    }
    editing = {
      id: comment.id,
      editor: buildCommentEditor(comment, {
        onSaved: () => {
          editing = null
          render()
        },
        onCancel: () => {
          editing = null
          render()
        },
      }),
    }
    render()
  })

  const show = document.createElement('button')
  show.type = 'button'
  show.className = 'sr-ticket-markdown-toggle'
  show.textContent = 'Markdown'
  show.setAttribute('aria-expanded', 'false')
  const markdown = document.createElement('pre')
  markdown.className = 'sr-ticket-markdown'
  markdown.hidden = true
  markdown.textContent = ticketMarkdown(comment)
  show.addEventListener('click', () => {
    markdown.hidden = !markdown.hidden
    show.setAttribute('aria-expanded', String(!markdown.hidden))
  })

  actions.append(edit, show, markdown)
  return actions
}

/** What to do: the clarified wording if there is one, the note if not. */
function requirementOf(comment: ReviewComment): string {
  return comment.clarified ?? comment.comment
}

/** The requirement's first line, cut to fit a title. */
function ticketTitle(comment: ReviewComment): string {
  const line = requirementOf(comment).trim().split('\n')[0]
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : line
}

/**
 * One ticket, as the plan for Lorely lays it out (§11.1): the requirement,
 * the note it came from, what counts as done, and where on which page, with
 * enough of the element to find it again.
 */
export function ticketMarkdown(comment: ReviewComment): string {
  const lines = [`## #${comment.id} ${ticketTitle(comment)}`, '', `**Requirement:** ${requirementOf(comment)}`]
  if (comment.clarified) lines.push('', `**Reviewer’s note:** ${comment.comment}`)
  if (comment.original && comment.original.comment !== comment.comment) {
    lines.push('', `**First written as:** ${comment.original.comment}`)
  }
  if (comment.acceptance) lines.push('', `**Done when:** ${comment.acceptance}`)

  lines.push('', `- **Page:** ${comment.url}`)
  for (const target of commentTargets(comment)) {
    lines.push(`- **Element:** ${formatName(target.name)} (\`${target.selector}\`)`)
  }
  const { text, viewport } = comment.context
  if (text) lines.push(`- **Text there:** “${text}”`)
  if (viewport.width > 0) lines.push(`- **Window:** ${viewport.width} × ${viewport.height}`)
  lines.push(`- **Left:** ${new Date(comment.createdAt).toLocaleString()}`)
  if (comment.screenshot) {
    lines.push(`- **Screenshot:** saved with comment #${comment.id}; download it from its pin`)
  }
  return lines.join('\n')
}
