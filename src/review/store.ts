/**
 * Where comments live.
 *
 * For now that is a plain array in memory: comments survive as long as the tab
 * is open, and a refresh clears them. This module is the seam where a real
 * backend will eventually plug in — the rest of the tool only ever talks to
 * addComment / getComments / onChange, so swapping the array for a fetch()
 * later does not touch the UI code.
 */

/** One captured piece of feedback. */
export type ReviewComment = {
  id: number
  selector: string
  comment: string
  url: string
  createdAt: string
}

/** What the caller supplies; the store fills in id and createdAt. */
export type NewReviewComment = Omit<ReviewComment, 'id' | 'createdAt'>

let nextId = 1
const comments: ReviewComment[] = []
const listeners = new Set<() => void>()

export function addComment(input: NewReviewComment): ReviewComment {
  const entry: ReviewComment = {
    id: nextId++,
    createdAt: new Date().toISOString(),
    ...input,
  }
  comments.push(entry)
  notify()
  return entry
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

function notify(): void {
  for (const listener of listeners) listener()
}
