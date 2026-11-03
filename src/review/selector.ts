import { attr, className, finder } from '@medv/finder'

/**
 * How the tool finds an element again: a CSS selector, unique on the page as
 * it was when the comment was made.
 *
 * A selector has to outlast the moment it was made in. finder builds one from
 * an element's classes and some of its attributes, and plenty of those say
 * how the element is right now rather than what it is: a menu that's open,
 * a tab that's active, data-state="open". Comment on a button in an open
 * menu, and a selector leaning on the menu's "show" class stops matching the
 * moment the menu closes: the comment reads as lost when it's only closed
 * away, and its pin can't come back when the menu reopens. So those are left
 * out.
 */

/** Words for how something is right now, not for what it is. */
const STATE_WORDS = new Set([
  'active',
  'checked',
  'closed',
  'closing',
  'collapsed',
  'collapsing',
  'current',
  'disabled',
  'entered',
  'entering',
  'expanded',
  'false',
  'focus',
  'focused',
  'hidden',
  'highlighted',
  'hover',
  'hovered',
  'inactive',
  'leaving',
  'open',
  'opened',
  'opening',
  'pressed',
  'selected',
  'show',
  'showing',
  'shown',
  'true',
  'unchecked',
  'visible',
])

/**
 * The last word of a name says what it is about: "menu-open" and "isOpen"
 * are states, "open-button" is a thing.
 */
function isState(name: string): boolean {
  const words = name.split(/[-_]+|(?=[A-Z])/)
  return STATE_WORDS.has((words.at(-1) ?? '').toLowerCase())
}

/**
 * A unique CSS selector for the element, e.g. `#page-title` or
 * `.card:nth-of-type(2) > .stat`.
 *
 * On a big page finder can spend up to a second looking for a short one.
 * That's once per click, never while hovering: the label shows the
 * element's name instead.
 */
export function selectorFor(el: Element): string {
  try {
    return finder(el, {
      timeoutMs: 1000,
      className: (name) => className(name) && !isState(name),
      // data-state="open", and data-open and data-active themselves.
      attr: (name, value) =>
        attr(name, value) && !isState(value) && !isState(name) && !name.endsWith('-state'),
    })
  } catch {
    // finder gives up on odd nodes (svg internals, detached elements, ...).
    return pathTo(el)
  }
}

/**
 * The element's exact position from the top of the document, e.g.
 * `html > body:nth-child(2) > div:nth-child(3)`. Brittle — any change above
 * it breaks it — but it can only ever match this one element. A bare tag name
 * like "div" would pin the comment to the first div on the page instead.
 */
function pathTo(el: Element): string {
  const steps: string[] = []
  for (
    let node: Element | null = el;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    const index = node.parentElement
      ? Array.prototype.indexOf.call(node.parentElement.children, node) + 1
      : 1
    steps.unshift(`${CSS.escape(node.localName)}:nth-child(${index})`)
  }
  return ['html', ...steps].join(' > ')
}
