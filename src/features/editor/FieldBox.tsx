import { useRef } from 'react'
import { RotateCw } from 'lucide-react'
import type { NameField, PageDimension } from '@/types'
import { cn } from '@/lib/utils'
import { clamp } from '@/utils/units'

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN_SIZE = 8

const HANDLE_POS: Record<Handle, string> = {
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  n: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  s: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
  sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
}

export type FieldGeometry = Pick<NameField, 'x' | 'y' | 'width' | 'height' | 'rotation'>

interface DragState {
  mode: 'move' | 'rotate' | Handle
  startX: number
  startY: number
  start: FieldGeometry
  key: string
  centerClient: [number, number]
}

export function FieldBox({
  field,
  zoom,
  page,
  selected,
  label,
  onSelect,
  onChange,
  onDelete,
}: {
  field: NameField
  zoom: number
  page: PageDimension
  selected: boolean
  label: string
  onSelect: () => void
  onChange: (geometry: Partial<FieldGeometry>, coalesceKey: string) => void
  onDelete: () => void
}) {
  const drag = useRef<DragState | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const begin = (e: React.PointerEvent, mode: DragState['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onSelect()
    const rect = boxRef.current!.getBoundingClientRect()
    drag.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: { x: field.x, y: field.y, width: field.width, height: field.height, rotation: field.rotation },
      key: `${mode}-${field.id}-${Date.now()}`,
      centerClient: [rect.left + rect.width / 2, rect.top + rect.height / 2],
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.startX) / zoom
    const dy = (e.clientY - d.startY) / zoom
    const s = d.start

    if (d.mode === 'move') {
      const cx = clamp(s.x + s.width / 2 + dx, 0, page.width)
      const cy = clamp(s.y + s.height / 2 + dy, 0, page.height)
      onChange({ x: cx - s.width / 2, y: cy - s.height / 2 }, d.key)
      return
    }

    if (d.mode === 'rotate') {
      let angle = (Math.atan2(e.clientY - d.centerClient[1], e.clientX - d.centerClient[0]) * 180) / Math.PI + 90
      if (angle > 180) angle -= 360
      const snap = e.shiftKey ? 15 : 0
      if (snap) angle = Math.round(angle / snap) * snap
      else {
        for (const a of [-180, -90, 0, 90, 180]) if (Math.abs(angle - a) < 3) angle = a
      }
      onChange({ rotation: Math.round(angle * 10) / 10 }, d.key)
      return
    }

    // Resize in the field's own (rotated) frame, keeping the opposite edge fixed.
    const r = (s.rotation * Math.PI) / 180
    const cos = Math.cos(r)
    const sin = Math.sin(r)
    const lx = dx * cos + dy * sin
    const ly = -dx * sin + dy * cos
    const sx = d.mode.includes('e') ? 1 : d.mode.includes('w') ? -1 : 0
    const sy = d.mode.includes('s') ? 1 : d.mode.includes('n') ? -1 : 0
    const width = Math.max(MIN_SIZE, s.width + sx * lx)
    const height = Math.max(MIN_SIZE, s.height + sy * ly)
    const dw = width - s.width
    const dh = height - s.height
    const ox = (sx * dw) / 2
    const oy = (sy * dh) / 2
    const cx = s.x + s.width / 2 + ox * cos - oy * sin
    const cy = s.y + s.height / 2 + ox * sin + oy * cos
    onChange({ x: cx - width / 2, y: cy - height / 2, width, height }, d.key)
  }

  const end = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1
    const key = `key-${field.id}`
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    if (moves[e.key]) {
      e.preventDefault()
      onChange({ x: field.x + moves[e.key][0], y: field.y + moves[e.key][1] }, key)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onDelete()
    }
  }

  return (
    <div
      ref={boxRef}
      role="button"
      tabIndex={0}
      aria-label={`${label}. Drag to move, use arrow keys for fine adjustment.`}
      aria-pressed={selected}
      className={cn(
        'absolute touch-none select-none outline-none',
        selected
          ? 'z-20 cursor-move border-2 border-blue-600 bg-blue-500/5'
          : 'z-10 cursor-pointer border border-dashed border-blue-500/70 hover:bg-blue-500/5',
      )}
      style={{
        left: field.x * zoom,
        top: field.y * zoom,
        width: field.width * zoom,
        height: field.height * zoom,
        transform: field.rotation ? `rotate(${field.rotation}deg)` : undefined,
      }}
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onFocus={onSelect}
    >
      <span
        className={cn(
          'pointer-events-none absolute -top-5 left-0 rounded-sm px-1 font-mono text-[10px] leading-4 whitespace-nowrap',
          selected ? 'bg-blue-600 text-white' : 'bg-blue-500/80 text-white',
        )}
      >
        {label}
      </span>
      {selected && (
        <>
          {HANDLES.map((h) => (
            <span
              key={h}
              className={cn(
                'absolute size-3 rounded-sm border border-blue-600 bg-white pointer-coarse:size-5',
                HANDLE_POS[h],
              )}
              onPointerDown={(e) => begin(e, h)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              aria-hidden
            />
          ))}
          <span
            className="absolute -top-9 left-1/2 flex size-6 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-blue-600 bg-white text-blue-600 pointer-coarse:size-8"
            onPointerDown={(e) => begin(e, 'rotate')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            title="Drag to rotate (hold Shift to snap)"
            aria-hidden
          >
            <RotateCw className="size-3.5" />
          </span>
        </>
      )}
    </div>
  )
}
