import { startReviewTool } from '../review/review'
import { proxyAddress } from './address'

/**
 * Runs inside a page loaded through the proxy (see server/proxy.ts), which
 * added a <script> tag pointing here. Starts the review tool on that page and
 * keeps you inside the proxy as you move around the site.
 *
 * This is the only piece that knows about the proxy. The review tool itself
 * just gets told which page it is looking at.
 */

/** The page's real address, after redirects, as the proxy saw it. */
const pageUrl =
  document.querySelector<HTMLMetaElement>('meta[name="screen-review-page"]')
    ?.content || document.baseURI

const runScripts = new URLSearchParams(location.search).get('scripts') !== 'off'

startReviewTool({
  pageUrl,
  // Going to a comment left on another page: through the proxy, like
  // every other way of moving around the site.
  goToPage: (url) => location.assign(proxyAddress(url, runScripts)),
})
keepNavigationInProxy()
scrollToSection()

console.info(
  `[Screen Review] reviewing ${pageUrl} through the proxy.`,
  runScripts
    ? "Errors from the site's own scripts are normal here: they now run from localhost, and the site's server turns some of their requests away."
    : 'Site scripts are off, so "Refused to load the script" errors are expected.',
)

/**
 * Everything on the page points at the real site — that is what the <base>
 * tag does — so following a link, sending a search, or a script moving the
 * page on would all leave the proxy and the review tool behind. Each of those
 * loads the next page through the proxy instead.
 *
 * Review mode never gets here for clicks: it swallows them before the page
 * sees them.
 */
function keepNavigationInProxy(): void {
  keepNewTabsInProxy()

  if ('navigation' in window) {
    // The Navigation API (Chrome and Edge have it): one event for every way
    // the page can move on, including form.submit() from a script, which
    // fires no submit event.
    navigation.addEventListener('navigate', onNavigate)
  } else {
    keepLinksInProxy()
    keepFormsInProxy()
  }
}

function onNavigate(event: NavigateEvent): void {
  // Reloads, Back and Forward stay on our own addresses; downloads and
  // navigations the page isn't allowed to stop go ahead as they are.
  if (!event.cancelable || event.downloadRequest !== null) return
  if (event.navigationType !== 'push' && event.navigationType !== 'replace') return

  // A form that sends data — a login, a contact form — can't be replayed
  // through the proxy, which only ever fetches pages. It goes to the real
  // site, as it always did.
  if (event.formData) return

  const url = httpUrl(event.destination.url)
  // Not a web page, or already one of our own addresses.
  if (!url || url.origin === location.origin) return

  event.preventDefault()
  go(url, event.navigationType === 'replace')
}

/**
 * A link opened in a new tab — target="_blank", Ctrl/Cmd/Shift-click, the
 * middle button — would open the real site there, without the tool. The new
 * tab gets the proxied page instead.
 */
function keepNewTabsInProxy(): void {
  const open = (event: MouseEvent) => {
    if (event.defaultPrevented || event.altKey) return

    const newTab =
      event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey
    const link =
      event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(link instanceof HTMLAnchorElement)) return
    if (link.hasAttribute('download')) return
    if (!newTab && (!link.target || link.target === '_self')) return

    const url = httpUrl(link.href)
    if (!url) return

    event.preventDefault()
    window.open(proxyAddress(url.href, runScripts), '_blank', 'noopener')
  }

  window.addEventListener('click', open)
  // The middle button fires auxclick, not click.
  window.addEventListener('auxclick', (event) => {
    if (event.button === 1) open(event)
  })
}

/** Without the Navigation API: plain link clicks. */
function keepLinksInProxy(): void {
  window.addEventListener('click', (event) => {
    // The page's own code already dealt with it (a menu, a tab), or it's a
    // new-tab click, which keepNewTabsInProxy handles.
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const link =
      event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(link instanceof HTMLAnchorElement)) return
    if (link.target && link.target !== '_self') return
    if (link.hasAttribute('download')) return

    // mailto:, tel: and friends do their usual thing.
    const url = httpUrl(link.href)
    if (!url) return

    event.preventDefault()
    go(url)
  })
}

/**
 * Without the Navigation API: forms that fetch a page, like a search box
 * (method="get"). Their answers go on the end of the address, so the proxy
 * can load them like any other page.
 */
function keepFormsInProxy(): void {
  window.addEventListener('submit', (event) => {
    const form = event.target
    if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return

    const url = formAddress(form, event.submitter)
    if (!url) return

    event.preventDefault()
    go(url)
  })

  // A script calling form.submit() skips the submit event altogether, which
  // is how plenty of search boxes send what you typed.
  const submit = HTMLFormElement.prototype.submit
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    const url = formAddress(this, null)
    if (url) go(url)
    else submit.call(this)
  }
}

/**
 * Where a form that fetches a page would go, or null for any other form (one
 * that sends data, or opens somewhere else).
 */
function formAddress(form: HTMLFormElement, submitter: HTMLElement | null): URL | null {
  // The button pressed can override the form's own method, action and
  // target, and its name and value are sent too.
  const button =
    submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
      ? submitter
      : null

  const method = button?.hasAttribute('formmethod') ? button.formMethod : form.method
  const target = button?.hasAttribute('formtarget') ? button.formTarget : form.target
  if (method !== 'get' || (target && target !== '_self')) return null

  const url = httpUrl(button?.hasAttribute('formaction') ? button.formAction : form.action)
  if (!url) return null

  // What a browser does for a GET form: the fields replace the query.
  // A file field sends only its file's name.
  const fields = [...new FormData(form, button)].map(
    ([name, value]): [string, string] => [name, typeof value === 'string' ? value : value.name],
  )
  url.search = new URLSearchParams(fields).toString()
  return url
}

/**
 * The first page through the proxy arrives by a reload (see the worker setup
 * page in server/proxy.ts), and a reload stays at the top instead of going to
 * the #section in the address. Go there once the page is in — unless the
 * browser already did, or you have scrolled since.
 */
function scrollToSection(): void {
  if (!location.hash) return

  const go = () => {
    if (scrollY !== 0) return
    let id = location.hash.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch {
      // A stray % in the address: look the id up as it is written.
    }
    document.getElementById(id)?.scrollIntoView()
  }

  // Not on load itself: the browser puts a reloaded page back at its old
  // scroll position as loading ends, which would undo this.
  window.addEventListener('load', () => setTimeout(go, 100), { once: true })
}

/** Loads a page from the real site through the proxy. */
function go(url: URL, replace = false): void {
  // A jump within this same page, like href="#pricing": just scroll.
  if (url.hash && sameDocument(url.href, pageUrl)) {
    location.hash = url.hash
    return
  }

  const next = proxyAddress(url.href, runScripts)
  if (replace) location.replace(next)
  else location.assign(next)
}

/** The address as a URL if it is a web page (http or https), otherwise null. */
function httpUrl(address: string): URL | null {
  try {
    const url = new URL(address)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function sameDocument(a: string, b: string): boolean {
  return a.split('#')[0] === b.split('#')[0]
}
