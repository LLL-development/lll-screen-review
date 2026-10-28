import { mountUi } from './ui'

/** Copies text, saying whether it worked; the panel and ticket review both copy. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // No clipboard API off localhost over plain http, or the browser said
    // no. The old select-and-copy way still works in most of those cases.
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    mountUi(area)
    area.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      area.remove()
    }
  }
}
