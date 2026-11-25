import { db } from '@/database/db'
import { evictPdfDocument } from './PdfRenderService'
import { withStorage } from './StorageService'

const BACKUP_APP = 'InvitePrint'
const BACKUP_VERSION = 1
const TABLES = ['templates', 'nameFields', 'fonts', 'invitations', 'settings', 'bulkGuests'] as const
type TableName = (typeof TABLES)[number]

interface EncodedBlob {
  __blob: string
  type: string
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

async function encodeRecord(record: Record<string, unknown>, includePdfs: boolean): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value instanceof Blob) {
      if (key === 'pdfBlob' && 'guestName' in record && !includePdfs) continue
      out[key] = { __blob: await blobToBase64(value), type: value.type } satisfies EncodedBlob
    } else out[key] = value
  }
  return out
}

/** Fields written by older versions that are no longer stored. */
const OBSOLETE_KEYS = new Set(['defaultMessage', 'message', 'customMessage'])

function decodeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (OBSOLETE_KEYS.has(key)) continue
    const v = value as Partial<EncodedBlob> | null
    out[key] = v && typeof v === 'object' && typeof v.__blob === 'string' ? base64ToBlob(v.__blob, v.type ?? '') : value
  }
  return out
}

export async function createBackup(includePdfs: boolean, onProgress?: (msg: string) => void): Promise<Blob> {
  const tables: Partial<Record<TableName, unknown[]>> = {}
  for (const name of TABLES) {
    onProgress?.(`Exporting ${name}…`)
    const rows = (await db.table(name).toArray()) as Record<string, unknown>[]
    tables[name] = await Promise.all(rows.map((r) => encodeRecord(r, includePdfs)))
  }
  const payload = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables }
  return new Blob([JSON.stringify(payload)], { type: 'application/json' })
}

export interface BackupSummary {
  exportedAt: string
  counts: Record<TableName, number>
}

export async function readBackup(file: File): Promise<{ summary: BackupSummary; restore: () => Promise<void> }> {
  let parsed: { app?: string; version?: number; exportedAt?: string; tables?: Record<string, unknown[]> }
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('This file is not a valid InvitePrint backup.')
  }
  if (parsed.app !== BACKUP_APP || !parsed.tables || typeof parsed.tables !== 'object') {
    throw new Error('This file is not a valid InvitePrint backup.')
  }
  if ((parsed.version ?? 0) > BACKUP_VERSION) {
    throw new Error('This backup was created by a newer version of InvitePrint.')
  }
  const tables = parsed.tables
  const counts = Object.fromEntries(
    TABLES.map((t) => [t, Array.isArray(tables[t]) ? tables[t].length : 0]),
  ) as Record<TableName, number>

  return {
    summary: { exportedAt: parsed.exportedAt ?? '', counts },
    restore: async () => {
      await withStorage(() =>
        db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
          for (const name of TABLES) {
            const rows = Array.isArray(tables[name]) ? (tables[name] as Record<string, unknown>[]) : []
            await db.table(name).clear()
            if (rows.length) await db.table(name).bulkPut(rows.map(decodeRecord))
          }
        }),
      )
      evictPdfDocument('')
    },
  }
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES) await db.table(name).clear()
  })
  evictPdfDocument('')
}
