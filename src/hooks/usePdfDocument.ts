import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getPdfDocument } from '@/services/PdfRenderService'

export function usePdfDocument(
  key: string | null,
  blob: Blob | null | undefined,
): { doc: PDFDocumentProxy | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ key: string | null; doc: PDFDocumentProxy | null; error: string | null }>({
    key: null,
    doc: null,
    error: null,
  })

  useEffect(() => {
    if (!key || !blob) return
    let cancelled = false
    getPdfDocument(key, () => blob.arrayBuffer())
      .then((doc) => !cancelled && setState({ key, doc, error: null }))
      .catch((err: unknown) => !cancelled && setState({ key, doc: null, error: err instanceof Error ? err.message : String(err) }))
    return () => {
      cancelled = true
    }
  }, [key, blob])

  const current = state.key === key
  return {
    doc: current ? state.doc : null,
    error: current ? state.error : null,
    loading: !!key && !!blob && !current,
  }
}
