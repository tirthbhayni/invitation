import { describe, expect, it } from 'vitest'
import { buildPdfFilename, sanitizeFilenamePart } from '@/utils/filename'
import { buildWhatsAppUrl, normalizePhone } from '@/services/WhatsAppService'
import { fromPoints, toPoints } from '@/utils/units'

describe('filenames', () => {
  it('uses the Guest_Name_Invitation.pdf pattern', () => {
    expect(buildPdfFilename('{guest_name}_Invitation', { guestName: 'Rajesh Patel' })).toBe('Rajesh_Patel_Invitation.pdf')
  })
  it('removes invalid characters but keeps Unicode letters', () => {
    expect(sanitizeFilenamePart('Raj/esh: "Patel"?')).toBe('Rajesh_Patel')
    expect(buildPdfFilename('{guest_name}_Invitation', { guestName: 'શ્રી રાજેશભાઈ પટેલ' })).toBe('શ્રી_રાજેશભાઈ_પટેલ_Invitation.pdf')
    expect(buildPdfFilename('{guest_name}', { guestName: 'श्री राजेश पटेल' })).toBe('श्री_राजेश_पटेल.pdf')
  })
  it('falls back when the name is empty after sanitizing', () => {
    expect(buildPdfFilename('{guest_name}', { guestName: '???', date: new Date(2026, 0, 5) })).toBe('Invitation_2026-01-05.pdf')
  })
})

describe('phone normalization', () => {
  it('normalizes Indian numbers in common formats', () => {
    for (const input of ['98765 43210', '+91 98765-43210', '919876543210', '0091 9876543210', '(+91) 98765 43210', '098765 43210']) {
      const r = normalizePhone(input, 'IN')
      expect(r.valid, input).toBe(true)
      if (r.valid) expect(r.waNumber).toBe('919876543210')
    }
  })
  it('supports international numbers regardless of selected country', () => {
    const uk = normalizePhone('+44 7911 123456', 'IN')
    expect(uk.valid && uk.waNumber).toBe('447911123456')
    const us = normalizePhone('(415) 555-2671', 'US')
    expect(us.valid && us.waNumber).toBe('14155552671')
    const ae = normalizePhone('050 123 4567', 'AE')
    expect(ae.valid && ae.waNumber).toBe('971501234567')
  })
  it('rejects invalid numbers', () => {
    expect(normalizePhone('12345', 'IN').valid).toBe(false)
    expect(normalizePhone('abcdefghij', 'IN').valid).toBe(false)
    const empty = normalizePhone('  ', 'IN')
    expect(empty.valid).toBe(false)
    if (!empty.valid) expect(empty.empty).toBe(true)
  })
})

describe('WhatsApp links', () => {
  it('builds wa.me links with the number only', () => {
    expect(buildWhatsAppUrl('919876543210')).toBe('https://wa.me/919876543210')
    expect(buildWhatsAppUrl('+91 98765-43210')).toBe('https://wa.me/919876543210')
  })
})

describe('units', () => {
  it('round-trips millimetres and percentages', () => {
    expect(toPoints(fromPoints(100, 'mm', 595), 'mm', 595)).toBeCloseTo(100)
    expect(fromPoints(297.5, 'percent', 595)).toBeCloseTo(50)
    expect(toPoints(50, 'percent', 842)).toBeCloseTo(421)
  })
})
