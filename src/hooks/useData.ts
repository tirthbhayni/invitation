import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/database/db'
import { DEFAULT_SETTINGS, getSettings } from '@/services/StorageService'
import type { AppSettings, FontRecord, NameField, Template } from '@/types'

export function useSettings(): AppSettings {
  return useLiveQuery(getSettings, [], DEFAULT_SETTINGS)
}

/** Settings plus a flag telling whether they have been read from the database yet. */
export function useSettingsLoaded(): { settings: AppSettings; loaded: boolean } {
  const value = useLiveQuery(getSettings, [])
  return { settings: value ?? DEFAULT_SETTINGS, loaded: value !== undefined }
}

export function useTemplates(): Template[] | undefined {
  return useLiveQuery(() => db.templates.orderBy('updatedAt').reverse().toArray(), [])
}

export function useTemplate(id: string | undefined): Template | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.templates.get(id)) ?? null) : null), [id])
}

export function useTemplateFields(templateId: string | undefined): NameField[] | undefined {
  // useLiveQuery keeps returning the previous template's result until the new query resolves.
  const result = useLiveQuery(
    async () => ({
      templateId,
      fields: templateId
        ? (await db.nameFields.where('templateId').equals(templateId).toArray()).sort(
            (a, b) => a.pageNumber - b.pageNumber || a.y - b.y,
          )
        : [],
    }),
    [templateId],
  )
  return result && result.templateId === templateId ? result.fields : undefined
}

export function useCustomFonts(): FontRecord[] {
  return useLiveQuery(() => db.fonts.orderBy('name').toArray(), [], [])
}
