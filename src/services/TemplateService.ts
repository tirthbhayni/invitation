import { db } from '@/database/db'
import type { EventCategory, NameField, PageDimension, Template } from '@/types'
import { createId } from '@/utils/id'
import { imageToPdf, inspectPdf, MAX_TEMPLATE_SIZE_BYTES, PdfProcessingError } from './PDFService'
import { createThumbnail, evictPdfDocument } from './PdfRenderService'
import { getSettings, withStorage } from './StorageService'

export const ACCEPTED_TEMPLATE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}
export const TEMPLATE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

function detectType(file: File, bytes: Uint8Array): string | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  // Some PDFs have leading junk before the header.
  if (/\.pdf$/i.test(file.name) && new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
    return 'application/pdf'
  }
  return null
}

export interface PreparedTemplateFile {
  fileBlob: Blob
  fileName: string
  fileType: string
  pdfBlob: Blob
  pageCount: number
  pageDimensions: PageDimension[]
  thumbnail?: Blob
}

/** Validates an uploaded invitation file and prepares everything needed to store it. */
export async function prepareTemplateFile(file: File): Promise<PreparedTemplateFile> {
  if (file.size === 0) throw new PdfProcessingError('The selected file is empty.', 'empty')
  if (file.size > MAX_TEMPLATE_SIZE_BYTES) {
    throw new PdfProcessingError('The file is larger than 50 MB. Please upload a smaller file.', 'too_large')
  }
  const bytes = await file.arrayBuffer()
  const type = detectType(file, new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024)))
  if (!type) {
    throw new PdfProcessingError('Unsupported file format. Upload a PDF, JPG, JPEG or PNG file.', 'unsupported')
  }
  let pdfBytes: ArrayBuffer
  if (type === 'application/pdf') {
    pdfBytes = bytes
  } else {
    const out = await imageToPdf(bytes, type)
    pdfBytes = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
  }
  const { pageCount, pageDimensions } = await inspectPdf(pdfBytes)
  const thumbnail = await createThumbnail(pdfBytes.slice(0))
  return {
    fileBlob: new Blob([bytes], { type }),
    fileName: file.name,
    fileType: type,
    pdfBlob: type === 'application/pdf' ? new Blob([bytes], { type }) : new Blob([pdfBytes], { type: 'application/pdf' }),
    pageCount,
    pageDimensions,
    thumbnail,
  }
}

export interface TemplateMeta {
  name: string
  eventName: string
  eventCategory: EventCategory
  eventDate?: string
}

export async function createTemplate(meta: TemplateMeta, prepared: PreparedTemplateFile): Promise<Template> {
  const now = Date.now()
  const hasDefault = (await db.templates.where('isDefault').equals(1).count()) > 0
  const template: Template = {
    id: createId(),
    ...meta,
    ...prepared,
    isDefault: hasDefault ? 0 : 1,
    createdAt: now,
    updatedAt: now,
  }
  await withStorage(() => db.templates.add(template))
  return template
}

export async function updateTemplate(id: string, patch: Partial<Omit<Template, 'id' | 'createdAt'>>): Promise<void> {
  await withStorage(() => db.templates.update(id, { ...patch, updatedAt: Date.now() }))
  if (patch.pdfBlob) evictPdfDocument(`${id}:`)
}

export async function replaceTemplateFile(id: string, prepared: PreparedTemplateFile): Promise<void> {
  await updateTemplate(id, prepared)
  // Drop fields that point to pages that no longer exist.
  await db.nameFields
    .where('templateId')
    .equals(id)
    .filter((f) => f.pageNumber > prepared.pageCount)
    .modify((f) => {
      f.pageNumber = 1
    })
}

export async function renameTemplate(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Template name cannot be empty.')
  await updateTemplate(id, { name: trimmed })
}

export async function setDefaultTemplate(id: string): Promise<void> {
  await db.transaction('rw', db.templates, db.settings, async () => {
    await db.templates.where('isDefault').equals(1).modify({ isDefault: 0 })
    await db.templates.update(id, { isDefault: 1 })
    const settings = await getSettings()
    await db.settings.put({ ...settings, defaultTemplateId: id })
  })
}

export async function duplicateTemplate(id: string): Promise<Template> {
  const original = await db.templates.get(id)
  if (!original) throw new Error('Template not found. It may have been deleted.')
  const fields = await getTemplateFields(id)
  const now = Date.now()
  const copy: Template = {
    ...original,
    id: createId(),
    name: `${original.name} (Copy)`,
    isDefault: 0,
    lastUsedAt: undefined,
    createdAt: now,
    updatedAt: now,
  }
  await withStorage(() =>
    db.transaction('rw', db.templates, db.nameFields, async () => {
      await db.templates.add(copy)
      await db.nameFields.bulkAdd(fields.map((f) => ({ ...f, id: createId(), templateId: copy.id })))
    }),
  )
  return copy
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.transaction('rw', db.templates, db.nameFields, db.settings, async () => {
    const tpl = await db.templates.get(id)
    await db.nameFields.where('templateId').equals(id).delete()
    await db.templates.delete(id)
    const settings = await getSettings()
    if (settings.defaultTemplateId === id) await db.settings.put({ ...settings, defaultTemplateId: undefined })
    if (tpl?.isDefault) {
      const next = await db.templates.orderBy('updatedAt').last()
      if (next) await db.templates.update(next.id, { isDefault: 1 })
    }
  })
  evictPdfDocument(`${id}:`)
}

export async function markTemplateUsed(id: string): Promise<void> {
  await db.templates.update(id, { lastUsedAt: Date.now() }).catch(() => {})
}

export async function getTemplateFields(templateId: string): Promise<NameField[]> {
  const fields = await db.nameFields.where('templateId').equals(templateId).toArray()
  return fields.sort((a, b) => a.pageNumber - b.pageNumber || a.y - b.y)
}

export async function saveTemplateFields(templateId: string, fields: NameField[]): Promise<void> {
  await withStorage(() =>
    db.transaction('rw', db.nameFields, db.templates, async () => {
      await db.nameFields.where('templateId').equals(templateId).delete()
      await db.nameFields.bulkAdd(fields.map((f) => ({ ...f, templateId })))
      await db.templates.update(templateId, { updatedAt: Date.now() })
    }),
  )
}

export async function createDefaultField(
  templateId: string,
  pageNumber: number,
  page: PageDimension,
): Promise<NameField> {
  const settings = await getSettings()
  const width = Math.round(page.width * 0.6)
  const height = Math.round(Math.max(settings.defaultFontSize * 1.8, page.height * 0.06))
  return {
    id: createId(),
    templateId,
    pageNumber,
    fieldType: 'guest_name',
    x: Math.round((page.width - width) / 2),
    y: Math.round(page.height * 0.45 - height / 2),
    width,
    height,
    rotation: 0,
    fontId: settings.defaultFontId,
    fontSize: settings.defaultFontSize,
    minimumFontSize: 10,
    fontColor: settings.defaultFontColor,
    fontWeight: 'normal',
    fontStyle: 'normal',
    underline: false,
    alignment: 'center',
    verticalAlignment: 'middle',
    letterSpacing: 0,
    lineSpacing: 1.2,
    prefix: '',
    suffix: '',
    autoFit: true,
    multiline: false,
    textTransform: 'none',
  }
}

/** Templates that are not default and have never been used to generate invitations. */
export async function findUnusedTemplateIds(): Promise<string[]> {
  const [templates, used] = await Promise.all([
    db.templates.toArray(),
    db.invitations.orderBy('templateId').uniqueKeys().catch(async () => {
      const all = await db.invitations.toArray()
      return [...new Set(all.map((i) => i.templateId))]
    }),
  ])
  const usedSet = new Set(used as string[])
  return templates.filter((t) => !t.isDefault && !t.lastUsedAt && !usedSet.has(t.id)).map((t) => t.id)
}
