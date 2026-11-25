import { useEffect, useRef, useState } from 'react'
import type { NameField } from '@/types'
import { layoutField, type TextLayout } from '@/services/TextLayoutService'

/** Everything that affects text layout; position and rotation do not. */
function layoutKey(f: NameField, guestName: string): string {
  return JSON.stringify([
    guestName,
    f.width,
    f.height,
    f.fontId,
    f.fontSize,
    f.minimumFontSize,
    f.fontColor,
    f.fontWeight,
    f.fontStyle,
    f.underline,
    f.alignment,
    f.verticalAlignment,
    f.letterSpacing,
    f.lineSpacing,
    f.prefix,
    f.suffix,
    f.autoFit,
    f.multiline,
    f.textTransform,
  ])
}

export interface FieldLayoutsState {
  layouts: Map<string, TextLayout>
  loading: boolean
  error: string | null
}

/**
 * Computes text layouts for fields. Results from older inputs are discarded so
 * the preview never shows a stale name.
 */
export function useFieldLayouts(fields: NameField[] | undefined, guestName: string): FieldLayoutsState {
  const [state, setState] = useState<FieldLayoutsState>({ layouts: new Map(), loading: true, error: null })
  const cache = useRef(new Map<string, TextLayout>())

  useEffect(() => {
    if (!fields) return
    let cancelled = false
    const keys = fields.map((f) => layoutKey(f, guestName))
    if (keys.every((k) => cache.current.has(k))) {
      setState({ layouts: new Map(fields.map((f, i) => [f.id, cache.current.get(keys[i])!])), loading: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true }))
    Promise.all(
      fields.map(async (f, i) => {
        let layout = cache.current.get(keys[i])
        if (!layout) {
          layout = await layoutField(f, guestName)
          if (cache.current.size > 200) cache.current.clear()
          cache.current.set(keys[i], layout)
        }
        return [f.id, layout] as const
      }),
    )
      .then((entries) => {
        if (!cancelled) setState({ layouts: new Map(entries), loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }))
      })
    return () => {
      cancelled = true
    }
  }, [fields, guestName])

  return state
}
