import { db } from '@/database/db'
import type { Invitation, InvitationStatus } from '@/types'
import { createId } from '@/utils/id'
import { withStorage } from './StorageService'

export const STATUS_LABELS: Record<InvitationStatus, string> = {
  failed: 'Failed',
  generated: 'Generated',
  downloaded: 'Downloaded',
  share_initiated: 'Share Initiated',
  whatsapp_opened: 'WhatsApp Opened',
  sent_confirmed: 'Sent – Manually Confirmed',
}

export function computeStatus(inv: Pick<
  Invitation,
  'generationStatus' | 'downloaded' | 'whatsappOpened' | 'shareInitiated' | 'manuallySent'
>): InvitationStatus {
  if (inv.generationStatus === 'failed') return 'failed'
  if (inv.manuallySent) return 'sent_confirmed'
  if (inv.whatsappOpened) return 'whatsapp_opened'
  if (inv.shareInitiated) return 'share_initiated'
  if (inv.downloaded) return 'downloaded'
  return 'generated'
}

export type NewInvitation = Pick<
  Invitation,
  'templateId' | 'templateName' | 'guestName' | 'mobileNumber' | 'countryCode' | 'pdfFileName'
> & {
  pdfBlob?: Blob
  generationStatus?: Invitation['generationStatus']
  errorMessage?: string
}

export async function recordInvitation(data: NewInvitation): Promise<Invitation> {
  const now = Date.now()
  const inv: Invitation = {
    id: createId(),
    generationStatus: 'generated',
    downloaded: false,
    whatsappOpened: false,
    shareInitiated: false,
    manuallySent: false,
    shareAttempts: 0,
    shareStatus: 'generated',
    createdAt: now,
    updatedAt: now,
    ...data,
  }
  inv.shareStatus = computeStatus(inv)
  try {
    await withStorage(() => db.invitations.add(inv))
  } catch (err) {
    // If the PDF itself does not fit, keep the record without it.
    if (inv.pdfBlob) {
      delete inv.pdfBlob
      await withStorage(() => db.invitations.add(inv))
    } else throw err
  }
  return inv
}

export type InvitationEvent = 'downloaded' | 'whatsapp_opened' | 'share_initiated' | 'sent_confirmed' | 'sent_unconfirmed'

export async function markInvitation(id: string, event: InvitationEvent): Promise<void> {
  await db.transaction('rw', db.invitations, async () => {
    const inv = await db.invitations.get(id)
    if (!inv) return
    if (event === 'downloaded') inv.downloaded = true
    if (event === 'whatsapp_opened') {
      inv.whatsappOpened = true
      inv.shareAttempts = (inv.shareAttempts ?? 0) + 1
    }
    if (event === 'share_initiated') {
      inv.shareInitiated = true
      inv.shareAttempts = (inv.shareAttempts ?? 0) + 1
    }
    if (event === 'sent_confirmed') inv.manuallySent = true
    if (event === 'sent_unconfirmed') inv.manuallySent = false
    inv.shareStatus = computeStatus(inv)
    inv.updatedAt = Date.now()
    await db.invitations.put(inv)
  })
}

export async function updateInvitation(
  id: string,
  patch: Partial<Pick<Invitation, 'guestName' | 'mobileNumber' | 'countryCode' | 'pdfFileName' | 'pdfBlob'>>,
): Promise<void> {
  await withStorage(() => db.invitations.update(id, { ...patch, updatedAt: Date.now() }))
}

export async function deleteInvitations(ids: string[]): Promise<void> {
  await db.invitations.bulkDelete(ids)
}

export async function clearHistory(): Promise<void> {
  await db.invitations.clear()
}

export function fullNumber(inv: Pick<Invitation, 'countryCode' | 'mobileNumber'>): string {
  return inv.mobileNumber ? `+${inv.countryCode} ${inv.mobileNumber}` : ''
}
