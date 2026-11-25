import { useMemo, useState } from 'react'
import { usePdfDocument } from '@/hooks/usePdfDocument'
import { PdfPreview } from './PdfPreview'

let viewerCounter = 0

/** Read-only viewer for a generated PDF Blob. */
export function PdfBlobViewer({ blob, className }: { blob: Blob; className?: string }) {
  const docKey = useMemo(() => `blob:${++viewerCounter}:${blob.size}`, [blob])
  const { doc, error, loading } = usePdfDocument(docKey, blob)
  const [page, setPage] = useState(1)
  return (
    <PdfPreview
      doc={doc}
      error={error}
      loading={loading}
      pageCount={doc?.numPages ?? 1}
      page={page}
      onPageChange={setPage}
      className={className}
      viewportClassName="h-[65dvh]"
      allowFullscreen={false}
    />
  )
}
