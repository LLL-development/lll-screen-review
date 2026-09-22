/**
 * Talking to the clarification route.
 *
 * The browser only ever calls /api/clarify on this same dev server. It does
 * not know which model is behind it, where that model lives, or what key it
 * uses — all of that stays in vite.config.ts, server-side.
 */

import type { ElementContext } from './context'

export type ClarifyStatus = {
  /** There is an endpoint and model configured in .env. */
  configured: boolean
  /** That endpoint answered a moment ago. */
  reachable: boolean
  model: string
}

export type ClarifyQuestion =
  | { status: 'clear' }
  | { status: 'question'; question: string; options: string[] }

export type ClarifyInput = {
  comment: string
  selector: string
  context: ElementContext
}

const OFFLINE: ClarifyStatus = { configured: false, reachable: false, model: '' }

/** Checked once per page load; the answer decides whether the button appears. */
let statusPromise: Promise<ClarifyStatus> | null = null

export function clarifyStatus(): Promise<ClarifyStatus> {
  statusPromise ??= fetchStatus()
  return statusPromise
}

async function fetchStatus(): Promise<ClarifyStatus> {
  try {
    const response = await fetch('/api/clarify')
    if (!response.ok) return OFFLINE

    const data = (await response.json()) as Partial<ClarifyStatus>
    return {
      configured: data.configured === true,
      reachable: data.reachable === true,
      model: typeof data.model === 'string' ? data.model : '',
    }
  } catch {
    // No route at all, e.g. a production build. Treated as "not set up",
    // which hides the feature and leaves everything else working.
    return OFFLINE
  }
}

/** Asks whether the comment needs a follow-up question. */
export async function askForQuestion(
  input: ClarifyInput,
): Promise<ClarifyQuestion> {
  const data = await post({ action: 'ask', ...input })

  if (data.status !== 'question') return { status: 'clear' }

  const question = typeof data.question === 'string' ? data.question : ''
  if (!question) return { status: 'clear' }

  const options = Array.isArray(data.options)
    ? data.options.filter((o): o is string => typeof o === 'string')
    : []

  return { status: 'question', question, options }
}

/**
 * Drafts the combined requirement. The draft is a starting point shown to the
 * reviewer for editing — it is never saved without a person seeing it.
 */
export async function composeRequirement(
  input: ClarifyInput & { question: string; answer: string },
): Promise<string> {
  const data = await post({ action: 'compose', ...input })
  return typeof data.requirement === 'string' ? data.requirement : ''
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch('/api/clarify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = (await response
    .json()
    .catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : `Clarification failed (${response.status}).`,
    )
  }

  return data
}
