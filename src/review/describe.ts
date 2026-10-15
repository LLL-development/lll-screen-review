/**
 * A plain-language name for an element: Button “View details” in Revenue.
 *
 * A selector is how the tool finds an element again, not how a person
 * recognises one. `.card:nth-child(1) > .card-action` means nothing to a
 * designer or a client; "the View details button in the Revenue card" is
 * what they would say themselves. So that is what the tool shows, and the
 * selector stays underneath, for finding the element and for developers.
 *
 * A name has three parts, all read off the page:
 *
 *   kind   what sort of thing it is    Button, Text field, Image
 *   label  what it says or is called   “View details”
 *   place  where it is                 in Revenue, in the navigation
 *
 * The label is looked for where a screen reader would look: ARIA labels
 * first, then <label>s, alt text and placeholders, then the visible text.
 * The place is the heading that leads the nearest section around it, or the
 * part of the page it is in. Guesses are cautious on purpose: a name with no
 * place is better than one naming the wrong section.
 */

import { collapse, truncate, visibleTextOf } from './text'

/** Keeps a name to about one line. */
const LABEL_LIMIT = 40
const PLACE_LIMIT = 40

/** An SVG no bigger than this either way is an icon, not a graphic. */
const ICON_MAX_PX = 48

const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]'

export type ElementName = {
  /** What sort of thing it is, e.g. "Button", "Text field", "Image". */
  kind: string
  /** What it says or is called, e.g. "View details"; '' when nothing does. */
  label: string
  /** Where it is, to follow "in": "Revenue", "the navigation"; '' if unclear. */
  place: string
}

export function describeElement(el: Element): ElementName {
  // The paths and shapes of an icon are the icon, as far as anyone is
  // concerned.
  const target = el instanceof SVGElement ? outermostSvg(el) : el
  const kind = kindOf(target)
  const label = truncate(labelOf(target, kind), LABEL_LIMIT)
  const place = placeOf(target)
  return { kind, label, place: place === label ? '' : place }
}

/**
 * The best name for a comment saved before names existed, from the tag and
 * text it was saved with. Nothing saved says where the element was.
 */
export function nameFromSaved(tagName: string, text: string): ElementName {
  return {
    kind: KIND_BY_TAG.get(tagName) ?? (text ? 'Text' : 'Element'),
    label: truncate(text, LABEL_LIMIT),
    place: '',
  }
}

/** The whole name on one line: Button “View details” in Revenue. */
export function formatName(name: ElementName): string {
  const what = name.label ? `${name.kind} “${name.label}”` : name.kind
  return name.place ? `${what} in ${name.place}` : what
}

/**
 * The name as elements, for the tool's UI to style: the kind quietly, the
 * label in bold, the place on a line of its own.
 */
export function buildName(name: ElementName): HTMLElement {
  const el = document.createElement('span')
  el.className = 'sr-name'

  // textContent throughout: every part of a name comes from the page.
  const kind = document.createElement('span')
  kind.className = 'sr-name-kind'
  kind.textContent = name.kind
  el.append(kind)

  if (name.label) {
    const label = document.createElement('span')
    label.className = 'sr-name-label'
    label.textContent = `“${name.label}”`
    el.append(' ', label)
  }

  if (name.place) {
    const place = document.createElement('span')
    place.className = 'sr-name-place'
    place.textContent = `in ${name.place}`
    el.append(place)
  }

  return el
}

// --- kind --------------------------------------------------------------------

/** Maps, not objects: tag and role names come from the page. */
const KIND_BY_ROLE = new Map([
  ['alert', 'Alert'],
  ['alertdialog', 'Dialog'],
  ['article', 'Section'],
  ['banner', 'Header'],
  ['button', 'Button'],
  ['cell', 'Table cell'],
  ['checkbox', 'Checkbox'],
  ['columnheader', 'Table heading'],
  ['combobox', 'Dropdown'],
  ['complementary', 'Sidebar'],
  ['contentinfo', 'Footer'],
  ['dialog', 'Dialog'],
  ['form', 'Form'],
  ['grid', 'Table'],
  ['gridcell', 'Table cell'],
  ['group', 'Group'],
  ['heading', 'Heading'],
  ['img', 'Image'],
  ['link', 'Link'],
  ['list', 'List'],
  ['listbox', 'List'],
  ['listitem', 'List item'],
  ['main', 'Main content'],
  ['menu', 'Menu'],
  ['menubar', 'Menu'],
  ['menuitem', 'Menu item'],
  ['menuitemcheckbox', 'Menu item'],
  ['menuitemradio', 'Menu item'],
  ['navigation', 'Navigation'],
  ['option', 'Option'],
  ['progressbar', 'Progress bar'],
  ['radio', 'Radio button'],
  ['region', 'Section'],
  ['row', 'Table row'],
  ['rowheader', 'Table heading'],
  ['search', 'Search'],
  ['searchbox', 'Search box'],
  ['slider', 'Slider'],
  ['spinbutton', 'Number field'],
  ['status', 'Status message'],
  ['switch', 'Switch'],
  ['tab', 'Tab'],
  ['table', 'Table'],
  ['tablist', 'Tabs'],
  ['tabpanel', 'Tab panel'],
  ['textbox', 'Text field'],
  ['toolbar', 'Toolbar'],
  ['tooltip', 'Tooltip'],
])

const KIND_BY_TAG = new Map([
  ['a', 'Link'],
  ['abbr', 'Text'],
  ['article', 'Section'],
  ['aside', 'Sidebar'],
  ['audio', 'Audio player'],
  ['b', 'Text'],
  ['blockquote', 'Quote'],
  ['body', 'Page'],
  ['button', 'Button'],
  ['canvas', 'Graphic'],
  ['caption', 'Table caption'],
  ['cite', 'Text'],
  ['code', 'Code'],
  ['dd', 'List item'],
  ['details', 'Expandable section'],
  ['dialog', 'Dialog'],
  ['dl', 'List'],
  ['dt', 'List item'],
  ['em', 'Text'],
  ['fieldset', 'Group'],
  ['figcaption', 'Caption'],
  ['figure', 'Figure'],
  ['footer', 'Footer'],
  ['form', 'Form'],
  ['h1', 'Heading'],
  ['h2', 'Heading'],
  ['h3', 'Heading'],
  ['h4', 'Heading'],
  ['h5', 'Heading'],
  ['h6', 'Heading'],
  ['header', 'Header'],
  ['hgroup', 'Heading'],
  ['hr', 'Divider'],
  ['html', 'Page'],
  ['i', 'Text'],
  ['iframe', 'Embedded page'],
  ['img', 'Image'],
  ['input', 'Field'],
  ['kbd', 'Code'],
  ['label', 'Label'],
  ['legend', 'Label'],
  ['li', 'List item'],
  ['main', 'Main content'],
  ['mark', 'Text'],
  ['menu', 'List'],
  ['meter', 'Meter'],
  ['nav', 'Navigation'],
  ['ol', 'List'],
  ['option', 'Option'],
  ['p', 'Text'],
  ['picture', 'Image'],
  ['pre', 'Code block'],
  ['progress', 'Progress bar'],
  ['q', 'Quote'],
  ['s', 'Text'],
  ['samp', 'Code'],
  ['section', 'Section'],
  ['select', 'Dropdown'],
  ['small', 'Text'],
  ['span', 'Text'],
  ['strong', 'Text'],
  ['sub', 'Text'],
  ['summary', 'Toggle'],
  ['sup', 'Text'],
  ['svg', 'Graphic'],
  ['table', 'Table'],
  ['tbody', 'Table'],
  ['td', 'Table cell'],
  ['textarea', 'Text box'],
  ['tfoot', 'Table'],
  ['th', 'Table heading'],
  ['thead', 'Table'],
  ['time', 'Text'],
  ['tr', 'Table row'],
  ['u', 'Text'],
  ['ul', 'List'],
  ['video', 'Video'],
])

const KIND_BY_INPUT_TYPE = new Map([
  ['button', 'Button'],
  ['checkbox', 'Checkbox'],
  ['color', 'Colour picker'],
  ['date', 'Date field'],
  ['datetime-local', 'Date field'],
  ['file', 'File picker'],
  ['image', 'Button'],
  ['month', 'Date field'],
  ['number', 'Number field'],
  ['password', 'Password field'],
  ['radio', 'Radio button'],
  ['range', 'Slider'],
  ['reset', 'Button'],
  ['search', 'Search box'],
  ['submit', 'Button'],
  ['time', 'Time field'],
  ['week', 'Date field'],
])

/** Kinds that go by their title rather than everything written in them. */
const TITLED_KINDS = new Set([
  'Dialog',
  'Figure',
  'Footer',
  'Form',
  'Group',
  'Header',
  'Main content',
  'Navigation',
  'Section',
  'Sidebar',
  'Tab panel',
  'Table',
])

/** Elements that sit inside a line of text rather than making a block. */
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em',
  'i', 'img', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'sup', 'svg', 'time', 'u', 'var', 'wbr',
])

function kindOf(el: Element): string {
  // A role is the page saying what something is. It can list fallbacks
  // after it; the first is the one meant.
  const byRole = KIND_BY_ROLE.get(firstRole(el))
  if (byRole) return byRole

  const tag = el.localName
  if (tag === 'input') {
    const type = el instanceof HTMLInputElement ? el.type : 'text'
    return KIND_BY_INPUT_TYPE.get(type) ?? 'Text field'
  }
  // An <a> without an address is only styled text.
  if (tag === 'a' && !el.hasAttribute('href')) return 'Text'
  if (tag === 'svg') return isIconSized(el) ? 'Icon' : 'Graphic'
  return KIND_BY_TAG.get(tag) ?? genericKind(el)
}

/** A <div>, a custom element: anything whose tag doesn't say what it is. */
function genericKind(el: Element): string {
  if (el.querySelector(HEADINGS)) return 'Section'

  const inlineOnly = Array.from(el.children).every((child) =>
    INLINE_TAGS.has(child.localName),
  )
  if (inlineOnly && collapse(el.textContent ?? '') !== '') return 'Text'
  if (getComputedStyle(el).backgroundImage.includes('url(')) return 'Image'
  return 'Area'
}

function isIconSized(el: Element): boolean {
  const { width, height } = el.getBoundingClientRect()
  return width <= ICON_MAX_PX && height <= ICON_MAX_PX
}

function outermostSvg(el: SVGElement): SVGElement {
  let svg = el
  while (svg.ownerSVGElement) svg = svg.ownerSVGElement
  return svg
}

function firstRole(el: Element): string {
  return el.getAttribute('role')?.trim().split(/\s+/)[0] ?? ''
}

// --- label -------------------------------------------------------------------

function labelOf(el: Element, kind: string): string {
  const named = ariaName(el)
  if (named) return named

  if (isField(el)) return fieldLabel(el)
  if (el.localName === 'img') return attr(el, 'alt') || attr(el, 'title')
  if (el.localName === 'svg') return svgTitle(el) || controlName(el)
  if (kind === 'Page') return collapse(document.title)

  if (TITLED_KINDS.has(kind)) {
    const title = el.querySelector(`${HEADINGS}, caption, legend, figcaption`)
    const text = title ? textOf(title) : ''
    if (text) return text
  }

  return textOf(el) || attr(el, 'title') || pictureName(el)
}

/** The name the page gives an element for screen readers, if any. */
function ariaName(el: Element): string {
  const ids = el.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? []
  const byIds = ids
    .map((id) => {
      const ref = id ? document.getElementById(id) : null
      return ref ? textOf(ref) : ''
    })
    .join(' ')
  return collapse(byIds) || attr(el, 'aria-label')
}

function isField(
  el: Element,
): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  )
}

/** What a field is called: its <label>, or failing that what it shows. */
function fieldLabel(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): string {
  for (const label of el.labels ?? []) {
    const text = labelText(label, el)
    if (text) return text
  }

  if (el instanceof HTMLInputElement) {
    if (el.type === 'submit') return collapse(el.value) || 'Submit'
    if (el.type === 'reset') return collapse(el.value) || 'Reset'
    if (el.type === 'button') return collapse(el.value)
    if (el.type === 'image') return attr(el, 'alt')
  }
  if (el instanceof HTMLSelectElement) {
    return attr(el, 'title') || collapse(el.selectedOptions[0]?.text ?? '')
  }
  return attr(el, 'placeholder') || attr(el, 'title')
}

/**
 * A label's own words. One wrapped round its field would otherwise read the
 * field out too: every option of a dropdown, say.
 */
function labelText(label: HTMLLabelElement, field: Element): string {
  return label.contains(field)
    ? collapse(textBeside(label, field))
    : textOf(label)
}

function textBeside(el: Element, skip: Element): string {
  let text = ''
  for (const child of el.childNodes) {
    if (child === skip) continue
    if (child instanceof Element) {
      text += ` ${child.contains(skip) ? textBeside(child, skip) : textOf(child)}`
    } else if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? ''
    }
  }
  return text
}

function svgTitle(svg: Element): string {
  const title = Array.from(svg.children).find((child) => child.localName === 'title')
  return title ? collapse(title.textContent ?? '') : ''
}

/** An icon on a button or link goes by that button or link: the “Close” icon. */
function controlName(el: Element): string {
  const control = el.closest('a[href], button, [role="button"], [role="link"]')
  if (!control) return ''
  return ariaName(control) || textOf(control) || attr(control, 'title')
}

/** A button or link with only a picture in it goes by the picture's name. */
function pictureName(el: Element): string {
  const img = el.querySelector('img[alt]:not([alt=""])')
  if (img) return attr(img, 'alt')
  const svg = el.querySelector('svg')
  return svg ? svgTitle(svg) : ''
}

function attr(el: Element, name: string): string {
  return collapse(el.getAttribute(name) ?? '')
}

/**
 * An element's visible text, in the case it was written in. Plenty of
 * headings and buttons are put in capitals by CSS, and innerText follows
 * suit: "in REVENUE" reads as shouting, not as the Revenue card.
 */
function textOf(el: Element): string {
  const shown = visibleTextOf(el)
  const written = collapse(el.textContent ?? '')
  return shown.toLowerCase() === written.toLowerCase() ? written : shown
}

// --- place -------------------------------------------------------------------

/** Parts of the page that can be named for screen readers. */
const REGION_TAGS = new Set([
  'article', 'aside', 'fieldset', 'figure', 'footer', 'form', 'header', 'main',
  'nav', 'ol', 'section', 'table', 'ul',
])

const REGION_ROLES = new Set([
  'article', 'banner', 'complementary', 'contentinfo', 'form', 'grid', 'group',
  'list', 'listbox', 'main', 'menu', 'menubar', 'navigation', 'radiogroup',
  'region', 'search', 'table', 'tablist', 'tabpanel', 'toolbar',
])

/**
 * Where an element is: the title of the nearest part of the page around it
 * that has one, and the column, for anything in a table.
 */
function placeOf(el: Element): string {
  let where = ''
  let via = el
  for (
    let around = el.parentElement;
    around && around !== document.documentElement;
    around = around.parentElement
  ) {
    where = titleOf(around, via)
    if (where) break
    via = around
  }

  const column = columnOf(el)
  if (!column) return where
  return where ? `${where}, ${column} column` : `the ${column} column`
}

/**
 * What a part of the page is called, seen from the child of it an element
 * is in; '' when nothing says.
 */
function titleOf(around: Element, via: Element): string {
  const tag = around.localName
  const role = firstRole(around)

  if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') {
    const heading = around.querySelector(HEADINGS)
    const name = ariaName(around) || (heading ? textOf(heading) : '')
    return name ? `the ${clip(name)} dialog` : 'a dialog'
  }

  if (REGION_TAGS.has(tag) || REGION_ROLES.has(role)) {
    const name = clip(ariaName(around))
    if (name) return tag === 'nav' || role === 'navigation' ? `the ${name} navigation` : name
  }

  const heading = leadingHeading(around, via)
  if (heading) return clip(textOf(heading))

  if (tag === 'nav' || role === 'navigation') return 'the navigation'
  if (tag === 'aside' || role === 'complementary') return 'the sidebar'
  if (tag === 'search' || role === 'search') return 'the search area'
  if (role === 'banner' || (tag === 'header' && isPageLevel(around))) return 'the page header'
  if (role === 'contentinfo' || (tag === 'footer' && isPageLevel(around))) return 'the footer'
  return ''
}

/**
 * The heading that leads a part of the page, up to the branch the element is
 * in: one of its own children, or a wrapper holding nothing but a heading.
 * A heading inside a sibling card doesn't count. That card's title is not
 * this element's.
 */
function leadingHeading(around: Element, via: Element): Element | null {
  let found: Element | null = null
  for (const child of around.children) {
    if (child === via) break
    const heading = child.matches(`${HEADINGS}, caption, legend`)
      ? child
      : wrappedHeading(child)
    if (heading && textOf(heading)) found = heading
  }
  return found
}

/** The heading a wrapper is there to hold, or null if it holds more. */
function wrappedHeading(el: Element): Element | null {
  const heading = el.querySelector(HEADINGS)
  if (!heading) return null
  if (el.localName === 'hgroup') return heading
  if (el.localName === 'header' && !isPageLevel(el)) return heading
  // No words in it but the heading's.
  return collapse(el.textContent ?? '') === collapse(heading.textContent ?? '')
    ? heading
    : null
}

/** A <header> or <footer> for the whole page, not for one section of it. */
function isPageLevel(el: Element): boolean {
  return !el.parentElement?.closest('article, aside, main, nav, section')
}

/** A table cell's column heading, e.g. "Plan"; '' when there isn't one. */
function columnOf(el: Element): string {
  const cell = el.closest('td, th')
  const row = cell?.parentElement
  const table = cell?.closest('table')
  if (
    !(cell instanceof HTMLTableCellElement) ||
    !(row instanceof HTMLTableRowElement) ||
    !table
  ) {
    return ''
  }

  // The header row: the table's <thead>, or a first row of nothing but <th>s.
  const first = table.rows[0]
  const head =
    table.tHead?.rows[0] ??
    (first && Array.from(first.cells).every((c) => c.localName === 'th') ? first : null)
  if (!head || head === row) return ''

  const heading = head.cells[cell.cellIndex]
  return heading ? clip(textOf(heading)) : ''
}

function clip(text: string): string {
  return truncate(text, PLACE_LIMIT)
}
