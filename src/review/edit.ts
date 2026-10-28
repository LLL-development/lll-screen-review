/**
 * Rewording a saved comment.
 *
 * Notes are left fast, mid-review: half sentences, typos, "this is weird".
 * Before they become tickets someone reads them back and wants to fix them,
 * and deleting a comment to write it again would lose its number, its pin
 * and its screenshot. So a comment can be edited in place: the note, the
 * clarified requirement, and what would count as done. The store keeps the
 * wording it had before its first edit.
 *
 * The comment reader and the ticket review both use it.
 */

import { editComment, type ReviewComment } from './store'

export type CommentEditor = {
  el: HTMLElement
  /** True when closing it would throw away a change. */
  hasChanges: () => boolean
  focus: () => void
}

export function buildCommentEditor(
  comment: ReviewComment,
  handlers: { onSaved: () => void; onCancel: () => void },
): CommentEditor {
  const form = document.createElement('div')
  form.className = 'sr-editor'
  form.innerHTML = `
    <p class="sr-editor-warning" hidden></p>
    <label class="sr-editor-field">
      <span>Comment</span>
      <textarea class="sr-editor-comment" rows="3"></textarea>
    </label>
    <label class="sr-editor-field">
      <span>Clarified requirement <em>optional</em></span>
      <textarea class="sr-editor-clarified" rows="2"
        placeholder="The change to make, in one plain sentence"></textarea>
    </label>
    <label class="sr-editor-field">
      <span>Done when <em>optional</em></span>
      <textarea class="sr-editor-acceptance" rows="2"
        placeholder="What someone checks to call it fixed: the total is bold on phones too"></textarea>
    </label>
    <div class="sr-editor-actions">
      <span class="sr-popup-hint">Ctrl+Enter saves · Esc cancels</span>
      <button type="button" class="sr-cancel">Cancel</button>
      <button type="button" class="sr-save">Save</button>
    </div>
  `

  const field = (name: string) => form.querySelector(`.sr-editor-${name}`) as HTMLTextAreaElement
  const text = field('comment')
  const clarified = field('clarified')
  const acceptance = field('acceptance')
  text.value = comment.comment
  clarified.value = comment.clarified ?? ''
  acceptance.value = comment.acceptance ?? ''

  // A ticket made from it won't follow the edit, and should be fixed there.
  if (comment.copiedForTicketAt) {
    const warning = form.querySelector('.sr-editor-warning') as HTMLElement
    warning.hidden = false
    warning.textContent = `Copied for a ticket on ${new Date(
      comment.copiedForTicketAt,
    ).toLocaleDateString()}. Changes here won’t reach that ticket, so copy it again or fix it there too.`
  }

  const save = form.querySelector('.sr-save') as HTMLButtonElement
  const cancel = form.querySelector('.sr-cancel') as HTMLButtonElement
  // An empty comment would leave a pin saying nothing.
  const sync = () => (save.disabled = text.value.trim() === '')
  text.addEventListener('input', sync)
  sync()

  const submit = () => {
    if (save.disabled) return
    editComment(comment.id, {
      comment: text.value,
      clarified: clarified.value,
      acceptance: acceptance.value,
    })
    handlers.onSaved()
  }
  save.addEventListener('click', submit)
  cancel.addEventListener('click', handlers.onCancel)
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault()
      submit()
    }
  })

  return {
    el: form,
    hasChanges: () =>
      text.value.trim() !== comment.comment ||
      clarified.value.trim() !== (comment.clarified ?? '') ||
      acceptance.value.trim() !== (comment.acceptance ?? ''),
    focus: () => {
      text.focus()
      text.setSelectionRange(text.value.length, text.value.length)
    },
  }
}

/**
 * A short line under an edited comment, with the wording it was first left
 * in a click away: the reviewer's own words are worth having when the edit
 * got something wrong.
 */
export function buildEditedNote(comment: ReviewComment): HTMLElement | null {
  const { original } = comment
  if (!original) return null

  const note = document.createElement('div')
  note.className = 'sr-edited'

  const show = document.createElement('button')
  show.type = 'button'
  show.className = 'sr-edited-toggle'
  show.textContent = 'Edited · show the original'
  show.setAttribute('aria-expanded', 'false')

  const before = document.createElement('div')
  before.className = 'sr-edited-original'
  before.hidden = true
  const first = document.createElement('p')
  first.textContent = original.comment
  before.append(first)
  if (original.clarified) {
    const clarified = document.createElement('p')
    clarified.className = 'sr-popup-clarified'
    clarified.textContent = original.clarified
    before.append(clarified)
  }

  show.addEventListener('click', () => {
    before.hidden = !before.hidden
    show.setAttribute('aria-expanded', String(!before.hidden))
    show.textContent = before.hidden ? 'Edited · show the original' : 'Edited · hide the original'
  })

  note.append(show, before)
  return note
}
