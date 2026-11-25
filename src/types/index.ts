export const EVENT_CATEGORIES = [
  'Wedding',
  'Engagement',
  'Birthday',
  'Anniversary',
  'Religious Event',
  'Business Event',
  'Housewarming',
  'Other',
] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

/** Size of a page as displayed (page rotation applied), in PDF points. */
export interface PageDimension {
  width: number
  height: number
}

export interface Template {
  id: string
  name: string
  eventName: string
  eventCategory: EventCategory
  eventDate?: string
  /** The file exactly as uploaded by the user. Never modified. */
  fileBlob: Blob
  fileName: string
  fileType: string
  /** PDF used for rendering. Same as fileBlob for PDF uploads, a lossless wrapper for images. */
  pdfBlob: Blob
  pageCount: number
  pageDimensions: PageDimension[]
  thumbnail?: Blob
  /** 1 or 0 so it can be indexed. */
  isDefault: 0 | 1
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

export type HAlign = 'left' | 'center' | 'right'
export type VAlign = 'top' | 'middle' | 'bottom'
export type TextTransformMode = 'none' | 'uppercase' | 'lowercase'

/**
 * A dynamic text area. Coordinates are PDF points measured from the top-left
 * corner of the page as displayed (rotation applied), independent of zoom.
 */
export interface NameField {
  id: string
  templateId: string
  pageNumber: number
  fieldType: 'guest_name'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fontId: string
  fontSize: number
  minimumFontSize: number
  fontColor: string
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  underline: boolean
  alignment: HAlign
  verticalAlignment: VAlign
  letterSpacing: number
  lineSpacing: number
  prefix: string
  suffix: string
  autoFit: boolean
  multiline: boolean
  textTransform: TextTransformMode
}

export interface FontRecord {
  id: string
  name: string
  family: string
  fileBlob: Blob
  fileType: string
  supportedLanguages: string[]
  createdAt: number
}

export type InvitationStatus =
  | 'failed'
  | 'generated'
  | 'downloaded'
  | 'share_initiated'
  | 'whatsapp_opened'
  | 'sent_confirmed'

export interface Invitation {
  id: string
  templateId: string
  templateName: string
  guestName: string
  /** National significant number, digits only. */
  mobileNumber: string
  /** Calling code digits, e.g. "91". */
  countryCode: string
  pdfFileName: string
  pdfBlob?: Blob
  generationStatus: 'generated' | 'failed'
  /** Highest status reached, used for indexing and filtering. */
  shareStatus: InvitationStatus
  downloaded: boolean
  whatsappOpened: boolean
  shareInitiated: boolean
  manuallySent: boolean
  shareAttempts: number
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  id: 'app'
  /** ISO 3166-1 alpha-2 country, e.g. "IN". */
  defaultCountryCode: string
  defaultTemplateId?: string
  defaultFontId: string
  defaultFontSize: number
  defaultFontColor: string
  filenamePattern: string
  theme: ThemeMode
  autoClearForm: boolean
  saveGeneratedPDFs: boolean
  saveGuestHistory: boolean
}

export type BulkRowStatus = 'pending' | 'generating' | 'generated' | 'failed'

export interface BulkGuest {
  id: string
  order: number
  guestName: string
  mobileNumber: string
  countryCode: string
  pdfStatus: BulkRowStatus
  shareStatus: 'none' | 'share_initiated' | 'whatsapp_opened' | 'sent_confirmed'
  invitationId?: string
  error?: string
  createdAt: number
}
