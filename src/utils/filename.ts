export const DEFAULT_FILENAME_PATTERN = '{guest_name}_Invitation'

const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** Removes characters that are invalid in file names on common platforms, keeping Unicode letters. */
export function sanitizeFilenamePart(value: string): string {
  return value
    .normalize('NFC')
    .replace(INVALID_CHARS, '')
    .replace(/[&+,;=#%{}[\]^`~'$!@]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
}

export interface FilenameVars {
  guestName: string
  templateName?: string
  eventName?: string
  date?: Date
}

export function buildPdfFilename(pattern: string, vars: FilenameVars): string {
  const date = vars.date ?? new Date()
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const raw = (pattern || DEFAULT_FILENAME_PATTERN)
    .replace(/\.pdf$/i, '')
    .replace(/\{guest_name\}/g, vars.guestName)
    .replace(/\{template_name\}/g, vars.templateName ?? '')
    .replace(/\{event_name\}/g, vars.eventName ?? '')
    .replace(/\{date\}/g, iso)
  let name = sanitizeFilenamePart(raw)
  if (!name || RESERVED.test(name)) name = `Invitation_${iso}`
  // Keep well below common 255-byte limits even for multi-byte scripts.
  if (name.length > 120) name = name.slice(0, 120).replace(/_+$/, '')
  return `${name}.pdf`
}
