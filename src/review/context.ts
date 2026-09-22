/**
 * What was on screen when a comment was made.
 *
 * A selector says which element, but not what it was. "Make this bigger" on
 * `.card:nth-child(2) > .stat` is unreadable on its own; the same note next to
 * "a p reading $12,480, inside a card headed Revenue" is a real request.
 *
 * This is the context a person needs to understand a comment later, and the
 * context the AI clarification step needs to ask a useful question.
 */

/** Keeps stored comments small and prompts cheap. */
const TEXT_LIMIT = 200
const NEARBY_LIMIT = 300

export type ElementContext = {
  /** Lowercase tag name, e.g. "button". */
  tagName: string
  /** The element's own visible text, collapsed and trimmed. */
  text: string
  /** Visible text from around the element, for orientation. */
  nearbyText: string
  /** Window size at the moment of capture, for size-dependent feedback. */
  viewport: { width: number; height: number }
}

export function captureContext(el: Element): ElementContext {
  return {
    tagName: el.tagName.toLowerCase(),
    text: truncate(visibleTextOf(el), TEXT_LIMIT),
    nearbyText: nearbyTextFor(el),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  }
}

/**
 * The text a person would actually see.
 *
 * innerText respects rendering — it skips display:none and reflects line
 * breaks — where textContent would return markup text that is not on screen.
 * Elements without innerText (SVG internals) fall back to textContent.
 */
function visibleTextOf(el: Element): string {
  const raw = el instanceof HTMLElement ? el.innerText : (el.textContent ?? '')
  return collapse(raw)
}

/**
 * Text from the element's surroundings.
 *
 * Climbs to the nearest ancestor that says meaningfully more than the element
 * itself, so commenting on a bare number picks up the card heading around it.
 * Returns an empty string when nothing nearby adds anything.
 */
function nearbyTextFor(el: Element): string {
  const own = visibleTextOf(el)

  let ancestor = el.parentElement
  while (ancestor && ancestor !== document.body) {
    const text = visibleTextOf(ancestor)
    if (text.length > own.length + 20) return truncate(text, NEARBY_LIMIT)
    ancestor = ancestor.parentElement
  }

  return ''
}

/** Runs of whitespace and newlines become single spaces. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`
}
