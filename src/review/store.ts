/**
 * Where comments live.
 *
 * They are held in an array and mirrored into localStorage so they survive a
 * refresh.
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

export function addComment(input: NewReviewComment): ReviewComment {
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
  const entry = comments.find((c) => c.id === id)
  if (!entry || entry.status === status) return
  entry.status = status
  notify()
}

export function removeComment(id: number): void {
  const index = comments.findIndex((c) => c.id === id)
  if (index === -1) return
  comments.splice(index, 1)
  notify()
}

/** Read-only so callers cannot push straight into the array behind our back. */
export function getComments(): readonly ReviewComment[] {
  return comments
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

/** Versioned so a future shape change can be told apart from this one. */
const STORAGE_KEY = 'screen-review:comments:v1'
const ID_KEY = 'screen-review:next-id:v1'

/** Which list this page reads and writes; set by loadComments. */
let storageKey = STORAGE_KEY
/** Where the next number to hand out is kept, beside that list. */
let idKey = ID_KEY

/**
 * Restores saved comments. Call once, before anything reads them.
 *
 * Given a page address, that page gets a list of its own, so a comment left
 * on one site never turns up — or pins itself to a lookalike element — on
 * another. Without one, the original shared list is used, which is what the
 * local test page has always had.
 */
export function loadComments(page?: string): void {
  storageKey = page ? `${STORAGE_KEY}:${page}` : STORAGE_KEY
  idKey = page ? `${ID_KEY}:${page}` : ID_KEY
  load()

  // Another tab on the same page reads and writes the same list. Without
  // this, each tab would save over the other's comments with its own, and
  // both would hand out the same numbers. A null key means storage was
  // cleared.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== storageKey && event.key !== idKey) return
    load()
    emit()
  })
}

function save(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(comments))
    localStorage.setItem(idKey, String(nextId))
  } catch {
    // Private windows and full quotas both throw. Losing persistence is not a
    // reason to break the page, so carry on with the in-memory copy.
  }
}

function load(): void {
  comments.length = 0
  nextId = 1

  try {
    const raw = localStorage.getItem(storageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : []

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const entry = toComment(item)
        // Two entries with one number can't both be pinned, resolved or
        // deleted; keep the first.
        if (entry && !comments.some((c) => c.id === entry.id)) comments.push(entry)
      }
    }

    // Carry on numbering past both the highest id restored and the saved
    // counter. The counter matters once the newest comment is deleted: its
    // number may already have been copied somewhere, so it is never reused.
    const saved = Number(localStorage.getItem(idKey))
    nextId = Math.max(
      comments.reduce((max, c) => Math.max(max, c.id), 0) + 1,
      Number.isInteger(saved) ? saved : 1,
    )
  } catch {
    // Anything unreadable is treated as "no saved comments" rather than an
    // error: a corrupt entry should not stop the tool from loading.
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
