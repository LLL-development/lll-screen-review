/**
 * The clarification conversation inside the comment box.
 *
 * "Make this clearer" tells nobody anything. The point of this step is to turn
 * a rough note into a request someone can act on, by asking one short question
 * while the reviewer is still looking at the thing they commented on.
 *
 * The AI asks and drafts. It never decides: the drafted wording lands in an
 * editable box, and nothing is saved until the person presses Save themselves.
 */

import {
  askForQuestion,
  clarifyStatus,
  composeRequirement,
  type ClarifyInput,
} from './clarify'
import type { ElementContext } from './context'

export type ClarifySection = {
  /** Goes in the popup's action row. */
  button: HTMLButtonElement
  /** Goes above the action row; holds the question and the draft. */
  element: HTMLElement
  /** The wording to save, or '' when the reviewer never clarified. */
  getClarified: () => string
}

export function createClarifySection(input: {
  selector: string
  context: ElementContext
  getComment: () => string
}): ClarifySection {
  const section = document.createElement('div')
  section.className = 'sr-clarify'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'sr-clarify-btn'
  button.textContent = 'Ask AI to clarify'
  // Hidden until we know there is a model to talk to, so it never appears and
  // then fails.
  button.hidden = true

  let requirementBox: HTMLTextAreaElement | null = null
  let question = ''

  void clarifyStatus().then((status) => {
    if (!status.configured) return

    button.hidden = false
    button.disabled = !status.reachable
    button.title = status.reachable
      ? `Ask ${status.model} for one follow-up question`
      : `${status.model} is not responding. Start it and reload the page.`
  })

  const inputFor = (): ClarifyInput => ({
    comment: input.getComment(),
    selector: input.selector,
    context: input.context,
  })

  button.addEventListener('click', () => void ask())

  async function ask(): Promise<void> {
    if (!input.getComment()) {
      showNote('Write a rough comment first, then ask.')
      return
    }

    setBusy(true, 'Asking…')
    try {
      const result = await askForQuestion(inputFor())
      if (result.status === 'clear') {
        showNote('Reads clearly enough — save it as it is.')
      } else {
        question = result.question
        showQuestion(result.question, result.options)
      }
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false, 'Ask AI to clarify')
    }
  }

  async function compose(answer: string): Promise<void> {
    if (!answer.trim()) return

    section.replaceChildren(note('Writing it up…'))
    try {
      const draft = await composeRequirement({
        ...inputFor(),
        question,
        answer: answer.trim(),
      })
      showDraft(draft)
    } catch (error) {
      showError(error)
    }
  }

  // --- the three things this section can show -------------------------------

  function showQuestion(text: string, options: string[]): void {
    const heading = document.createElement('p')
    heading.className = 'sr-clarify-question'
    heading.textContent = text

    section.replaceChildren(heading)

    if (options.length > 0) {
      const list = document.createElement('div')
      list.className = 'sr-clarify-options'

      for (const option of options) {
        const choice = document.createElement('button')
        choice.type = 'button'
        choice.className = 'sr-clarify-option'
        choice.textContent = option
        choice.addEventListener('click', () => void compose(option))
        list.appendChild(choice)
      }

      section.appendChild(list)
    }

    const answer = document.createElement('input')
    answer.type = 'text'
    answer.className = 'sr-clarify-answer'
    answer.placeholder = options.length > 0 ? 'Or answer in your own words' : 'Your answer'
    answer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void compose(answer.value)
      }
    })

    const send = document.createElement('button')
    send.type = 'button'
    send.className = 'sr-clarify-send'
    send.textContent = 'Use this answer'
    send.addEventListener('click', () => void compose(answer.value))

    const row = document.createElement('div')
    row.className = 'sr-clarify-answer-row'
    row.append(answer, send)
    section.appendChild(row)

    answer.focus()
  }

  function showDraft(draft: string): void {
    const label = document.createElement('label')
    label.className = 'sr-clarify-label'
    label.textContent = 'Clarified requirement — edit if this is not quite right'

    requirementBox = document.createElement('textarea')
    requirementBox.className = 'sr-clarify-requirement'
    requirementBox.value = draft
    label.appendChild(requirementBox)

    section.replaceChildren(label, note('Saved with your comment when you press Save.'))
  }

  function showNote(text: string): void {
    section.replaceChildren(note(text))
  }

  function showError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Clarification failed.'
    const failed = note(message)
    failed.classList.add('sr-clarify-error')
    section.replaceChildren(failed)
  }

  function note(text: string): HTMLElement {
    const element = document.createElement('p')
    element.className = 'sr-clarify-note'
    element.textContent = text
    return element
  }

  function setBusy(busy: boolean, label: string): void {
    button.disabled = busy
    button.textContent = label
  }

  return {
    button,
    element: section,
    // Read at save time, so whatever the reviewer edited is what gets stored.
    getClarified: () => requirementBox?.value.trim() ?? '',
  }
}
