/**
 * Rewording a saved comment, and changing what it's about.
 *
 * Notes are left fast, mid-review: half sentences, typos, "this is weird".
 * Before they become tickets someone reads them back and wants to fix them,
 * and deleting a comment to write it again would lose its number, its pin
 * and its screenshot. So a comment can be edited in place: the note, the
 * clarified requirement, and what would count as done. The store keeps the
 * wording it had before its first edit.
 *
 * Its elements can change too, where the page is there to pick them from:
 * the other two cards forgotten when it was left, the button meant rather
 * than the icon inside it, or the new place of an element the page has
 * moved, so a comment whose element went missing can be pointed at it
 * again. Shift+click adds one or takes it back off, as when writing.
 *
 * The comment reader and the ticket review both use it; only the reader
 * picks elements, since the ticket review covers the page.
 */

import { captureContext } from './context'
import { wayInFor } from './reveal'
import {
  commentTargets,
  editComment,
  type ElementsEdit,
  type ReviewComment,
} from './store'
import { createPicker, type Picker } from './targets'
import { findElement } from './ui'

export type CommentEditor = {
  el: HTMLElement
  /** True when closing it would throw away a change. */
  hasChanges: () => boolean
  focus: () => void
  /**
   * A Shift+click on the page while editing: adds an element to the
   * comment, or takes one off. Absent where elements aren't picked.
   */
  group?: {
    toggle: (el: Element) => void
    hint: (el: Element) => string | null
  }
}

export function buildCommentEditor(
  comment: ReviewComment,
  handlers: {
    onSaved: (saved: { elementsChanged: boolean }) => void
    onCancel: () => void
  },
  { pickElements = false }: { pickElements?: boolean } = {},
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

  const picker = pickElements ? buildElementsField(form, comment) : null
  const saved = commentTargets(comment)
    .map((t) => t.selector)
    .join('\n')
  const elementsChanged = () =>
    picker !== null &&
    picker
      .picked()
      .map((t) => t.selector)
      .join('\n') !== saved

  const submit = () => {
    if (save.disabled) return
    const changedElements = elementsChanged()
    editComment(comment.id, {
      comment: text.value,
      clarified: clarified.value,
      acceptance: acceptance.value,
      ...(picker && changedElements ? { elements: elementsEdit(comment, picker) } : {}),
    })
    handlers.onSaved({ elementsChanged: changedElements })
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
      acceptance.value.trim() !== (comment.acceptance ?? '') ||
      elementsChanged(),
    focus: () => {
      text.focus()
      text.setSelectionRange(text.value.length, text.value.length)
    },
    ...(picker ? { group: { toggle: picker.toggle, hint: picker.hint } } : {}),
  }
}

/**
 * The comment's elements, at the top of the form: listed, outlined on the
 * page, and changed by Shift+clicking the page.
 */
function buildElementsField(form: HTMLElement, comment: ReviewComment): Picker {
  const picker = createPicker(
    commentTargets(comment).map((t) => ({ ...t, el: findElement(t.selector) })),
    // The first can go too: pointing a comment somewhere else is the point.
    { keepFirst: false, onChange: () => {} },
  )

  const field = document.createElement('div')
  field.className = 'sr-editor-field sr-editor-elements'
  const label = document.createElement('span')
  label.textContent = 'Elements'
  const hint = document.createElement('span')
  hint.className = 'sr-editor-pick'
  hint.textContent = 'Shift+click the page to add one, or to take one off.'
  field.append(label, picker.element, hint)

  form.querySelector('.sr-editor-warning')?.after(field)
  return picker
}

/**
 * The elements as picked, for the store. A new first element brings its
 * own context and way in, read off the page now. One that isn't on the
 * page has only its name to go by.
 */
function elementsEdit(comment: ReviewComment, picker: Picker): ElementsEdit {
  const [first, ...rest] = picker.picked()
  const targets = [first, ...rest].map(({ selector, name }) => ({ selector, name }))
  if (first.selector === comment.selector) {
    return { targets, context: comment.context, openWith: comment.openWith ?? [] }
  }

  const el = first.el?.isConnected ? first.el : null
  return {
    targets,
    context: el
      ? captureContext(el)
      : {
          name: first.name,
          tagName: '',
          text: first.name.label,
          nearbyText: '',
          viewport: comment.context.viewport,
        },
    openWith: el ? wayInFor(el, comment.url) : (comment.openWith ?? []),
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
