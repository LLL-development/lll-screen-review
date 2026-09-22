import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'

/**
 * Dev-only API route for the AI clarification step.
 *
 * The API key and endpoint stay in this file's world — the Node process
 * running the dev server — and never reach the browser. That is the whole
 * reason this route exists: the frontend posts to /api/clarify, and only the
 * server knows where the request actually goes or what credentials it carries.
 *
 * Deliberately NOT a VITE_ variable: Vite injects those into client code,
 * which would publish the key to anyone who opens devtools.
 *
 * This runs only under `npm run dev`. A production build has no server, so
 * shipping this for real means a proper backend later.
 */

/** How long to wait on the model before giving up. Local models can be slow. */
const TIMEOUT_MS = 45_000

type ClarifyConfig = {
  baseUrl: string
  model: string
  apiKey: string
}

type AskResult =
  | { status: 'clear' }
  | { status: 'question'; question: string; options: string[] }

function clarifyPlugin(env: Record<string, string>): Plugin {
  const config: ClarifyConfig = {
    baseUrl: (env.CLARIFY_BASE_URL ?? '').replace(/\/$/, ''),
    model: env.CLARIFY_MODEL ?? '',
    apiKey: env.CLARIFY_API_KEY ?? '',
  }

  // Configured means "there is somewhere to send this". A key is required for
  // remote endpoints but not for a model running on this machine, which has
  // nothing to authenticate against.
  const configured = Boolean(config.baseUrl && config.model)

  return {
    name: 'screen-review:clarify',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/clarify', (req, res) => {
        res.setHeader('Content-Type', 'application/json')

        if (req.method === 'GET') {
          void handleStatus(config, configured, res)
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Use GET for status or POST to ask.' }))
          return
        }

        if (!configured) {
          res.statusCode = 503
          res.end(
            JSON.stringify({
              error:
                'Clarification is not configured. See .env.example for the variables to set.',
            }),
          )
          return
        }

        void handleAsk(config, req, res)
      })
    },
  }
}

/**
 * Says whether the feature is set up, and whether the model is actually
 * answering right now, so the UI can hide or disable the button instead of
 * offering something that will fail.
 */
async function handleStatus(
  config: ClarifyConfig,
  configured: boolean,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const reachable = configured ? await isReachable(config) : false
  res.statusCode = 200
  res.end(JSON.stringify({ configured, reachable, model: config.model }))
}

async function isReachable(config: ClarifyConfig): Promise<boolean> {
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: authHeaders(config),
      signal: AbortSignal.timeout(2500),
    })
    return response.ok
  } catch {
    // Not running, wrong port, no network: all the same answer here.
    return false
  }
}

async function handleAsk(
  config: ClarifyConfig,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  try {
    const body = await readJson(req)
    const action = body.action === 'compose' ? 'compose' : 'ask'

    const messages =
      action === 'ask' ? askMessages(body) : composeMessages(body)

    const reply = await callModel(config, messages)

    res.statusCode = 200
    res.end(
      JSON.stringify(
        action === 'ask' ? parseAsk(reply) : { requirement: parseCompose(reply) },
      ),
    )
  } catch (error) {
    // Anything at all going wrong here is reported as a failed clarification,
    // never as a broken page: the tool has to keep working without the AI.
    res.statusCode = 502
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Clarification failed.',
      }),
    )
  }
}

// --- prompts ----------------------------------------------------------------

const ASK_SYSTEM = `You help turn vague UI feedback into a clear, actionable request.

You are given an element on a web page and a reviewer's comment about it.
Decide whether the comment is specific enough for someone to act on without
guessing.

Reply with JSON and nothing else:
- If it is already clear: {"status":"clear"}
- If it is not: {"status":"question","question":"<one short question>","options":["<likely reading>","<likely reading>"]}

Rules:
- Ask at most ONE question, under 20 words, about this specific element.
- Ground it in the element's text and surroundings, not generic UX advice.
- Give 2 or 3 options only when you can name genuinely likely readings; use [] otherwise.
- Never decide what the reviewer meant. Only ask.`

const COMPOSE_SYSTEM = `You combine a reviewer's original comment with their answer to a follow-up
question into one short, concrete requirement.

Reply with JSON and nothing else: {"requirement":"<one or two sentences>"}

Rules:
- Say what should change about this element, in plain language.
- Use only what the reviewer actually said. Add no new requirements.
- No preamble, no restating the question.
- A person will review and edit your wording, so keep it short and plain.`

function elementBlock(body: Record<string, unknown>): string {
  const context = (body.context ?? {}) as Record<string, unknown>
  return [
    `Selector: ${String(body.selector ?? '')}`,
    `Tag: <${String(context.tagName ?? '')}>`,
    `Element text: ${String(context.text ?? '')}`,
    `Nearby text: ${String(context.nearbyText ?? '')}`,
  ].join('\n')
}

function askMessages(body: Record<string, unknown>) {
  return [
    { role: 'system' as const, content: ASK_SYSTEM },
    {
      role: 'user' as const,
      content: `${elementBlock(body)}\n\nReviewer's comment: ${String(body.comment ?? '')}`,
    },
  ]
}

function composeMessages(body: Record<string, unknown>) {
  return [
    { role: 'system' as const, content: COMPOSE_SYSTEM },
    {
      role: 'user' as const,
      content: [
        elementBlock(body),
        '',
        `Original comment: ${String(body.comment ?? '')}`,
        `Question asked: ${String(body.question ?? '')}`,
        `Reviewer's answer: ${String(body.answer ?? '')}`,
      ].join('\n'),
    },
  ]
}

// --- talking to the model ---------------------------------------------------

function authHeaders(config: ClarifyConfig): Record<string, string> {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}
}

async function callModel(
  config: ClarifyConfig,
  messages: { role: 'system' | 'user'; content: string }[],
): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // "fetch failed" tells the reviewer nothing, so say what was being called
    // and what to check.
    throw new Error(
      error instanceof Error && error.name === 'TimeoutError'
        ? `${config.model} did not answer within ${TIMEOUT_MS / 1000}s.`
        : `Could not reach the model at ${config.baseUrl}. Is it running?`,
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Model returned ${response.status}. ${detail.slice(0, 200)}`.trim(),
    )
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Model returned an empty reply.')
  return content
}

// --- reading the model's reply ----------------------------------------------

/**
 * Models wrap JSON in prose or code fences more often than anyone would like,
 * so pull out the first object rather than trusting the whole string.
 */
function extractJson(reply: string): Record<string, unknown> | null {
  const direct = tryParse(reply)
  if (direct) return direct

  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  return tryParse(reply.slice(start, end + 1))
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text.trim())
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function parseAsk(reply: string): AskResult {
  const parsed = extractJson(reply)

  // An unreadable reply is treated as "nothing to ask" rather than an error:
  // the reviewer can still save the comment they already wrote.
  if (!parsed || parsed.status !== 'question') return { status: 'clear' }

  const question = typeof parsed.question === 'string' ? parsed.question.trim() : ''
  if (!question) return { status: 'clear' }

  const options = Array.isArray(parsed.options)
    ? parsed.options
        .filter((o): o is string => typeof o === 'string')
        .map((o) => o.trim())
        .filter(Boolean)
        .slice(0, 3)
    : []

  return { status: 'question', question, options }
}

function parseCompose(reply: string): string {
  const parsed = extractJson(reply)
  const requirement =
    parsed && typeof parsed.requirement === 'string' ? parsed.requirement : ''

  // Fall back to the raw reply so a badly formatted answer still gives the
  // reviewer something to edit rather than an empty box.
  return (requirement || reply).trim()
}

async function readJson(
  req: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)

  const raw = Buffer.concat(chunks).toString('utf8')
  const parsed = tryParse(raw)
  if (!parsed) throw new Error('Request body was not JSON.')
  return parsed
}

export default defineConfig(({ mode }) => ({
  // The empty prefix loads variables without a VITE_ prefix too. They stay in
  // this Node process; nothing here is handed to the client bundle.
  plugins: [clarifyPlugin(loadEnv(mode, process.cwd(), ''))],
}))
