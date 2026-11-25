import { useMemo } from 'react'
import { getCountryOptions } from '@/services/WhatsAppService'
import { NativeSelect } from './NativeSelect'

export function CountrySelect({
  value,
  onChange,
  id,
  className,
  compact,
}: {
  value: string
  onChange: (code: string) => void
  id?: string
  className?: string
  /** Show only the dial code in the closed state. */
  compact?: boolean
}) {
  const options = useMemo(() => getCountryOptions(), [])
  return (
    <NativeSelect
      id={id}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Country code"
    >
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {compact && c.code === value ? `${c.code} +${c.dialCode}` : `${c.name} (+${c.dialCode})`}
        </option>
      ))}
    </NativeSelect>
  )
}
