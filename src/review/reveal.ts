/**
 * Getting back into whatever a comment's element is in: a popup, a menu, a
 * tab that isn't the one showing.
 *
 * Plenty of what's worth reviewing only shows after a click: the account
 * menu, the Change plan dialog, its second tab. Comment on a button in
 * there, close it, and the comment has nothing on screen to point at, and
 * whoever reads it has to guess what opens it. So as a comment is made, the
 * tool works out what was pressed to open the part of the page it's in, and
 * keeps that with the comment as its way in (openWith): what to press, in
 * order, from the page as it first loads. Going to the comment presses them
 * again, as the reviewer did, and the comment opens on its element.
 *
 * Two ways to tell what opens what:
 *
 * - What the page says. Accessible popups and their buttons name each
 *   other: aria-controls, popovertarget, a menu labelled by its button, a
 *   <details> and its <summary>, Bootstrap's data-bs-target.
 * - What the reviewer did. The tool remembers the last presses made on the
 *   page outside review mode, and what each one showed, hid or changed in
 *   the moment after. A press that changed what the element sits in is what
 *   opened it.
 *
 * The presses made to open things are made-up events, which review mode
 * lets through: only a person's own clicks are review clicks.
 */

import { describeElement, formatName } from './describe'
import { selectorFor } from './selector'
import { pageKey, type CommentTarget, type ReviewComment } from './store'
import { findElement, isOurUi, isRendered, isShown, onRemoveUi } from './ui'

/** How many presses are remembered. */
const MAX_PRESSES = 20

/** How long after a press what changes on the page counts as its doing. */
const WATCH_MS = 1500

/** How much of what one press changed is remembered. */
const MAX_CHANGES = 2000

/** A way in longer than this is a guess gone wrong, not a path. */
const MAX_STEPS = 4

/** How long each press gets to open what it opens. */
const OPEN_WAIT_MS = 2500

/** What a press means to act on, rather than the icon or the words inside it. */
const CONTROL = [
  'a[href]',
  'button',
  'summary',
  'label',
  'select',
  'input',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[aria-haspopup]',
  '[aria-expanded]',
  '[aria-controls]',
  '[tabindex]',
].join(', ')

/** Things laid over the page, as popups are. */
const OVERLAY = [
  'dialog',
  '[popover]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  '[aria-modal="true"]',
].join(', ')

/** A press the reviewer made on the page, and what it set off. */
type Press = {
  /** Held loosely: a page throwing the element away shouldn't have to keep it. */
  el: WeakRef<Element>
  page: string
  at: number
  /** What showed, hid or changed in the moment after. */
  changed: WeakSet<Element>
  count: number
}

const presses: Press[] = []

/** Stops watching what the latest press changes, or null when nothing is. */
let stopWatching: (() => void) | null = null

export function mountReveal(): void {
  onRemoveUi(() => {
    stopWatching?.()
    presses.length = 0
  })
}

/**
 * Remembers a press the reviewer made on the page, outside review mode, and
 * watches what it changes for a moment. A press and the click that follows
 * it are one.
 */
export function notePress(target: Element, page: string): void {
  const el = target.closest(CONTROL) ?? target
  const now = performance.now()
  const last = presses.at(-1)
  if (last && last.el.deref() === el && now - last.at < WATCH_MS) return

  const press: Press = {
    el: new WeakRef(el),
    page: pageKey(page),
    at: now,
    changed: new WeakSet(),
    count: 0,
  }
  presses.push(press)
  if (presses.length > MAX_PRESSES) presses.shift()
  watch(press)
}

function watch(press: Press): void {
  stopWatching?.()

  const note = (node: Node) => {
    if (press.count >= MAX_CHANGES || !(node instanceof Element) || isOurUi(node)) return
    press.changed.add(node)
    press.count++
  }
  const take = (records: MutationRecord[]) => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(note)
      else if (shows(record)) note(record.target)
    }
  }
  // A popover opened from a script changes no attribute; it says so in an
  // event instead.
  const onToggle = (event: Event) => {
    if (event.target instanceof Node) note(event.target)
  }

  const observer = new MutationObserver(take)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributeFilter: SHOWING_ATTRIBUTES,
    attributeOldValue: true,
  })
  document.addEventListener('toggle', onToggle, true)

  const stop = () => {
    // Whatever is still queued happened in time.
    take(observer.takeRecords())
    observer.disconnect()
    document.removeEventListener('toggle', onToggle, true)
    clearTimeout(timer)
    if (stopWatching === stop) stopWatching = null
  }
  const timer = setTimeout(stop, WATCH_MS)
  stopWatching = stop
}

/**
 * Whether an attribute change could have brought something into view.
 *
 * A write that changes nothing counts for nothing: plenty of pages set
 * aria-expanded="false" on their menu button at every click anywhere. Nor
 * does a change saying something closed or hid: opening one popup often
 * closes another, and that doesn't make the one what opened the other. A
 * style change only counts when it touches display, visibility or opacity,
 * since plenty of pages move things about every frame, a parallax header
 * say. Class changes are judged by the words added and taken away.
 */
function shows(record: MutationRecord): boolean {
  const name = record.attributeName ?? ''
  const before = record.oldValue
  const now = (record.target as Element).getAttribute(name)
  if (before === now) return false

  switch (name) {
    case 'hidden':
    case 'inert':
      return now === null
    case 'open':
      return now !== null
    case 'aria-hidden':
      return now !== 'true'
    case 'style': {
      const visibility = (style: string | null) =>
        (style ?? '').match(/(?:display|visibility|opacity)\s*:[^;]*/g)?.join(';') ?? ''
      if (visibility(before) === visibility(now)) return false
      return !/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/.test(now ?? '')
    }
    case 'class': {
      const words = (classes: string | null) =>
        new Set((classes ?? '').split(/\s+/).filter(Boolean).map(lastWord))
      const was = words(before)
      const is = words(now)
      const added = [...is].filter((word) => !was.has(word))
      const removed = [...was].filter((word) => !is.has(word))
      return !removed.some((word) => SHOWING.has(word)) && !added.some((word) => HIDING.has(word))
    }
    default:
      // data-state="closed", or data-open taken away.
      return now !== null && !HIDING.has(lastWord(now))
  }
}

/** The attributes popups are shown and hidden by. */
const SHOWING_ATTRIBUTES = [
  'class',
  'style',
  'hidden',
  'open',
  'inert',
  'aria-hidden',
  'data-state',
  'data-open',
  'data-show',
  'data-visible',
  'data-expanded',
]

/** Last words of classes and values that say something is now showing… */
const SHOWING = new Set([
  'active', 'entered', 'entering', 'expanded', 'in', 'open', 'opened', 'opening',
  'show', 'showing', 'shown', 'visible',
])

/** …or that it's now hidden. */
const HIDING = new Set([
  'closed', 'closing', 'collapsed', 'collapsing', 'exit', 'exiting', 'hidden', 'hide',
  'hiding', 'inactive', 'invisible', 'leaving', 'out',
])

/** "open" from "menu-open", "isOpen" or "open". */
function lastWord(name: string): string {
  return (name.split(/[-_]+|(?=[A-Z])/).at(-1) ?? '').toLowerCase()
}

/**
 * What to press, in order, to bring el into view from the page as it first
 * loads: empty for an element that is simply on the page. Worked out as a
 * comment is made, while el is in view and whatever it's in is open.
 */
export function wayInFor(el: Element, page: string): CommentTarget[] {
  const key = pageKey(page)
  const steps: Element[] = []
  let inner = el
  let before = Infinity
  while (steps.length < MAX_STEPS) {
    const step = openerOf(inner, before, key)
    // Pressing something round the element would act on the element itself,
    // not open the way to it.
    if (!step || step.el === el || step.el.contains(el) || steps.includes(step.el)) break
    steps.unshift(step.el)
    inner = step.el
    before = step.at
  }
  return steps.map((step) => ({ selector: selectorFor(step), name: describeElement(step) }))
}

/**
 * What opens the innermost thing round el that opens at all, and when it was
 * pressed; null when el is simply on the page. Only presses made before
 * `before` count: the way into the dialog a tab is in was pressed before the
 * tab was.
 */
function openerOf(
  el: Element,
  before: number,
  page: string,
): { el: Element; at: number } | null {
  const layer = overlayAround(el)
  for (let around: Element | null = el; around; around = around.parentElement) {
    const whole = around === document.body || around === document.documentElement
    // The page as a whole changing, a class put on <body> say, only counts
    // for something laid over the page: otherwise every comment would be
    // "opened" by whatever was last pressed.
    if (whole && !layer) return null

    const linked = whole ? null : linkedOpener(around, el)
    if (linked) return { el: linked, at: before }

    const pressed = pressThatChanged(around, whole && layer ? layer : around, el, before, page)
    if (pressed) return pressed
  }
  return null
}

/**
 * What the page itself says opens `around`: the summary of a <details>, the
 * button whose aria-controls names it, the tab a tab panel is labelled by.
 * Only something on show counts, and only from outside what it opens: a
 * menu button hidden at this window size isn't how anyone got in.
 */
function linkedOpener(around: Element, el: Element): Element | null {
  if (around.localName === 'details') {
    const summary = Array.from(around.children).find((child) => child.localName === 'summary')
    return summary && !summary.contains(el) ? summary : null
  }

  const usable = (opener: Element | null): opener is Element =>
    opener !== null && !around.contains(opener) && !isOurUi(opener) && isRendered(opener)

  if (around.id) {
    const id = CSS.escape(around.id)
    const named = document.querySelectorAll(
      [
        `[aria-controls~="${id}"]`,
        `[popovertarget="${id}"]`,
        `[commandfor="${id}"]`,
        `[data-bs-target="#${id}"]`,
        `[data-target="#${id}"]`,
        `[href="#${id}"][data-bs-toggle]`,
        `[href="#${id}"][data-toggle]`,
      ].join(', '),
    )
    // Several buttons can open one dialog, each filling it in differently:
    // the one the reviewer pressed is the way in.
    const openers = Array.from(named).filter(usable)
    const opener = lastPressedOf(openers) ?? openers[0]
    if (opener) return opener
  }

  // A menu is labelled by the button that opens it, a tab panel by its tab.
  // A dialog is labelled by its own title, which doesn't count: it's inside.
  for (const id of (around.getAttribute('aria-labelledby') ?? '').split(/\s+/)) {
    const label = id ? document.getElementById(id) : null
    if (usable(label) && label.matches(CONTROL)) return label
  }

  // A disclosure's button sits just before what it shows.
  const previous = around.previousElementSibling
  return usable(previous) && previous.matches('[aria-expanded="true"]') ? previous : null
}

/** Whichever of these the reviewer pressed last, or null if none. */
function lastPressedOf(candidates: readonly Element[]): Element | null {
  for (let i = presses.length - 1; i >= 0; i--) {
    const pressed = presses[i].el.deref()
    const hit = pressed && candidates.find((c) => c === pressed || c.contains(pressed))
    if (hit) return hit
  }
  return null
}

/**
 * The latest press before `before` that changed `changed`, made outside
 * `outside` and not on el or round it, or null.
 */
function pressThatChanged(
  changed: Element,
  outside: Element,
  el: Element,
  before: number,
  page: string,
): { el: Element; at: number } | null {
  for (let i = presses.length - 1; i >= 0; i--) {
    const press = presses[i]
    if (press.at >= before || press.page !== page || !press.changed.has(changed)) continue
    const pressed = press.el.deref()
    if (
      pressed?.isConnected &&
      pressed !== el &&
      !pressed.contains(el) &&
      !outside.contains(pressed)
    ) {
      return { el: pressed, at: press.at }
    }
  }
  return null
}

/** The nearest thing round el that's laid over the page, as popups are, or null. */
function overlayAround(el: Element): Element | null {
  for (
    let around: Element | null = el;
    around && around !== document.body;
    around = around.parentElement
  ) {
    if (around.matches(OVERLAY) || getComputedStyle(around).position === 'fixed') return around
  }
  return null
}

/** A way in as a person would say it: Button “Change plan…”, then Tab “Seats”. */
export function describeWayIn(steps: readonly CommentTarget[]): string {
  return steps.map((step) => formatName(step.name)).join(', then ')
}

/**
 * Where a comment's way in can start from on the page now: the furthest of
 * its steps on screen, and which one that is. Null when none is, or it has
 * no way in.
 */
export function doorOf(comment: ReviewComment): { el: Element; index: number } | null {
  return doorIn(comment.openWith ?? [])
}

function doorIn(steps: readonly CommentTarget[]): { el: Element; index: number } | null {
  for (let index = steps.length - 1; index >= 0; index--) {
    const el = shownStep(steps[index])
    if (el) return { el, index }
  }
  return null
}

/**
 * Presses a way in, from wherever it can start on the page now, waiting
 * each time for what that opens. Resolves to whatever `shown` finds once it
 * all has, an element of the comment's, or null when the way in led
 * nowhere.
 */
export async function reveal(
  steps: readonly CommentTarget[],
  shown: () => Element | null,
): Promise<Element | null> {
  const door = doorIn(steps)
  if (!door) return shown()

  for (let index = door.index; index < steps.length; index++) {
    const step = await waitFor(() => shownStep(steps[index]))
    if (!step) return null
    // Pressed again, it would close what it already has open.
    if (!isOpen(step)) press(step)
  }
  return waitFor(shown)
}

function shownStep(step: CommentTarget): Element | null {
  const el = findElement(step.selector)
  return el && isShown(el) ? el : null
}

/** A button whose popup is open already, a tab already chosen, an open <details>. */
function isOpen(el: Element): boolean {
  if (el.localName === 'summary') {
    return el.parentElement instanceof HTMLDetailsElement && el.parentElement.open
  }
  return el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-selected') === 'true'
}

/**
 * A press as a person makes one, from the pointer going down to the click:
 * some controls open on the first, some on the last.
 */
function press(el: Element): void {
  el.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  const rect = el.getBoundingClientRect()
  const at = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  }
  const pointer = { ...at, pointerId: 1, pointerType: 'mouse', isPrimary: true }

  el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }))
  el.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 1 }))
  if (el instanceof HTMLElement) el.focus({ preventScroll: true })
  el.dispatchEvent(new PointerEvent('pointerup', pointer))
  el.dispatchEvent(new MouseEvent('mouseup', at))
  el.dispatchEvent(new MouseEvent('click', { ...at, detail: 1 }))
}

/** Checks every so often until find finds something, or OPEN_WAIT_MS is up. */
function waitFor(find: () => Element | null): Promise<Element | null> {
  const started = performance.now()
  return new Promise((resolve) => {
    const check = () => {
      const found = find()
      if (found || performance.now() - started > OPEN_WAIT_MS) resolve(found)
      else setTimeout(check, 50)
    }
    check()
  })
}
