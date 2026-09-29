/**
 * The address that loads a page through the proxy (see server/proxy.ts).
 *
 * Always a full address on purpose: on a proxied page, a <base> tag sends
 * relative addresses like "/proxy?…" to the real site instead of to us.
 *
 * A #section stays on the end of our address rather than going to the
 * server inside it, so the browser scrolls to that section once the page is
 * in, as it would on the real site.
 */
export function proxyAddress(pageUrl: string, runScripts: boolean): string {
  const [page, hash = ''] = splitHash(pageUrl)
  const params = new URLSearchParams({ url: page })
  if (!runScripts) params.set('scripts', 'off')
  return `${location.origin}/proxy?${params}${hash}`
}

function splitHash(address: string): [string, string?] {
  const at = address.indexOf('#')
  return at === -1 ? [address] : [address.slice(0, at), address.slice(at)]
}
