import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max'

export interface CountryOption {
  code: CountryCode
  name: string
  dialCode: string
}

let countryCache: CountryOption[] | null = null

export function getCountryOptions(): CountryOption[] {
  if (countryCache) return countryCache
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    names = null
  }
  countryCache = getCountries()
    .map((code) => ({
      code,
      name: names?.of(code) ?? code,
      dialCode: getCountryCallingCode(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return countryCache
}

export function dialCodeFor(country: string): string {
  try {
    return getCountryCallingCode(country as CountryCode)
  } catch {
    return ''
  }
}

/** Finds the main country for a calling code such as "91" or "+1". */
export function countryForDialCode(dialCode: string): CountryCode | undefined {
  const digits = dialCode.replace(/\D/g, '')
  if (!digits) return undefined
  const preferred: Record<string, CountryCode> = { '1': 'US', '7': 'RU', '44': 'GB', '61': 'AU', '39': 'IT', '47': 'NO', '358': 'FI', '590': 'GP', '262': 'RE', '599': 'CW', '212': 'MA' }
  if (preferred[digits]) return preferred[digits]
  return getCountryOptions().find((c) => c.dialCode === digits)?.code
}

export type PhoneResult =
  | {
      valid: true
      /** Digits only, including the calling code, ready for wa.me. */
      waNumber: string
      e164: string
      countryCode: string
      nationalNumber: string
      country?: CountryCode
      formatted: string
    }
  | { valid: false; empty: boolean; error: string }

/**
 * Normalizes user input like "098765 43210", "+91 98765-43210",
 * "919876543210" or "0091 98765 43210" for the selected country,
 * without ever duplicating the country code.
 */
export function normalizePhone(input: string, defaultCountry: string): PhoneResult {
  const raw = (input ?? '').trim()
  if (!raw) return { valid: false, empty: true, error: 'Mobile number is required for WhatsApp.' }
  if (/[a-z]/i.test(raw.replace(/\s*(ext|x)\.?\s*\d+$/i, ''))) {
    return { valid: false, empty: false, error: 'Mobile number can only contain digits, spaces, +, - and brackets.' }
  }
  let cleaned = raw.replace(/[\s\-().[\]/\\]/g, '')
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`
  const country = defaultCountry as CountryCode
  const dial = dialCodeFor(country)

  const candidates: string[] = []
  if (cleaned.startsWith('+')) candidates.push(cleaned)
  else {
    candidates.push(cleaned)
    // The user may have typed the country code without "+".
    if (dial && cleaned.startsWith(dial)) candidates.push(`+${cleaned}`)
  }

  for (const candidate of candidates) {
    const parsed = candidate.startsWith('+')
      ? parsePhoneNumberFromString(candidate)
      : parsePhoneNumberFromString(candidate, country)
    if (parsed && parsed.isValid()) {
      return {
        valid: true,
        waNumber: `${parsed.countryCallingCode}${parsed.nationalNumber}`,
        e164: parsed.number,
        countryCode: parsed.countryCallingCode,
        nationalNumber: parsed.nationalNumber,
        country: parsed.country,
        formatted: parsed.formatInternational(),
      }
    }
  }
  return {
    valid: false,
    empty: false,
    error: 'Enter a valid mobile number for the selected country, or include the country code (e.g. +44…).',
  }
}

/** Official click-to-chat link. Opens a chat even if the number is not saved in contacts. */
export function buildWhatsAppUrl(waNumber: string): string {
  return `https://wa.me/${waNumber.replace(/\D/g, '')}`
}

// ---------------------------------------------------------------------------
// Provider abstraction. Click-to-chat is the only provider in this version;
// an official WhatsApp Business Cloud API provider must run behind a backend
// that holds the access token — never in the browser.

export interface WhatsAppSendRequest {
  waNumber: string
  document?: { file: Blob; fileName: string }
}

export type WhatsAppSendOutcome =
  | { kind: 'chat_opened' }
  | { kind: 'popup_blocked'; url: string }
  | { kind: 'queued'; messageId: string }

export interface WhatsAppProvider {
  readonly id: string
  readonly canAttachDocuments: boolean
  readonly reportsDelivery: boolean
  send(request: WhatsAppSendRequest, target?: Window | null): Promise<WhatsAppSendOutcome>
}

export const clickToChatProvider: WhatsAppProvider = {
  id: 'click-to-chat',
  canAttachDocuments: false,
  reportsDelivery: false,
  async send({ waNumber }, target) {
    return openWhatsAppChat(waNumber, target) === 'opened'
      ? { kind: 'chat_opened' }
      : { kind: 'popup_blocked', url: buildWhatsAppUrl(waNumber) }
  },
}

/** Opens WhatsApp synchronously. Must be called inside a user gesture handler. */
export function openWhatsAppChat(waNumber: string, target?: Window | null): 'opened' | 'blocked' {
  const url = buildWhatsAppUrl(waNumber)
  try {
    if (target && !target.closed) {
      target.location.href = url
      return 'opened'
    }
    const win = window.open(url, '_blank')
    if (!win) return 'blocked'
    try {
      win.opener = null
    } catch {
      /* cross-origin after navigation */
    }
    return 'opened'
  } catch {
    return 'blocked'
  }
}
