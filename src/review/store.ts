/**
 * Where comments live.
 *
 * One list per site, not per page. Every page of a site can list every
 * comment left on it, so one left on the home page can be found, and gone
 * back to, from the About page. Each comment remembers the page it was left
 * on, and only that page pins it: the same selector on another page is a
 * different element.
 *
 * The list is mirrored into localStorage so it survives a refresh.
 *
 * TEMPORARY: localStorage is a stand-in for a real backend, not the plan. It
 * is per-browser and per-device, so nobody else can see what you wrote, and
 * clearing site data wipes it. A server comes later; this module is the seam
 * where it plugs in, because the rest of the tool only ever talks to
 * addComment / setStatus / removeComment / getComments / onChange. Swapping
 * the array for fetch() calls should not touch any UI code.
 */

import type { ElementContext } from './context'

/** Where a comment is in its life: still needs doing, or dealt with. */
export type ReviewStatus = 'open' | 'resolved'

/** One captured piece of feedback. */
export type ReviewComment = {
  id: number
  selector: string
  comment: string
  /** The page it was left on. */
  url: string
  createdAt: string
  status: ReviewStatus
  /** What was on screen at the element when the comment was made. */
  context: ElementContext
  /**
   * The agreed wording after the AI asked a follow-up question, as confirmed
   * by the reviewer. Absent when nobody clarified.
   */
  clarified?: string
}

/** What the caller supplies; the store fills in the rest. */
export type NewReviewComment = Omit<
  ReviewComment,
  'id' | 'createdAt' | 'status'
>

let nextId = 1
const comments: ReviewComment[] = []
const listeners = new Set<() => void>()

/** The site under review, as an origin: https://example.com. */
let site = ''
/** The page under review, as pageKey gives it. */
let page = ''

export function addComment(input: NewReviewComment): ReviewComment {
  // Start from what is saved, not from what this page last saw: another tab,
  // or a page brought back by the Back button, may be behind. Saving its
  // copy would throw away comments added since, and hand out their numbers
  // a second time.
  load()
  const entry: ReviewComment = {
    id: nextId++,
    createdAt: new Date().toISOString(),
    status: 'open',
    ...input,
  }
  comments.push(entry)
  notify()
  return entry
}

export function setStatus(id: number, status: ReviewStatus): void {
  load()
  const entry = comments.find((c) => c.id === id)
  if (entry) entry.status = status
  notify()
}

export function removeComment(id: number): void {
  load()
  const index = comments.findIndex((c) => c.id === id)
  if (index !== -1) comments.splice(index, 1)
  notify()
}

/**
 * Every comment on the site, from every page. Read-only so callers cannot
 * push straight into the array behind our back.
 */
export function getComments(): readonly ReviewComment[] {
  return comments
}

/** Whether a comment was left on the page under review. */
export function isOnThisPage(comment: ReviewComment): boolean {
  return pageKey(comment.url) === page
}

/**
 * The page under review changed without a new one loading, as single-page
 * apps do. Same site, so same list; the views redraw for the new page.
 */
export function setPage(url: string): void {
  const next = pageKey(url)
  if (next === page) return
  page = next
  emit()
}

/**
 * Which page an address is: the address without its #fragment, which only
 * says where on the page you were. Single-page apps that route on the
 * fragment, as in /#/about, are the exception, and keep it.
 */
export function pageKey(url: string): string {
  const at = url.indexOf('#')
  if (at === -1) return url
  const hash = url.slice(at)
  return hash.startsWith('#/') || hash.startsWith('#!') ? url : url.slice(0, at)
}

/** Called whenever the list changes, so the panel can redraw itself. */
export function onChange(listener: () => void): void {
  listeners.add(listener)
}

/** Every mutation ends here, so this is the one place that has to persist. */
function notify(): void {
  save()
  emit()
}

function emit(): void {
  for (const listener of listeners) listener()
}

// --- localStorage (temporary; see the note at the top of the file) ----------

/**
 * Versioned so a future shape change can be told apart from this one. Each
 * site's list is kept under its origin, which matters for the proxy: every
 * site loaded through it shares localhost's storage.
 */
const LIST_KEY = 'screen-review:comments:v2'
const ID_KEY = 'screen-review:next-id:v2'

/** Before version 2: a list per page, and one shared by the local test page. */
const OLD_LIST_KEY = 'screen-review:comments:v1'

/** This site's list, and where its next number is kept; set by loadComments. */
let listKey = LIST_KEY
let idKey = ID_KEY

/**
 * Restores the site's saved comments, for the page at this address. Call
 * once, before anything reads them.
 */
export function loadComments(url: string): void {
  site = originOf(url)
  page = pageKey(url)
  listKey = `${LIST_KEY}:${site}`
  idKey = `${ID_KEY}:${site}`
  adoptOlderLists()
  load()

  window.addEventListener('storage', onStorage)
  window.addEventListener('pageshow', onPageShow)
}

/** Stops listening for changes and telling anyone about them. */
export function unloadComments(): void {
  window.removeEventListener('storage', onStorage)
  window.removeEventListener('pageshow', onPageShow)
  listeners.clear()
}

/**
 * Another tab on the same site changed the list. A null key means storage
 * was cleared.
 */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== listKey && event.key !== idKey) return
  load()
  emit()
}

/**
 * A page brought back by Back or Forward was frozen, not reloaded, and may
 * have missed comments left elsewhere in the meantime.
 */
function onPageShow(event: PageTransitionEvent): void {
  if (!event.persisted) return
  load()
  emit()
}

function save(): void {
  try {
    localStorage.setItem(listKey, JSON.stringify(comments))
    localStorage.setItem(idKey, String(nextId))
  } catch {
    // Private windows and full quotas both throw. Losing persistence is not a
    // reason to break the page, so carry on with the in-memory copy.
  }
}

function load(): void {
  let saved: ReviewComment[]
  let savedId: number
  try {
    saved = parseList(localStorage.getItem(listKey))
    savedId = Number(localStorage.getItem(idKey))
  } catch {
    // Storage that can't be read at all keeps what is in memory, rather than
    // emptying the list every time something is about to change.
    return
  }

  comments.length = 0
  for (const entry of saved) {
    // Two entries with one number can't both be pinned, resolved or
    // deleted; keep the first.
    if (!comments.some((c) => c.id === entry.id)) comments.push(entry)
  }

  // Carry on numbering past both the highest id restored and the saved
  // counter. The counter matters once the newest comment is deleted: its
  // number may already have been copied somewhere, so it is never reused.
  nextId = Math.max(
    comments.reduce((max, c) => Math.max(max, c.id), 0) + 1,
    Number.isInteger(savedId) ? savedId : 1,
  )
}

/**
 * The comments in one saved list. Anything unreadable is treated as "no
 * saved comments" rather than an error: a corrupt entry should not stop the
 * tool from loading.
 */
function parseList(raw: string | null): ReviewComment[] {
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed
    .map(toComment)
    .filter((entry): entry is ReviewComment => entry !== null)
}

/**
 * Brings this site's comments over from version 1's per-page lists, the
 * first time the site is opened since. Numbers were only unique within a
 * page then; where two clash, the later comment gets a new one.
 */
function adoptOlderLists(): void {
  try {
    if (localStorage.getItem(listKey) !== null) return

    const found: ReviewComment[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key === null) continue
      if (key !== OLD_LIST_KEY && !key.startsWith(`${OLD_LIST_KEY}:`)) continue

      // A page's own list is named after its address; the shared list's
      // comments each carry theirs.
      const keyPage = key.slice(OLD_LIST_KEY.length + 1)
      for (const comment of parseList(localStorage.getItem(key))) {
        const url = comment.url || keyPage
        if (url && originOf(url) === site) found.push({ ...comment, url })
      }
    }
    if (found.length === 0) return

    found.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    let next = found.reduce((max, c) => Math.max(max, c.id), 0) + 1
    const taken = new Set<number>()
    for (const comment of found) {
      if (taken.has(comment.id)) comment.id = next++
      taken.add(comment.id)
    }

    localStorage.setItem(listKey, JSON.stringify(found))
    localStorage.setItem(idKey, String(next))
  } catch {
    // Storage can't be read or written: there is nothing to bring over.
  }
}

/** The site an address belongs to, or '' when it isn't an address. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * Turns one unknown value from storage into a comment, or null if it is not
 * one. Storage is text that anything could have written, so nothing from it is
 * trusted without checking.
 */
function toComment(value: unknown): ReviewComment | null {
  if (typeof value !== 'object' || value === null) return null

  const raw = value as Record<string, unknown>
  // Pin numbers: whole and positive, or the pin would read "1.5" or "-3".
  if (typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 1) return null
  if (typeof raw.selector !== 'string') return null
  if (typeof raw.comment !== 'string') return null

  return {
    id: raw.id,
    selector: raw.selector,
    comment: raw.comment,
    url: typeof raw.url === 'string' ? raw.url : '',
    // A date that doesn't parse would show up as "Invalid Date".
    createdAt:
      typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
        ? raw.createdAt
        : new Date().toISOString(),
    status: raw.status === 'resolved' ? 'resolved' : 'open',
    context: toContext(raw.context),
    ...(typeof raw.clarified === 'string' && raw.clarified
      ? { clarified: raw.clarified }
      : {}),
  }
}

/**
 * Comments saved before context existed have none, so missing or malformed
 * context becomes an empty one rather than discarding an otherwise fine
 * comment.
 */
function toContext(value: unknown): ElementContext {
  const empty: ElementContext = {
    tagName: '',
    text: '',
    nearbyText: '',
    viewport: { width: 0, height: 0 },
  }

  if (typeof value !== 'object' || value === null) return empty

  const raw = value as Record<string, unknown>
  const viewport =
    typeof raw.viewport === 'object' && raw.viewport !== null
      ? (raw.viewport as Record<string, unknown>)
      : {}

  return {
    tagName: typeof raw.tagName === 'string' ? raw.tagName : '',
    text: typeof raw.text === 'string' ? raw.text : '',
    nearbyText: typeof raw.nearbyText === 'string' ? raw.nearbyText : '',
    viewport: {
      width: typeof viewport.width === 'number' ? viewport.width : 0,
      height: typeof viewport.height === 'number' ? viewport.height : 0,
    },
  }
}
