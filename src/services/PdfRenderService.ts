import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface CacheEntry {
  key: string
  promise: Promise<PDFDocumentProxy>
}

const MAX_CACHED = 4
const cache: CacheEntry[] = []

/** Loads a PDF for display with pdf.js. Documents are cached by key (e.g. template id + version). */
export function getPdfDocument(key: string, getBytes: () => Promise<ArrayBuffer>): Promise<PDFDocumentProxy> {
  const hit = cache.find((c) => c.key === key)
  if (hit) {
    cache.splice(cache.indexOf(hit), 1)
    cache.unshift(hit)
    return hit.promise
  }
  const promise = (async () => {
    const data = new Uint8Array(await getBytes())
    try {
      return await pdfjs.getDocument({ data }).promise
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'PasswordException') throw new Error('This PDF is password-protected.')
      if (name === 'InvalidPDFException') throw new Error('This PDF is damaged or invalid.')
      throw err
    }
  })()
  const entry = { key, promise }
  cache.unshift(entry)
  promise.catch(() => {
    const i = cache.indexOf(entry)
    if (i >= 0) cache.splice(i, 1)
  })
  while (cache.length > MAX_CACHED) {
    const old = cache.pop()!
    old.promise.then((d) => d.loadingTask.destroy()).catch(() => {})
  }
  return promise
}

export function evictPdfDocument(prefix: string): void {
  for (let i = cache.length - 1; i >= 0; i--) {
    if (cache[i].key.startsWith(prefix)) {
      const [old] = cache.splice(i, 1)
      old.promise.then((d) => d.loadingTask.destroy()).catch(() => {})
    }
  }
}

const tasks = new WeakMap<HTMLCanvasElement, RenderTask>()

/**
 * Renders a page so that one PDF point equals `zoom` CSS pixels.
 * Returns the page size in points (rotation applied).
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  zoom: number,
): Promise<{ width: number; height: number } | null> {
  const page = await doc.getPage(pageNumber)
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const base = page.getViewport({ scale: 1 })
  // Cap the backing store to keep memory reasonable on phones.
  const maxPixels = 16_000_000
  let scale = zoom * dpr
  if (base.width * base.height * scale * scale > maxPixels) {
    scale = Math.sqrt(maxPixels / (base.width * base.height))
  }
  const viewport = page.getViewport({ scale })
  tasks.get(canvas)?.cancel()
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${base.width * zoom}px`
  canvas.style.height = `${base.height * zoom}px`
  const task = page.render({ canvas, viewport })
  tasks.set(canvas, task)
  try {
    await task.promise
  } catch (err) {
    if ((err as { name?: string })?.name === 'RenderingCancelledException') return null
    throw err
  } finally {
    if (tasks.get(canvas) === task) tasks.delete(canvas)
  }
  return { width: base.width, height: base.height }
}

export async function createThumbnail(pdfBytes: ArrayBuffer, width = 360): Promise<Blob | undefined> {
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes) }).promise
    try {
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, viewport }).promise
      return await new Promise<Blob | undefined>((resolve) =>
        canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.85),
      )
    } finally {
      await doc.loadingTask.destroy()
    }
  } catch {
    return undefined
  }
}
