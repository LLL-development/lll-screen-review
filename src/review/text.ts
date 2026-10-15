/**
 * Reading text off the page the way a person sees it.
 *
 * Shared by the context saved with a comment and the plain name the tool
 * gives an element, so both describe it in the same words.
 */

/**
 * The text a person would actually see.
 *
 * innerText respects rendering — it skips display:none and reflects line
 * breaks — where textContent would return markup text that is not on screen.
 * Elements without innerText (SVG internals) fall back to textContent.
 */
export function visibleTextOf(el: Element): string {
  const raw = el instanceof HTMLElement ? el.innerText : (el.textContent ?? '')
  return collapse(raw)
}

/** Runs of whitespace and newlines become single spaces. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  // Emoji and some CJK characters take two string positions; cutting between
  // them leaves half a character that shows up as "�".
  const cut = /[\uD800-\uDBFF]$/.test(text.slice(0, limit - 1)) ? limit - 2 : limit - 1
  return `${text.slice(0, cut).trimEnd()}…`
}
