import Dexie, { type EntityTable } from 'dexie'
import type {
  AppSettings,
  BulkGuest,
  FontRecord,
  Invitation,
  NameField,
  Template,
} from '@/types'

export class InvitePrintDB extends Dexie {
  templates!: EntityTable<Template, 'id'>
  nameFields!: EntityTable<NameField, 'id'>
  fonts!: EntityTable<FontRecord, 'id'>
  invitations!: EntityTable<Invitation, 'id'>
  settings!: EntityTable<AppSettings, 'id'>
  bulkGuests!: EntityTable<BulkGuest, 'id'>

  constructor() {
    super('inviteprint')

    this.version(1).stores({
      templates: 'id, name, eventCategory, isDefault, createdAt, updatedAt, lastUsedAt',
      nameFields: 'id, templateId, pageNumber',
      fonts: 'id, name, family, createdAt',
      invitations:
        'id, templateId, guestName, mobileNumber, shareStatus, generationStatus, createdAt, [templateId+createdAt]',
      settings: 'id',
    })

    this.version(2)
      .stores({ bulkGuests: 'id, order, createdAt' })
      .upgrade(async (tx) => {
        await tx
          .table('invitations')
          .toCollection()
          .modify((inv: Partial<Invitation>) => {
            inv.shareAttempts ??= inv.whatsappOpened ? 1 : 0
          })
      })

    this.version(3).stores({}).upgrade(async (tx) => {
      const strip = (key: string) => (row: Record<string, unknown>) => {
        delete row[key]
      }
      await tx.table('templates').toCollection().modify(strip('defaultMessage'))
      await tx.table('settings').toCollection().modify(strip('defaultMessage'))
      await tx.table('invitations').toCollection().modify(strip('message'))
      await tx.table('bulkGuests').toCollection().modify(strip('customMessage'))
    })
  }
}

export const db = new InvitePrintDB()
