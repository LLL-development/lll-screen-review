import { startReviewTool } from '../review/review'
import { proxyAddress } from './address'

/**
 * Runs inside a page loaded through the proxy (see server/proxy.ts), which
 * added a <script> tag pointing here. Starts the review tool on that page and
 * keeps link clicks inside the proxy.
 *
 * This is the only piece that knows about the proxy. The review tool itself
 * just gets told which page it is looking at.
 */

/** The page's real address, after redirects, as the proxy saw it. */
const pageUrl =
  document.querySelector<HTMLMetaElement>('meta[name="screen-review-page"]')
    ?.content || document.baseURI

const runScripts = new URLSearchParams(location.search).get('scripts') !== 'off'

startReviewTool({ pageUrl })
keepLinksInProxy()

console.info(
  `[Screen Review] reviewing ${pageUrl} through the proxy.`,
  runScripts
    ? "Errors from the site's own scripts are normal here: they now run from localhost, and the site's server turns some of their requests away."
    : 'Site scripts are off, so "Refused to load the script" errors are expected.',
)

/**
 * Links on the page point at the real site — that is what the <base> tag
 * does — so following one would leave the proxy and the review tool behind.
 * Plain link clicks load the next page through the proxy instead.
 *
 * Review mode never gets here: it swallows clicks before the page sees them.
 */
function keepLinksInProxy(): void {
  window.addEventListener('click', (event) => {
    // The page's own code already dealt with it (a menu, a tab), or it's a
    // Ctrl/Shift-click asking for a new tab: leave those alone.
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const link =
      event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(link instanceof HTMLAnchorElement)) return
    if (link.target && link.target !== '_self') return
    if (link.hasAttribute('download')) return

    let url: URL
    try {
      url = new URL(link.href)
    } catch {
      return
    }
    // mailto:, tel: and friends do their usual thing.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return

    event.preventDefault()

    // A jump within this same page, like href="#pricing": just scroll.
    if (url.hash && sameDocument(url.href, pageUrl)) {
      location.hash = url.hash
      return
    }

    location.assign(proxyAddress(url.href, runScripts))
  })
}

function sameDocument(a: string, b: string): boolean {
  return a.split('#')[0] === b.split('#')[0]
}
