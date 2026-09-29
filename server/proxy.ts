import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

/**
 * Dev-only route that loads another site's page so the review tool can run on it.
 *
 * Why it exists: the review tool has to read and draw over the page it
 * reviews, and browsers only allow that when the page and the script come
 * from the same origin (scheme + host + port). A page on localhost:5173 cannot
 * reach into a page from example.com, and most sites refuse to sit in an
 * iframe anyway. That rule is what stops any site you visit from reading your
 * email in a hidden frame, so there is no switch to turn it off — and it is a
 * browser rule, not a permission anyone could grant.
 *
 * The server is not a browser and has no such rule. So GET /proxy?url=... has
 * this dev server fetch the page itself and hand the HTML back as one of ours:
 *
 *   browser ──/proxy?url=…──► dev server ──fetch──► the real site
 *      ▲                           │
 *      └── HTML + <base> + tool ◄──┘
 *
 * - <base href> points the page's relative addresses (CSS, images, scripts)
 *   back at the real site, so they still load from there.
 * - A <script> tag loads src/proxy/inject.ts, which starts the review tool.
 *
 * What it can't do: this is the HTML the site's server sends, which suits
 * static and server-rendered pages (blogs, docs, marketing sites, Wikipedia).
 * It does NOT work well for:
 * - Single-page apps that build the page in the browser. Their scripts now
 *   run at localhost, so their calls home are blocked as cross-origin, and
 *   their routers see "/proxy" instead of their own path.
 * - Pages behind a login. The fetch carries none of your cookies, so you get
 *   the logged-out page.
 * - Sites that block automated fetching. Bot protection sees a server, not a
 *   person, and often refuses.
 * - Fonts and module scripts the site only lets its own pages use (CORS).
 * Reviewing arbitrary live sites properly takes a browser extension: an
 * extension is granted permission to run inside any page, on the real site,
 * logged in, with nothing re-hosted.
 *
 * Security: unless scripts=off, the site's own scripts run on our origin too,
 * so they can do what our pages can — read saved comments, call /api/clarify.
 * Only load sites you trust. The route also refuses anything but a top-level
 * page load, so those scripts can't use it to read other addresses through
 * us. It only exists under `npm run dev`, which listens on this machine only;
 * starting it with --host would open it to your whole network.
 */

/** Long enough for a slow site, short enough that a dead one isn't a hang. */
const TIMEOUT_MS = 15_000

/** Where the page's real address goes, for src/proxy/inject.ts to read. */
const PAGE_URL_META = 'screen-review-page'

const BROWSER_HEADERS = {
  // Plenty of sites turn away requests that don't look like a browser's.
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

type PageResult =
  | { ok: true; html: string; url: URL }
  | { ok: false; status: number; reason: string }

export function proxyPlugin(): Plugin {
  return {
    name: 'screen-review:proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/proxy', (req, res) => {
        handleProxy(server, req, res).catch(() => {
          // Last line of defence: nothing a website does should take the dev
          // server down or leave a blank screen.
          sendErrorPage(res, 500, 'Something went wrong on our side.', '')
        })
      })
    },
  }
}

async function handleProxy(
  server: ViteDevServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end()
    return
  }

  // Browsers say what a request is for. Anything but a whole-page load — a
  // fetch() or iframe from a proxied site's own scripts — is turned away.
  const dest = req.headers['sec-fetch-dest']
  if (dest && dest !== 'document') {
    res.statusCode = 403
    res.end()
    return
  }

  // Mounted at /proxy, so req.url is just the "/?url=…" part.
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams
  const raw = params.get('url') ?? ''
  const target = parseTarget(raw)
  if (!target) {
    sendErrorPage(res, 400, "That doesn't look like a web address.", raw)
    return
  }

  const page = await fetchPage(target)
  if (!page.ok) {
    sendErrorPage(res, page.status, page.reason, target.href)
    return
  }

  const scheme = server.config.server.https ? 'https' : 'http'
  const ourOrigin = `${scheme}://${req.headers.host}`

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (params.get('scripts') === 'off') {
    // Only scripts from our own origin may run: the review tool yes, the
    // site's own code no. The browser logs each one it blocks.
    res.setHeader('Content-Security-Policy', "script-src 'self'")
  }
  res.end(prepareHtml(page.html, page.url, ourOrigin))
}

function parseTarget(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

// --- fetching ---------------------------------------------------------------

async function fetchPage(target: URL): Promise<PageResult> {
  // One timeout for the whole thing: connecting, waiting, and reading the
  // body, so a page that starts arriving but never finishes still gives up.
  const signal = AbortSignal.timeout(TIMEOUT_MS)

  try {
    const response = await fetch(target, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal,
    })

    if (!response.ok) {
      void response.body?.cancel()
      return { ok: false, status: 502, reason: describeStatus(response.status) }
    }

    const type = response.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
      void response.body?.cancel()
      return {
        ok: false,
        status: 502,
        reason: `That address is a file (${type.split(';')[0]}), not a web page.`,
      }
    }

    const bytes = await response.arrayBuffer()
    // After redirects: http → https, example.com → www.example.com, and so on.
    return { ok: true, html: decodeHtml(bytes, type), url: new URL(response.url) }
  } catch (error) {
    return describeNetworkError(error)
  }
}

/**
 * Most pages are UTF-8, but not all. Reading an old windows-1252 page as UTF-8
 * turns every accented letter into junk, so use the charset the page declares.
 */
function decodeHtml(bytes: ArrayBuffer, contentType: string): string {
  // latin1 maps every byte to a character, so it is safe for a first peek.
  const start = new TextDecoder('latin1').decode(bytes.slice(0, 2048))
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(start)?.[1]

  try {
    return new TextDecoder(declared ?? 'utf-8').decode(bytes)
  } catch {
    // An encoding name nobody recognises.
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function describeStatus(status: number): string {
  if (status === 401 || status === 403) {
    return `The site refused to hand over this page (error ${status}). It may block automated loading, or need a login.`
  }
  if (status === 404 || status === 410) {
    return `The site says this page doesn't exist (error ${status}). Check the address.`
  }
  if (status === 429) {
    return 'The site says we asked too often (error 429). Wait a minute and try again.'
  }
  if (status >= 500) {
    return `The site answered with a server error (${status}). Some sites answer this way when they block automated loading.`
  }
  return `The site answered with error ${status}.`
}

/** Node's fetch reports every network problem as "fetch failed"; dig out which. */
function describeNetworkError(error: unknown): PageResult {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause
  const code = typeof cause?.code === 'string' ? cause.code : ''

  // Our own timeout, or Node giving up on connecting before it fires.
  if (
    (error instanceof Error && error.name === 'TimeoutError') ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return {
      ok: false,
      status: 504,
      reason: "The site didn't answer in time. It may be down, or unreachable from here.",
    }
  }

  let reason = "Couldn't connect to the site."
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    reason = "Couldn't find a site at that address. Check the spelling."
  } else if (code === 'ECONNREFUSED') {
    reason =
      "Nothing answered at that address. If it's a site on your own machine, is it running?"
  } else if (/CERT|SSL|TLS/i.test(code)) {
    reason = "The site's security certificate isn't valid, so it wasn't loaded."
  } else if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') {
    reason = 'The site hung up on us. It may block automated loading.'
  }

  return { ok: false, status: 502, reason }
}

// --- rewriting --------------------------------------------------------------

/** Adds our tags to the top of <head> and strips what would fight them. */
function prepareHtml(html: string, page: URL, ourOrigin: string): string {
  // Only the first <base> on a page counts, so ours has to replace any the
  // page has — but it should still point where the page's own one did.
  const ownBase = /<base\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(html)?.[1]
  const base = resolveOr(ownBase, page)

  const cleaned = html
    .replace(/<base\b[^>]*>/gi, '')
    // A security policy written for the real site. Here it would block our
    // script, or the site's own ones, which now count as a different origin.
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '')

  const tags = [
    `<base href="${escapeHtml(base)}">`,
    // Some sites refuse to serve images to other sites' pages, which they
    // spot from the Referer header. Sending none gets most of them through.
    '<meta name="referrer" content="no-referrer">',
    `<meta name="${PAGE_URL_META}" content="${escapeHtml(page.href)}">`,
    // A full address, not "/src/…": the <base> above would otherwise send a
    // root-relative path to the real site instead of to us.
    `<script type="module" src="${escapeHtml(`${ourOrigin}/src/proxy/inject.ts`)}"></script>`,
  ].join('')

  return insertAfterFirst(cleaned, [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i], tags)
}

function resolveOr(href: string | undefined, page: URL): string {
  if (!href) return page.href
  try {
    return new URL(href, page).href
  } catch {
    return page.href
  }
}

/**
 * Inserts right after the first tag that matches. <head> and <html> are both
 * optional in HTML, and the browser files leading <base>/<meta>/<script> into
 * the head anyway. The doctype must stay first, or the page renders in quirks
 * mode.
 */
function insertAfterFirst(html: string, patterns: RegExp[], snippet: string): string {
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match) {
      const at = match.index + match[0].length
      return html.slice(0, at) + snippet + html.slice(at)
    }
  }
  return snippet + html
}

// --- the friendly error page ------------------------------------------------

function sendErrorPage(
  res: ServerResponse,
  status: number,
  reason: string,
  attempted: string,
): void {
  if (res.headersSent) {
    res.end()
    return
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(errorPage(reason, attempted))
}

function errorPage(reason: string, attempted: string): string {
  // Back to the start screen with the address filled in, ready to fix.
  const retry = attempted ? `/?url=${encodeURIComponent(attempted)}` : '/'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Couldn't load this page — Screen Review</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1b1f2a;
    background: #f6f7f9; line-height: 1.5; }
  main { width: 100%; max-width: 560px; background: #fff; border: 1px solid #e2e5ec;
    border-radius: 12px; padding: 32px; box-sizing: border-box; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 12px; color: #5c6472; }
  .reason { color: #b42318; }
  .address { font-size: 13px; word-break: break-all; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  a { font-size: 14px; padding: 9px 16px; border-radius: 6px; text-decoration: none; }
  .primary { background: #2f5bd7; color: #fff; }
  .secondary { border: 1px solid #e2e5ec; color: #1b1f2a; }
</style>
</head>
<body>
<main>
  <h1>Couldn't load this page</h1>
  <p>It may block external loading or need a login. Try another address, or use the local test page.</p>
  <p class="reason">${escapeHtml(reason)}</p>
  ${attempted ? `<p class="address">${escapeHtml(attempted)}</p>` : ''}
  <div class="actions">
    <a class="primary" href="${escapeHtml(retry)}">Try another address</a>
    <a class="secondary" href="/test-page.html">Open the local test page</a>
  </div>
</main>
</body>
</html>`
}

/** Page and user text goes into our HTML as text, never as markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
