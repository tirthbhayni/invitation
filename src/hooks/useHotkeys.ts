import { useEffect, useRef } from 'react'

export interface Hotkey {
  key: string
  ctrl?: boolean
  shift?: boolean
  handler: (e: KeyboardEvent) => void
  /** Fire even while typing in a text field. */
  allowInInputs?: boolean
}

export function useHotkeys(hotkeys: Hotkey[]): void {
  const ref = useRef(hotkeys)
  ref.current = hotkeys

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      for (const h of ref.current) {
        const ctrl = e.ctrlKey || e.metaKey
        if (e.key.toLowerCase() !== h.key.toLowerCase()) continue
        if (!!h.ctrl !== ctrl || !!h.shift !== e.shiftKey) continue
        if (typing && !h.allowInInputs) continue
        e.preventDefault()
        h.handler(e)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
