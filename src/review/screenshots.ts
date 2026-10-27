/**
 * Screenshots: a picture of the page, taken as a comment is saved.
 *
 * Only the browser extension can take one. A browser lets an extension
 * photograph a tab exactly as it is on screen, but a page can't do that to
 * itself without asking to share the screen every time. So the extension
 * hands over a way to take one (setScreenshotTaker), and everywhere else a
 * comment is saved without a picture, as it always was.
 *
 * The picture is taken with the comment box, panel, pill and pins hidden, but
 * the outlines left on, so it shows the page with what the comment is about
 * marked on it.
 *
 * Pictures are kept in IndexedDB, not with the comments in localStorage.
 * localStorage holds about 5 MB for the whole site, the site's own data
 * included, and a screenshot is a few hundred KB: a couple of dozen would
 * fill it, and the site's own saving would start failing. IndexedDB has room
 * for thousands. A comment keeps only its screenshot's id.
 *
 * Like the comments, the pictures stay in this browser, in the site's own
 * storage, until there is a backend.
 */

import { setCapturing } from './ui'

/** Takes a picture of the tab as it is on screen; rejects when it can't. */
export type ScreenshotTaker = () => Promise<Blob>

let taker: ScreenshotTaker | null = null

/** Set by the browser extension, the one place a screenshot can be taken. */
export function setScreenshotTaker(take: ScreenshotTaker): void {
  taker = take
}

/** Whether saving a comment takes a screenshot here. */
export function canTakeScreenshots(): boolean {
  return taker !== null
}

/**
 * How long taking or keeping a picture gets before the comment is saved
 * without one. Both normally take a fraction of a second.
 */
const TIMEOUT_MS = 3000

/**
 * Takes a screenshot of the page and keeps it, for a comment about to be
 * saved. Returns its id, or null when there is no picture to be had: not in
 * the extension, the tab no longer showing, storage refusing. The comment is
 * saved either way, so nothing here throws.
 */
export async function takeScreenshot(): Promise<string | null> {
  if (!taker) return null
  const take = taker

  let image: Blob
  setCapturing(true)
  try {
    // The tool's own pieces have to be gone from the screen, not just marked
    // hidden, before the picture is taken.
    image = await withTimeout(nextPaint().then(take))
  } catch (error) {
    console.warn('[Screen Review] comment saved without a screenshot:', error)
    return null
  } finally {
    setCapturing(false)
  }

  try {
    const id = newId()
    await withTimeout(write(id, image))
    return id
  } catch (error) {
    console.warn("[Screen Review] comment saved without a screenshot; it couldn't be kept:", error)
    return null
  }
}

/** A comment's screenshot, or null when this browser doesn't have it. */
export async function loadScreenshot(id: string): Promise<Blob | null> {
  try {
    const image = await read(id)
    return image instanceof Blob ? image : null
  } catch {
    return null
  }
}

/** Throws a deleted comment's screenshot away. */
export function deleteScreenshot(id: string): void {
  void remove(id).catch(() => {
    // Nothing worse than a picture nobody can reach, until site data is
    // cleared.
  })
}

/**
 * A comment's screenshot as the comment reader shows it: small, opening full
 * size when clicked, with a link to keep a copy.
 *
 * Drawn onto a canvas rather than put in an <img>. An <img> would need an
 * address for the picture, and plenty of sites' security rules (their
 * Content-Security-Policy) block images from addresses they don't know.
 * Nothing blocks a canvas.
 */
export function buildScreenshot(id: string, commentId: number): HTMLElement {
  const figure = document.createElement('figure')
  figure.className = 'sr-shot'
  figure.textContent = 'Loading screenshot…'

  void (async () => {
    const image = await loadScreenshot(id)
    if (!image) {
      // Cleared with the site's data, or left in another browser.
      figure.textContent = 'The screenshot isn’t in this browser.'
      return
    }

    let thumbnail: HTMLCanvasElement
    try {
      thumbnail = await drawImage(image, THUMBNAIL_WIDTH)
    } catch {
      figure.textContent = 'The screenshot couldn’t be shown.'
      return
    }

    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'sr-shot-open'
    open.title = 'See it full size'
    open.setAttribute('aria-label', 'See the screenshot full size')
    open.append(thumbnail)
    open.addEventListener('click', () => void showFullSize(figure, image))

    const download = document.createElement('button')
    download.type = 'button'
    download.className = 'sr-shot-download'
    download.textContent = 'Download'
    // The picture gets an address only for the moment it takes to start the
    // download, so a reader left open doesn't hold it in memory twice.
    download.addEventListener('click', () => {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(image)
      link.download = `comment-${commentId}${extensionFor(image)}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
    })

    figure.replaceChildren(open, download)
  })()

  return figure
}

/** Twice the width it's shown at in the reader, so it stays sharp. */
const THUMBNAIL_WIDTH = 600

/** The picture over the whole window, until it's clicked. */
async function showFullSize(figure: HTMLElement, image: Blob): Promise<void> {
  if (figure.querySelector('.sr-shot-full')) return

  let canvas: HTMLCanvasElement
  try {
    canvas = await drawImage(image)
  } catch {
    return
  }

  const overlay = document.createElement('div')
  overlay.className = 'sr-shot-full'
  overlay.title = 'Click to close'
  overlay.append(canvas)
  overlay.addEventListener('click', () => overlay.remove())
  // Inside the reader, so closing the reader takes it away too.
  figure.append(overlay)
}

/** The picture on a canvas, scaled down to maxWidth if it is wider. */
async function drawImage(image: Blob, maxWidth = Infinity): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image)
  const scale = Math.min(1, maxWidth / bitmap.width)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const context = canvas.getContext('2d')
  if (context) {
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }
  bitmap.close()
  return canvas
}

function extensionFor(image: Blob): string {
  return image.type === 'image/png' ? '.png' : '.jpg'
}

// --- helpers ----------------------------------------------------------------

/**
 * Resolves once the browser has drawn what was just changed. One frame
 * starts the drawing; by the second it is on screen.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** The promise, or a rejection once TIMEOUT_MS has passed without it. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), TIMEOUT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * An id no other screenshot has, on this site or any other loaded through
 * the proxy, which all share one storage. Not the comment's number: those are
 * only unique within a site. getRandomValues rather than randomUUID, which
 * pages on plain http don't have.
 */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// --- IndexedDB --------------------------------------------------------------

/** Named so it can't be mistaken for anything the site keeps there itself. */
const DB_NAME = 'screen-review:screenshots'
const STORE = 'screenshots'

let opening: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => {
      const db = request.result
      // A newer copy of the tool, in another tab, needs it closed to change it.
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
  // Failing once shouldn't mean failing for good: the next call tries again.
  opening.catch(() => (opening = null))
  return opening
}

/** Runs one request in its own transaction, resolving once it is kept. */
async function run<T>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const pending = request(transaction.objectStore(STORE))
    transaction.oncomplete = () => resolve(pending.result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function write(id: string, image: Blob): Promise<IDBValidKey> {
  return run('readwrite', (store) => store.put(image, id))
}

function read(id: string): Promise<unknown> {
  return run('readonly', (store) => store.get(id))
}

function remove(id: string): Promise<undefined> {
  return run('readwrite', (store) => store.delete(id))
}
