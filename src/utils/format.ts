export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(ts)
}

export function formatDate(value: string | number | undefined): string {
  if (value === undefined || value === '') return ''
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(value)
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(d)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Unexpected error'
}
