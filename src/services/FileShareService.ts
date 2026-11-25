/** Triggers a real browser download for a Blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser time to start the download before releasing memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function toPdfFile(blob: Blob, fileName: string): File {
  return new File([blob], fileName, { type: 'application/pdf', lastModified: Date.now() })
}

export function canShareFiles(file?: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false
  }
  const probe = file ?? new File([new Uint8Array([37, 80, 68, 70])], 'probe.pdf', { type: 'application/pdf' })
  try {
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'needs_gesture' | 'failed'

/**
 * Opens the native share sheet with the PDF. The user picks WhatsApp (or any app);
 * the browser cannot preselect a WhatsApp contact.
 */
export async function shareFile(file: File): Promise<ShareOutcome> {
  if (!canShareFiles(file)) return 'unsupported'
  try {
    await navigator.share({ files: [file], title: file.name })
    return 'shared'
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'AbortError') return 'cancelled'
    if (name === 'NotAllowedError') return 'needs_gesture'
    if (name === 'DataError' || name === 'TypeError') {
      // Some targets reject a title alongside files; retry with the file only.
      try {
        await navigator.share({ files: [file] })
        return 'shared'
      } catch (e) {
        return (e as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'failed'
      }
    }
    return 'failed'
  }
}