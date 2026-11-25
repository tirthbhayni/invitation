import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Loader2 } from 'lucide-react'
import { renderPage } from '@/services/PdfRenderService'
import { drawLayoutToCanvas, type TextLayout } from '@/services/TextLayoutService'
import type { NameField, PageDimension } from '@/types'

export interface TextLayer {
  field: NameField
  layout: TextLayout
}

/**
 * Renders one PDF page at `zoom` CSS pixels per point and paints personalized
 * text on a separate canvas using the same geometry as the PDF generator.
 */
export function PageView({
  doc,
  pageNumber,
  pageSize,
  zoom,
  layers = [],
  children,
  onError,
}: {
  doc: PDFDocumentProxy | null
  pageNumber: number
  pageSize: PageDimension
  zoom: number
  layers?: TextLayer[]
  children?: ReactNode
  onError?: (message: string) => void
}) {
  const pageCanvas = useRef<HTMLCanvasElement>(null)
  const textCanvas = useRef<HTMLCanvasElement>(null)
  const [rendering, setRendering] = useState(true)
  const width = pageSize.width * zoom
  const height = pageSize.height * zoom

  useEffect(() => {
    if (!doc || !pageCanvas.current || zoom <= 0) return
    let cancelled = false
    setRendering(true)
    const handle = window.setTimeout(() => {
      renderPage(doc, pageNumber, pageCanvas.current!, zoom)
        .then((r) => {
          if (!cancelled && r) setRendering(false)
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setRendering(false)
            onError?.(err instanceof Error ? err.message : 'Could not render this page.')
          }
        })
    }, 30)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [doc, pageNumber, zoom, onError])

  useEffect(() => {
    const canvas = textCanvas.current
    if (!canvas || zoom <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const w = Math.max(1, Math.floor(width * dpr))
    const h = Math.max(1, Math.floor(height * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.setTransform(zoom * dpr * (w / (width * dpr)), 0, 0, zoom * dpr * (h / (height * dpr)), 0, 0)
    for (const { field, layout } of layers) {
      if (field.pageNumber === pageNumber) drawLayoutToCanvas(ctx, layout, field)
    }
  }, [layers, zoom, width, height, pageNumber])

  return (
    <div
      className="relative shrink-0 bg-white shadow-sm ring-1 ring-black/10"
      style={{ width, height }}
      data-testid="page-view"
    >
      <canvas ref={pageCanvas} className="absolute inset-0 block" aria-hidden />
      <canvas
        ref={textCanvas}
        className="pointer-events-none absolute inset-0 block"
        style={{ width, height }}
        aria-hidden
      />
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
          <Loader2 className="size-6 animate-spin text-neutral-500" aria-label="Loading page" />
        </div>
      )}
      {children}
    </div>
  )
}
