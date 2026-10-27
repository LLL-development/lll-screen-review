/**
 * Screenshots: a picture of the page, taken as a comment is saved.
 *
 * Only the browser extension can take one. A browser lets an extension
 * photograph a tab exactly as it is on screen, but a page can't do that to
 * itself without asking to share the screen every time. So the extension
 * hands over a way to take one (setScreenshotTaker), and everywhere else a
 * comment is saved without a picture, as it always was.
 *
 * The page is photographed with the whole tool hidden, and the marking is
 * drawn onto the picture afterwards (annotate): everything but the comment's
 * elements dimmed, each one outlined and numbered like its pin, and a caption
 * underneath with the comment, the element, the page and the date. Drawn, not
 * photographed, so it is the same on every site, in a colour of its own that
 * never looks like the live tool, and the picture says what it is about once
 * it's downloaded or attached to a ticket.
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

/** A picture of the window, and where a comment's elements were in it. */
export type Screenshot = {
  image: Blob
  /** Each element's box in the window, in CSS pixels, as the picture was taken. */
  boxes: DOMRect[]
  /** The window's size then, in CSS pixels; the picture is in device pixels. */
  view: { width: number; height: number }
}

/** What the caption under a picture says. */
export type Caption = {
  /** The comment's number, the same as on its pin. */
  number: number
  comment: string
  /** The element as the panel names it: Image in Hero, + 2 more. */
  about: string
  url: string
  /** When the comment was made, as an ISO date. */
  when: string
}

/**
 * Photographs the page, for a comment about to be saved on these elements.
 * Null when there is no picture to be had: not in the extension, the tab no
 * longer showing. The comment is saved either way, so nothing here throws.
 */
export async function takeScreenshot(
  elements: readonly Element[],
): Promise<Screenshot | null> {
  if (!taker) return null
  const take = taker

  setCapturing(true)
  try {
    // The tool has to be gone from the screen, not just marked hidden, before
    // the picture is taken.
    return await withTimeout(
      nextPaint().then(async () => {
        // Measured at the moment of the picture, so the marking lands on the
        // elements wherever the page had moved them.
        const boxes = elements
          .filter((el) => el.isConnected)
          .map((el) => el.getBoundingClientRect())
        const view = { width: window.innerWidth, height: window.innerHeight }
        return { image: await take(), boxes, view }
      }),
    )
  } catch (error) {
    console.warn('[Screen Review] comment saved without a screenshot:', error)
    return null
  } finally {
    setCapturing(false)
  }
}

/**
 * Marks up a picture for its comment and keeps it. Returns the id it is kept
 * under, or null when storage refused. Should the marking fail, the plain
 * picture is kept instead: it still shows the page.
 */
export async function keepScreenshot(
  shot: Screenshot,
  caption: Caption,
): Promise<string | null> {
  try {
    const image = await withTimeout(annotate(shot, caption)).catch((error: unknown) => {
      console.warn('[Screen Review] screenshot kept without its marking:', error)
      return shot.image
    })
    const id = newId()
    await withTimeout(write(id, image))
    return id
  } catch (error) {
    console.warn("[Screen Review] the screenshot couldn't be kept:", error)
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

// --- marking up a picture ---------------------------------------------------

/** Not the tool's blue: a picture should never look like the live tool. */
const MARK = '#f43f5e'
/** Laid over everything but the elements, so the eye goes straight to them. */
const SHADE = 'rgb(15 20 35 / 45%)'
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
/** Room left around each element, in CSS pixels, so the outline doesn't cover it. */
const PADDING = 4
const CAPTION_HEIGHT = 60

/**
 * The picture with the comment drawn on it, as a JPEG. The caption goes in a
 * strip under the page, not over it, so it never hides what it describes.
 */
async function annotate(shot: Screenshot, caption: Caption): Promise<Blob> {
  const bitmap = await createImageBitmap(shot.image)
  // The picture is in device pixels and the boxes in CSS pixels; on a
  // high-density screen, or zoomed in, they differ.
  const scale = bitmap.width / shot.view.width
  const px = (n: number) => Math.round(n * scale)
  const width = bitmap.width
  const height = bitmap.height

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height + px(CAPTION_HEIGHT)
  const context = contextOf(canvas)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()

  // Only the part of each element that was in the window; one scrolled right
  // out of it has nothing to mark.
  const boxes = shot.boxes.flatMap((rect) => {
    const left = Math.max(0, px(rect.left - PADDING))
    const top = Math.max(0, px(rect.top - PADDING))
    const right = Math.min(width, px(rect.right + PADDING))
    const bottom = Math.min(height, px(rect.bottom + PADDING))
    return right > left && bottom > top ? [{ left, top, right, bottom }] : []
  })
  const radius = px(6)
  const trace = (c: CanvasRenderingContext2D, b: (typeof boxes)[number]) => {
    c.beginPath()
    c.roundRect(b.left, b.top, b.right - b.left, b.bottom - b.top, radius)
  }

  if (boxes.length > 0) {
    // On a layer of its own, holes cut where the elements are: dimming each
    // box's surroundings in turn would dim the other boxes too.
    const shade = document.createElement('canvas')
    shade.width = width
    shade.height = height
    const layer = contextOf(shade)
    layer.fillStyle = SHADE
    layer.fillRect(0, 0, width, height)
    layer.globalCompositeOperation = 'destination-out'
    // Opaque, or each hole would only take away part of the shade.
    layer.fillStyle = '#000'
    for (const box of boxes) {
      trace(layer, box)
      layer.fill()
    }
    context.drawImage(shade, 0, 0)

    // White under the colour keeps the outline visible on any background.
    for (const [colour, lineWidth] of [['#fff', px(6)], [MARK, px(3)]] as const) {
      context.strokeStyle = colour
      context.lineWidth = lineWidth
      for (const box of boxes) {
        trace(context, box)
        context.stroke()
      }
    }

    for (const box of boxes) {
      drawBadge(context, String(caption.number), box.left, box.top, px, width, height)
    }
  }

  drawCaption(context, caption, height, width, px)
  return toJpeg(canvas)
}

/** The comment's number in a disc on an element's corner, as on its pin. */
function drawBadge(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: (n: number) => number,
  width: number,
  height: number,
): void {
  context.font = `700 ${px(13)}px ${FONT}`
  const radius = px(13)
  // Wider than a disc once the number has three digits.
  const badgeWidth = Math.max(radius * 2, context.measureText(text).width + px(12))
  // Kept whole on the picture, even for an element in its very corner.
  const left = Math.min(Math.max(0, x - badgeWidth / 2), width - badgeWidth)
  const top = Math.min(Math.max(0, y - radius), height - radius * 2)

  context.beginPath()
  context.roundRect(left, top, badgeWidth, radius * 2, radius)
  context.fillStyle = MARK
  context.fill()
  context.lineWidth = px(2)
  context.strokeStyle = '#fff'
  context.stroke()

  context.fillStyle = '#fff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, left + badgeWidth / 2, top + radius + px(1))
}

/**
 * The strip under the page: the comment on one line, then what it is on,
 * where, and when.
 */
function drawCaption(
  context: CanvasRenderingContext2D,
  caption: Caption,
  top: number,
  width: number,
  px: (n: number) => number,
): void {
  const height = px(CAPTION_HEIGHT)
  context.fillStyle = '#16181f'
  context.fillRect(0, top, width, height)
  context.fillStyle = MARK
  context.fillRect(0, top, px(4), height)

  const left = px(18)
  const right = width - px(18)
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'

  context.font = `700 ${px(15)}px ${FONT}`
  const number = `#${caption.number}`
  context.fillStyle = MARK
  context.fillText(number, left, top + px(26))

  const textLeft = left + context.measureText(number).width + px(8)
  context.font = `600 ${px(15)}px ${FONT}`
  context.fillStyle = '#fff'
  // A comment written over several lines reads as one here.
  const comment = caption.comment.replace(/\s+/g, ' ').trim()
  context.fillText(fit(context, comment, right - textLeft), textLeft, top + px(26))

  const when = new Date(caption.when)
  const details = [
    caption.about,
    caption.url,
    Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  ].filter(Boolean)
  context.font = `${px(12)}px ${FONT}`
  context.fillStyle = '#a3a9b6'
  context.fillText(fit(context, details.join('  ·  '), right - left), left, top + px(47))
}

/** The text, cut short with an ellipsis if it is wider than maxWidth. */
function fit(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (context.measureText(`${text.slice(0, middle)}…`).width <= maxWidth) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, low).trimEnd()}…`
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas to draw on')
  return context
}

/** About the size of the picture the browser took, and as easy to read. */
function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The picture couldn't be encoded"))),
      'image/jpeg',
      0.85,
    )
  })
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
