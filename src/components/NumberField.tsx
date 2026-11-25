import { useEffect, useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Numeric input that lets users type freely (e.g. "-", "1.") and commits only
 * valid numbers, so precise values are not mangled mid-typing.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals = 2,
  suffix,
  className,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  decimals?: number
  suffix?: string
  className?: string
  disabled?: boolean
}) {
  const id = useId()
  const format = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** decimals) / 10 ** decimals) : '')
  const [text, setText] = useState(format(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(format(value))
  }, [value, focused]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (raw: string) => {
    const n = Number.parseFloat(raw.replace(',', '.'))
    if (!Number.isFinite(n)) return
    let v = n
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    if (v !== value) onChange(v)
  }

  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            commit(text)
          }}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number.parseFloat(e.target.value.replace(',', '.'))
            if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) commit(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
              const next = format(value + delta)
              setText(next)
              commit(next)
            } else if (e.key === 'Enter') commit(text)
          }}
          className={cn(suffix && 'pr-9')}
        />
        {suffix && (
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}
