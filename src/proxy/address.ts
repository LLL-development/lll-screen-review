/**
 * The address that loads a page through the proxy (see server/proxy.ts).
 *
 * Always a full address on purpose: on a proxied page, a <base> tag sends
 * relative addresses like "/proxy?…" to the real site instead of to us.
 */
export function proxyAddress(pageUrl: string, runScripts: boolean): string {
  const params = new URLSearchParams({ url: pageUrl })
  if (!runScripts) params.set('scripts', 'off')
  return `${location.origin}/proxy?${params}`
}
