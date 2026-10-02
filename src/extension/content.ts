/// <reference types="chrome" />

import {
  setPageUrl,
  setReviewMode,
  startReviewTool,
  stopReviewTool,
} from '../review/review'
import { setClarifySender, type ClarifyResponse } from '../review/clarify'
import { UI_ATTR } from '../review/ui'

/**
 * The browser extension's half that runs inside the page.
 *
 * extension/background.js puts this on a tab when you switch the extension
 * on there, and again on each page of the site you go on to in that tab. It
 * starts the review tool the same way the test page and the proxy do, and
 * the tool can't tell the difference. What is particular to the extension:
 *
 * - Switching on turns review mode on too, since that is what you clicked
 *   for. On later pages, review mode is as you left it.
 * - Switching off takes the tool off the page altogether.
 * - A single-page app moving to another page doesn't load one, so this
 *   watches the address and tells the tool.
 * - The AI step's requests go through the extension. This script runs as
 *   part of someone else's page, which isn't allowed to call the dev server.
 */

/** Message types, shared with extension/background.js. */
const START = 'screen-review:start'
const STOP = 'screen-review:stop'
const CLARIFY = 'screen-review:clarify'

type BackgroundReply = ClarifyResponse | { unreachable: true }

// The background script checks before injecting this, but a click and a page
// finishing loading can both pass that check before either has put anything
// on the page.
if (!document.querySelector(`[${UI_ATTR}]`)) start()

function start(): void {
  setClarifySender(sendThroughExtension)
  startReviewTool({ pageUrl: location.href })
  const stopWatching = watchAddress()

  const onMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: () => void,
  ) => {
    const type = (message as { type?: unknown } | null)?.type
    if (type === START) {
      setReviewMode(true)
    } else if (type === STOP) {
      stopReviewTool()
      stopWatching()
      chrome.runtime.onMessage.removeListener(onMessage)
    } else {
      return
    }
    sendResponse()
  }
  chrome.runtime.onMessage.addListener(onMessage)
}

/**
 * Tells the tool whenever the address changes without a new page loading.
 * The Navigation API says so straight away, in the browsers that have it
 * (Chrome, Edge, Brave); checking twice a second catches it everywhere else.
 * Returns a function that stops watching.
 */
function watchAddress(): () => void {
  let last = location.href
  const check = () => {
    if (location.href === last) return
    last = location.href
    setPageUrl(last)
  }

  const timer = setInterval(check, 500)
  if ('navigation' in window) navigation.addEventListener('currententrychange', check)

  return () => {
    clearInterval(timer)
    if ('navigation' in window) navigation.removeEventListener('currententrychange', check)
  }
}

async function sendThroughExtension(
  body?: Record<string, unknown>,
): Promise<ClarifyResponse> {
  let reply: BackgroundReply | undefined
  try {
    reply = await chrome.runtime.sendMessage({ type: CLARIFY, body })
  } catch {
    // Reloading or updating the extension cuts off the copy of the tool
    // already running in a page.
    throw new Error(
      'Screen Review was reloaded since this page opened. Refresh the page to use the AI step.',
    )
  }

  if (!reply || 'unreachable' in reply) {
    throw new Error(
      "Couldn't reach the dev server at localhost:5173. Is `npm run dev` running?",
    )
  }
  return reply
}
