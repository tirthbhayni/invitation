import { useCallback, useState } from 'react'

interface UndoState<T> {
  past: T[]
  present: T
  future: T[]
  lastKey: string | null
  lastTime: number
}

const LIMIT = 100
const COALESCE_MS = 800

/**
 * State with undo/redo. Consecutive updates with the same `coalesceKey`
 * (e.g. one drag gesture or typing in one input) form a single undo step.
 */
export function useUndoable<T>(initial: T) {
  const [s, setS] = useState<UndoState<T>>({ past: [], present: initial, future: [], lastKey: null, lastTime: 0 })

  const set = useCallback((next: T | ((prev: T) => T), coalesceKey?: string) => {
    setS((cur) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(cur.present) : next
      if (Object.is(value, cur.present)) return cur
      const now = Date.now()
      const coalesce = !!coalesceKey && coalesceKey === cur.lastKey && now - cur.lastTime < COALESCE_MS
      return {
        past: coalesce ? cur.past : [...cur.past, cur.present].slice(-LIMIT),
        present: value,
        future: [],
        lastKey: coalesceKey ?? null,
        lastTime: now,
      }
    })
  }, [])

  const undo = useCallback(() => {
    setS((cur) =>
      cur.past.length === 0
        ? cur
        : {
            past: cur.past.slice(0, -1),
            present: cur.past[cur.past.length - 1],
            future: [cur.present, ...cur.future],
            lastKey: null,
            lastTime: 0,
          },
    )
  }, [])

  const redo = useCallback(() => {
    setS((cur) =>
      cur.future.length === 0
        ? cur
        : {
            past: [...cur.past, cur.present],
            present: cur.future[0],
            future: cur.future.slice(1),
            lastKey: null,
            lastTime: 0,
          },
    )
  }, [])

  const reset = useCallback((value: T) => {
    setS({ past: [], present: value, future: [], lastKey: null, lastTime: 0 })
  }, [])

  return {
    value: s.present,
    set,
    undo,
    redo,
    reset,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
  }
}
