/**
 * Elements that look like another one: the other cards in a grid, the other
 * "View details" buttons, the other rows of a table.
 *
 * A change asked of one blog card is usually a change to all of them, so the
 * comment box offers to take the rest in. "Looks like" means built the same
 * way: the same tag and classes, directly inside a parent with the same tag
 * and classes. Repeated things on a page come from one template, so that is
 * what repeats.
 */

import { isOurUi } from './ui'

/** More than this and it's the fabric of the page, not a set of things. */
const MAX_SIMILAR = 50

/** The elements that look like el, not counting el itself; often none. */
export function findSimilar(el: Element): Element[] {
  const parent = el.parentElement
  // Nothing on a page looks like its <body>.
  if (!parent || parent === document.documentElement) return []

  const candidates =
    el.classList.length > 0 || parent.classList.length > 0
      ? document.querySelectorAll(`${shapeOf(parent)} > ${shapeOf(el)}`)
      : // Nothing to go on but tag names, and "every <p> directly in a <div>"
        // is half the page. Only its own siblings count.
        parent.children

  const similar = [...candidates].filter(
    (other) =>
      other !== el &&
      other.localName === el.localName &&
      // A card and the card inside it are not two of a kind.
      !other.contains(el) &&
      !el.contains(other) &&
      !isOurUi(other) &&
      isOnScreen(other),
  )
  return similar.length <= MAX_SIMILAR ? similar : []
}

/** Tag and classes as a selector: article.card.card-wide */
function shapeOf(el: Element): string {
  const classes = [...el.classList].map((name) => `.${CSS.escape(name)}`)
  return CSS.escape(el.localName) + classes.join('')
}

/** Hidden ones, a closed menu's items, say, are nothing the reviewer saw. */
function isOnScreen(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}
