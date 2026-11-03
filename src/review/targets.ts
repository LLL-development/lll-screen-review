/**
 * The elements a comment is about: listing them, and picking them out on the
 * page.
 *
 * A comment can be about several elements, every card in a grid say. They're
 * picked by Shift+clicking them on the page, as the comment is written or
 * later, editing it: whoever forgot one, or picked the wrong one, puts it
 * right without starting the comment again. Each is listed by its plain
 * name, with its CSS selector a click away for developers, and outlined on
 * the page while it's being picked.
 */

import { buildName, describeElement, formatName } from './describe'
import { showHighlight } from './highlight'
import { selectorFor } from './selector'
import { findSimilar } from './similar'
import type { CommentTarget } from './store'

/**
 * Whether lists of elements show the CSS selector under the names.
 * Remembered per tab, so a developer who wants it opens it once.
 */
const SELECTOR_KEY = 'screen-review:show-selector'
let showSelector = readSelectorShown()

/** An element being picked: el is null for one that isn't on the page now. */
export type PickedTarget = CommentTarget & { el: Element | null }

export type Picker = {
  /** The list of elements, and the offer to take in more like the first. */
  element: HTMLElement
  /** What's picked so far, the one the comment hangs on first. */
  picked: () => readonly PickedTarget[]
  /** A Shift+click on el: adds it, or takes it back off. */
  toggle: (el: Element) => void
  /** What a Shift+click on el would do, or null when it would do nothing. */
  hint: (el: Element) => string | null
}

/**
 * Picking a comment's elements: lists them, outlines them on the page, and
 * offers to take in the rest built like the first. keepFirst holds on to
 * the first, which a comment being written hangs on: its context is the one
 * captured. Otherwise any can go, as long as one is left.
 */
export function createPicker(
  initial: readonly PickedTarget[],
  options: { keepFirst: boolean; onChange: () => void },
): Picker {
  const picked = [...initial]
  // Looked for now, while the page is as the reviewer sees it.
  const first = picked[0]?.el
  const similar = first?.isConnected ? findSimilar(first) : []

  const element = document.createElement('div')
  element.className = 'sr-picker'

  const canRemove = (index: number) => (options.keepFirst ? index > 0 : picked.length > 1)

  const add = (el: Element) => {
    picked.push({ el, selector: selectorFor(el), name: describeElement(el) })
    // The rest in page order, however they were picked, so the list reads
    // top to bottom. Any not on the page go last.
    const [head, ...rest] = picked
    const here = rest.filter((t) => t.el?.isConnected)
    const gone = rest.filter((t) => !t.el?.isConnected)
    here.sort((a, b) =>
      a.el!.compareDocumentPosition(b.el!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    picked.splice(0, picked.length, head, ...here, ...gone)
  }

  const changed = () => {
    render()
    options.onChange()
  }

  /** Lists the elements, and outlines the ones on the page. */
  const render = () => {
    element.replaceChildren(
      buildTargets(picked, {
        canRemove,
        onRemove: (index) => {
          picked.splice(index, 1)
          changed()
        },
        lost: (index) => !picked[index].el?.isConnected,
      }),
    )

    // The rest of the cards in the grid, say: one click takes them all in.
    const unpicked = similar.filter(
      (other) => other.isConnected && !picked.some((t) => t.el === other),
    )
    if (unpicked.length > 0) {
      const takeAll = document.createElement('button')
      takeAll.type = 'button'
      takeAll.className = 'sr-similar'
      takeAll.textContent = `+ Add ${unpicked.length} more like ${picked.length > 1 ? 'these' : 'this'}`
      takeAll.addEventListener('click', () => {
        for (const other of unpicked) add(other)
        changed()
      })
      element.append(takeAll)
    }

    showHighlight(
      picked.flatMap((t) => (t.el?.isConnected ? [{ el: t.el, text: formatName(t.name) }] : [])),
    )
  }
  render()

  return {
    element,
    picked: () => picked,
    toggle: (el) => {
      const index = picked.findIndex((t) => t.el === el)
      if (index === -1) add(el)
      else if (canRemove(index)) picked.splice(index, 1)
      else return
      changed()
    },
    hint: (el) => {
      const index = picked.findIndex((t) => t.el === el)
      if (index === -1) return 'Shift+click to add this'
      return canRemove(index) ? 'Shift+click to take this off' : null
    },
  }
}

/**
 * What a comment is about, as a person would say it, with the CSS selector
 * one click away for anyone who wants it. Several elements are counted and
 * listed. canRemove says which can be taken off with ×, and lost which
 * aren't on the page right now.
 */
export function buildTargets(
  targets: readonly CommentTarget[],
  options: {
    canRemove?: (index: number) => boolean
    onRemove?: (index: number) => void
    lost?: (index: number) => boolean
  } = {},
): HTMLElement {
  const { canRemove = () => false, onRemove, lost = () => false } = options
  const target = document.createElement('div')
  target.className = 'sr-target'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'sr-target-toggle'
  toggle.textContent = '</>'

  // textContent, not innerHTML: a selector can contain characters that came
  // from the page's own markup, and we never want to run those as HTML.
  const code = document.createElement('code')
  code.className = 'sr-target-selector'
  code.textContent = targets.map((t) => t.selector).join('\n')

  const show = (open: boolean) => {
    code.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.title = open ? 'Hide the CSS selector' : 'Show the CSS selector'
    toggle.setAttribute('aria-label', toggle.title)
  }
  show(showSelector)

  toggle.addEventListener('click', () => {
    showSelector = !showSelector
    writeSelectorShown(showSelector)
    show(showSelector)
  })

  const nameOf = (index: number) => {
    const name = buildName(targets[index].name)
    if (lost(index)) {
      const mark = document.createElement('span')
      mark.className = 'sr-target-lost'
      mark.textContent = 'not on the page'
      name.append(mark)
    }
    return name
  }

  if (targets.length === 1) {
    target.append(nameOf(0), toggle, code)
    return target
  }

  const count = document.createElement('span')
  count.className = 'sr-target-count'
  count.textContent = `${targets.length} elements`

  const list = document.createElement('ul')
  list.className = 'sr-target-list'
  targets.forEach(({ name }, index) => {
    const item = document.createElement('li')
    item.append(nameOf(index))

    if (onRemove && canRemove(index)) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'sr-target-remove'
      remove.textContent = '×'
      remove.title = 'Leave this one out'
      remove.setAttribute('aria-label', `Leave out ${formatName(name)}`)
      remove.addEventListener('click', () => onRemove(index))
      item.append(remove)
    }
    list.append(item)
  })

  target.append(count, toggle, list, code)
  return target
}

/**
 * sessionStorage can throw (storage blocked, sandboxed frames); the selector
 * then starts hidden and the choice is forgotten.
 */
function readSelectorShown(): boolean {
  try {
    return sessionStorage.getItem(SELECTOR_KEY) === 'on'
  } catch {
    return false
  }
}

function writeSelectorShown(shown: boolean): void {
  try {
    sessionStorage.setItem(SELECTOR_KEY, shown ? 'on' : 'off')
  } catch {
    // Not remembered; see readSelectorShown.
  }
}
