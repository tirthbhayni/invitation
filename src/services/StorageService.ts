import { db } from '@/database/db'
import type { AppSettings } from '@/types'
import { DEFAULT_FONT_ID } from './FontService'
import { DEFAULT_FILENAME_PATTERN } from '@/utils/filename'

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  defaultCountryCode: 'IN',
  defaultFontId: DEFAULT_FONT_ID,
  defaultFontSize: 28,
  defaultFontColor: '#1f2937',
  filenamePattern: DEFAULT_FILENAME_PATTERN,
  theme: 'light',
  autoClearForm: false,
  saveGeneratedPDFs: true,
  saveGuestHistory: true,
}

export class StorageQuotaError extends Error {
  constructor() {
    super(
      'Browser storage is full. Delete old invitation history or unused templates, or turn off "Save generated PDF files" in Settings.',
    )
    this.name = 'StorageQuotaError'
  }
}

function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; inner?: { name?: string } }
  return e?.name === 'QuotaExceededError' || e?.inner?.name === 'QuotaExceededError'
}

/** Runs a database write and converts quota failures into a friendly error. */
export async function withStorage<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isQuotaError(err)) throw new StorageQuotaError()
    throw err
  }
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await db.settings.get('app')
  return { ...DEFAULT_SETTINGS, ...stored, id: 'app' }
}

export async function updateSettings(patch: Partial<Omit<AppSettings, 'id'>>): Promise<void> {
  await withStorage(async () => {
    const current = await getSettings()
    await db.settings.put({ ...current, ...patch, id: 'app' })
  })
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (!navigator.storage?.estimate) return null
  const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted?.() ?? Promise.resolve(false),
  ])
  return { usage, quota, persisted }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
