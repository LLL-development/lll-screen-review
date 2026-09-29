import './start.css'
import { proxyAddress } from '../proxy/address'

/**
 * The start screen: where you paste the address of a page to review.
 *
 * This is the app around the review tool, not the tool itself — nothing in
 * src/review/ depends on it, and the test page never loads it.
 */

const form = document.querySelector('#load-form') as HTMLFormElement
const input = document.querySelector('#page-url') as HTMLInputElement
const runScripts = document.querySelector('#run-scripts') as HTMLInputElement
const button = form.querySelector('button[type="submit"]') as HTMLButtonElement
const message = document.querySelector('#load-message') as HTMLElement

// Coming back from the error page's "Try another address": the address that
// failed is already filled in, ready to fix.
const params = new URLSearchParams(location.search)
input.value = params.get('url') ?? ''
runScripts.checked = params.get('scripts') !== 'off'

form.addEventListener('submit', (event) => {
  // The form never submits for real; we decide where to go from here.
  event.preventDefault()

  const url = normalizeUrl(input.value)
  if (!url) {
    showMessage(
      "That doesn't look like a web address. Try something like https://example.com",
      'error',
    )
    input.focus()
    return
  }

  // The proxy is part of the dev server; a built copy of the app has none.
  if (!import.meta.env.DEV) {
    showMessage(
      'Loading other sites only works while running `npm run dev`.',
      'error',
    )
    return
  }

  // Show the cleaned-up address, so "example.com" visibly becomes the
  // https:// address that will actually be loaded.
  input.value = url
  button.disabled = true
  button.textContent = 'Loading…'
  showMessage('Fetching the page — this can take a few seconds.', 'info')

  location.assign(proxyAddress(url, runScripts.checked))
})

// Pressing Back from a loaded page can restore this screen exactly as it was
// left, mid-"Loading…". Put it back to normal.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return
  button.disabled = false
  button.textContent = 'Load page'
  showMessage('', 'info')
})

/**
 * Turns what was typed into a full http(s) address, or null if it can't be one.
 *
 * People paste "example.com" far more often than "https://example.com", so a
 * missing scheme gets https:// added rather than being rejected.
 */
function normalizeUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text)
    ? text
    : `https://${text}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  // A bare word like "google" parses as a valid address but is almost always
  // a typo or a search term, so catch it here rather than after a slow
  // failed load.
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null

  return url.href
}

function showMessage(text: string, kind: 'info' | 'error'): void {
  // textContent, not innerHTML: the address is whatever was typed.
  message.textContent = text
  message.dataset.kind = kind
}
