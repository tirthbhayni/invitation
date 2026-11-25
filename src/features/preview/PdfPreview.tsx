import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { AlertTriangle, ChevronLeft, ChevronRight, Expand, Loader2, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useElementSize } from '@/hooks/useElementWidth'
import type { PageDimension } from '@/types'
import { PageView, type TextLayer } from './PageView'
import { cn } from '@/lib/utils'
import { clamp } from '@/utils/units'

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export interface PdfPreviewProps {
  doc: PDFDocumentProxy | null
  loading?: boolean
  error?: string | null
  pageCount: number
  pageDimensions?: PageDimension[]
  layers?: TextLayer[]
  page: number
  onPageChange: (page: number) => void
  className?: string
  /** Height of the scroll viewport, e.g. "70vh". */
  viewportClassName?: string
  title?: string
  allowFullscreen?: boolean
  overlay?: ReactNode
}

function usePageSize(doc: PDFDocumentProxy | null, page: number, dims?: PageDimension[]): PageDimension | null {
  const [size, setSize] = useState<PageDimension | null>(null)
  const known = dims?.[page - 1]
  useEffect(() => {
    if (known || !doc) return
    let cancelled = false
    doc.getPage(page).then((p) => {
      const vp = p.getViewport({ scale: 1 })
      if (!cancelled) setSize({ width: vp.width, height: vp.height })
    })
    return () => {
      cancelled = true
    }
  }, [doc, page, known])
  return known ?? size
}

function PreviewBody({
  doc,
  loading,
  error,
  pageCount,
  pageDimensions,
  layers,
  page,
  onPageChange,
  viewportClassName,
  onFullscreen,
  overlay,
}: PdfPreviewProps & { onFullscreen?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null)
  const { width: vw, height: vh } = useElementSize(viewport)
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit')
  const [renderError, setRenderError] = useState<string | null>(null)
  const pageSize = usePageSize(doc, page, pageDimensions)

  const fitZoom = pageSize && vw > 0 ? Math.max(0.1, Math.min((vw - 24) / pageSize.width, vh > 0 ? (vh - 24) / pageSize.height : Infinity)) : 1
  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode
  const onError = useCallback((m: string) => setRenderError(m), [])

  const stepZoom = (dir: 1 | -1) => {
    const current = zoom
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > current + 0.01) : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.01)
    setZoomMode(next ?? (dir > 0 ? 4 : 0.25))
  }

  const shownError = error ?? renderError
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="min-w-16 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">
            Page {page} / {pageCount || 1}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => stepZoom(-1)} aria-label="Zoom out">
            <ZoomOut />
          </Button>
          <button
            type="button"
            className="min-w-12 rounded px-1 text-xs text-muted-foreground tabular-nums hover:bg-accent"
            onClick={() => setZoomMode(1)}
            title="Reset zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button variant="ghost" size="icon-sm" onClick={() => stepZoom(1)} aria-label="Zoom in">
            <ZoomIn />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setZoomMode('fit')} aria-label="Fit to screen" title="Fit to screen">
            <Maximize />
          </Button>
          {onFullscreen && (
            <Button variant="ghost" size="icon-sm" onClick={onFullscreen} aria-label="Fullscreen preview" title="Fullscreen">
              <Expand />
            </Button>
          )}
        </div>
      </div>
      <div
        ref={viewport}
        className={cn(
          'relative h-[60vh] min-h-72 overflow-auto bg-neutral-100 dark:bg-neutral-900',
          viewportClassName,
        )}
      >
        {shownError ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
            <AlertTriangle className="size-6" />
            {shownError}
          </div>
        ) : loading || !doc || !pageSize ? (
          <div className="flex h-full min-h-48 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading preview" />
          </div>
        ) : (
          <div className="flex min-h-full min-w-fit items-center justify-center p-3">
            <PageView doc={doc} pageNumber={page} pageSize={pageSize} zoom={clamp(zoom, 0.05, 6)} layers={layers} onError={onError} />
          </div>
        )}
        {overlay}
      </div>
    </div>
  )
}

export function PdfPreview(props: PdfPreviewProps) {
  const [fullscreen, setFullscreen] = useState(false)
  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card', props.className)}>
      <PreviewBody {...props} onFullscreen={props.allowFullscreen !== false ? () => setFullscreen(true) : undefined} />
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[95dvh] w-[98vw] max-w-[98vw] flex-col gap-0 p-0 sm:max-w-[98vw]">
          <DialogTitle className="sr-only">{props.title ?? 'Invitation preview'}</DialogTitle>
          <DialogDescription className="sr-only">Full screen invitation preview</DialogDescription>
          <div className="flex min-h-0 flex-1 flex-col pt-10">
            <PreviewBody {...props} viewportClassName="h-auto min-h-0 flex-1" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
