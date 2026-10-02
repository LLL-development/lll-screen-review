/**
 * The browser extension's background script, a service worker.
 *
 * The toolbar icon (or Alt+Shift+R) switches Screen Review on or off for the
 * current tab. On puts the review tool on the page with review mode on; off
 * takes it off again. While it is on, each page of the site you go to in that
 * tab gets the tool too, so you can review a site page by page and go back
 * to comments left on other pages.
 *
 * The extension asks for "activeTab", which grants access to a tab's site
 * when you click the icon, rather than to every site you visit. That keeps
 * the install free of the "read and change all your data on all websites"
 * warning, and is why going to a different site switches the tool off: the
 * click doesn't reach that far.
 *
 * It also carries the AI step's requests to the dev server. The tool runs
 * inside someone else's page, and the browser treats its requests as that
 * page's own, so a call to localhost is refused. This script belongs to the
 * extension, and host_permissions lets it call localhost.
 *
 * Plain JavaScript on purpose: it is copied into the extension as it is,
 * with nothing in between to compile it.
 */

/** Where `npm run dev` serves the AI step, on Vite's default port. */
const CLARIFY_URL = 'http://localhost:5173/api/clarify'

/** Message types, shared with src/extension/content.ts. */
const START = 'screen-review:start'
const STOP = 'screen-review:stop'
const CLARIFY = 'screen-review:clarify'

const OFF_TITLE = chrome.runtime.getManifest().action.default_title
const ON_TITLE = 'Screen Review is on: click to switch it off'

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void switchTool(tab.id)
})

/** On for this tab if it is off; off if it is on. */
async function switchTool(tabId) {
  const running = await isRunning(tabId)
  if (running === null) {
    // Browser pages, the Chrome Web Store and the built-in PDF viewer are
    // off limits to every extension.
    await showProblem(tabId, "Screen Review can't run on this page")
    return
  }

  try {
    if (running) {
      await chrome.tabs.sendMessage(tabId, { type: STOP })
    } else {
      await inject(tabId)
      await chrome.tabs.sendMessage(tabId, { type: START })
    }
  } catch {
    // The tool is there, but nothing of ours is listening: it's the page's
    // own copy, like the local test page's, or one left behind when the
    // extension was reloaded.
    await showProblem(
      tabId,
      'This page has a copy of the review tool the extension didn\'t start. Use its own "Review mode" pill, or refresh the page.',
    )
    return
  }

  await remember(tabId, !running)
  await showState(tabId, !running)
}

/**
 * A page finished loading in a tab the tool is on: put the tool back, with
 * review mode as it was (content.ts sees to that). A page brought back by
 * Back or Forward still has it, and is left alone.
 */
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void restore(tabId)
})

chrome.tabs.onRemoved.addListener((tabId) => void remember(tabId, false))

async function restore(tabId) {
  if (!(await tabsOn()).has(tabId)) return

  const running = await isRunning(tabId)
  if (running === null) {
    // Gone to another site, or to a page no extension may touch.
    await remember(tabId, false)
    await showState(tabId, false)
    return
  }

  try {
    if (!running) await inject(tabId)
    await showState(tabId, true)
  } catch {
    // The tab moved on again before the tool was in; its next page load
    // comes back here.
  }
}

/**
 * Whether the tool is on the page: true or false, or null when the extension
 * isn't allowed to look.
 */
async function isRunning(tabId) {
  try {
    const [check] = await chrome.scripting.executeScript({
      target: { tabId },
      // The tool marks everything it puts on the page with this attribute.
      func: () => document.querySelector('[data-screen-review-ui]') !== null,
    })
    return check?.result === true
  } catch {
    return null
  }
}

async function inject(tabId) {
  const target = { tabId }
  await chrome.scripting.insertCSS({ target, files: ['content.css'] })
  await chrome.scripting.executeScript({ target, files: ['content.js'] })
}

/**
 * The tabs the tool is on, kept in session storage: the service worker is
 * shut down whenever it is idle and would forget, and the list should go
 * when the browser closes.
 */
async function tabsOn() {
  const { tabsOn = [] } = await chrome.storage.session.get('tabsOn')
  return new Set(tabsOn)
}

async function remember(tabId, on) {
  const tabs = await tabsOn()
  if (on) tabs.add(tabId)
  else tabs.delete(tabId)
  await chrome.storage.session.set({ tabsOn: [...tabs] })
}

/** "ON" on the icon for a tab the tool is on, and nothing otherwise. */
async function showState(tabId, on) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2f5bd7' })
  await chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' })
  await chrome.action.setTitle({ tabId, title: on ? ON_TITLE : OFF_TITLE })
}

/** A "!" on the icon for this tab, with the reason on hover. */
async function showProblem(tabId, message) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#b4261f' })
  await chrome.action.setBadgeText({ tabId, text: '!' })
  await chrome.action.setTitle({ tabId, title: message })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== CLARIFY) return false

  void askDevServer(message.body).then(sendResponse)
  // The answer comes later; returning true keeps sendResponse usable.
  return true
})

/**
 * One request to the AI step: a GET for its status when there is no body,
 * a POST with it otherwise. Answers in the shape src/review/clarify.ts
 * expects, or with { unreachable: true } when the dev server isn't running.
 * Only ever this one address, so a page can't use the extension to reach
 * anything else.
 */
async function askDevServer(body) {
  try {
    const response = await fetch(
      CLARIFY_URL,
      body && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    const data = await response.json().catch(() => ({}))
    return { ok: response.ok, status: response.status, data }
  } catch {
    return { unreachable: true }
  }
}
