/**
 * The service worker behind the proxy (see server/proxy.ts).
 *
 * A proxied page lives on localhost, but its files stay on the real site.
 * The browser loads most of those without asking the site's permission:
 * stylesheets, images, classic scripts. Module scripts, fonts and fetch()
 * calls are different. They get a CORS check, which the site passes for its
 * own pages and usually fails for a page on localhost. Astro, Vite and most
 * modern builds ship all their code as modules, so without this the page
 * appears but nothing on it works: no menus, no animations, no fonts.
 *
 * This worker sees every request a proxied page makes. The ones that get
 * that check and are bound for the page's own site, it fetches through the
 * dev server instead (GET /proxy-asset) and hands over as if the site had
 * sent them. Everything else goes out untouched.
 *
 * Plain JavaScript on purpose: the dev server hands this file over as it is,
 * with nothing in between to compile it.
 */

self.addEventListener('install', () => {
  // Take over straight away, not after every proxied tab has been closed.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Page loads then carry a header the dev server looks for, which is how
      // it knows a page will come through here.
      self.registration.navigationPreload.enable(),
      self.clients.claim(),
    ]),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.resolve(event.preloadResponse).then(
        (response) => response ?? fetch(request),
      ),
    )
    return
  }

  // Only what the browser would check, only reads, and only other sites.
  if (request.mode !== 'cors') return
  if (request.method !== 'GET' && request.method !== 'HEAD') return
  if (new URL(request.url).origin === self.location.origin) return

  event.respondWith(fetchForPage(event))
})

async function fetchForPage(event) {
  const { request } = event
  const client = await self.clients.get(event.clientId)

  // Some other site entirely: it decides for itself, same as on the real page.
  if (!client || siteOrigin(client.url) !== new URL(request.url).origin) {
    return fetch(request)
  }

  const response = await fetch(
    `/proxy-asset?url=${encodeURIComponent(request.url)}`,
    { method: request.method },
  )

  // A new Response rather than the one above: that one says it came from
  // /proxy-asset, and a module resolves its own imports against where it
  // came from. This one takes the address the page asked for.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/** The real site's origin, read from a proxied page's own address. */
function siteOrigin(pageAddress) {
  try {
    return new URL(new URL(pageAddress).searchParams.get('url') ?? '').origin
  } catch {
    return null
  }
}
