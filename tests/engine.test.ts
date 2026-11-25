import { beforeAll, describe, expect, it } from 'vitest'
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { useLocalFonts } from './setup-fonts'
import { layoutField, layoutText, type LayoutFieldOptions } from '@/services/TextLayoutService'
import { generatePersonalizedPdf, inspectPdf, PdfProcessingError } from '@/services/PDFService'
import { applyToPoint, displayToUserSpace } from '@/utils/matrix'
import type { NameField } from '@/types'

beforeAll(() => useLocalFonts())

const baseField: NameField = {
  id: 'f1',
  templateId: 't1',
  pageNumber: 1,
  fieldType: 'guest_name',
  x: 100,
  y: 200,
  width: 300,
  height: 40,
  rotation: 0,
  fontId: 'noto-sans',
  fontSize: 24,
  minimumFontSize: 8,
  fontColor: '#222222',
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

async function samplePdf(rotation = 0, size: [number, number] = [595, 842]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage(size)
  page.setRotation(degrees(rotation))
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('You are invited', { x: 50, y: 50, size: 20, font, color: rgb(0.5, 0, 0) })
  doc.addPage([400, 400])
  return doc.save()
}

async function extractText(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent()
  return content.items.map((i) => ('str' in i ? i.str : '')).join(' ')
}

describe('coordinate transforms', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 }
  it('maps display top-left to the visual top-left corner for every rotation', () => {
    expect(applyToPoint(displayToUserSpace(box, 0), 0, 0)).toEqual([0, 800])
    expect(applyToPoint(displayToUserSpace(box, 90), 0, 0)).toEqual([0, 0])
    expect(applyToPoint(displayToUserSpace(box, 180), 0, 0)).toEqual([600, 0])
    expect(applyToPoint(displayToUserSpace(box, 270), 0, 0)).toEqual([600, 800])
  })
  it('respects crop box offsets', () => {
    expect(applyToPoint(displayToUserSpace({ x: 10, y: 20, width: 100, height: 200 }, 0), 5, 5)).toEqual([15, 215])
  })
})

describe('text shaping', () => {
  it('shapes Gujarati conjuncts and vowel signs without missing glyphs', async () => {
    const text = 'શ્રી રાજેશભાઈ પટેલ સહપરિવાર'
    const layout = await layoutText(text, { ...baseField, fontId: 'noto-sans-gujarati', autoFit: false })
    expect(layout.glyphs.length).toBeGreaterThan(0)
    expect(layout.glyphs.every((g) => g.gid !== 0)).toBe(true)
    expect(layout.runs.every((r) => r.font.fontId === 'noto-sans-gujarati')).toBe(true)
    // શ + ્ + ર + ી : the half-letter conjunct શ્ર plus the vowel sign.
    const shri = await layoutText('શ્રી', { ...baseField, fontId: 'noto-sans-gujarati', autoFit: false })
    expect(shri.glyphs.length).toBeLessThanOrEqual(2)
    const ksha = await layoutText('ક્ષ', { ...baseField, fontId: 'noto-sans-gujarati', autoFit: false })
    expect(ksha.glyphs.length).toBe(1)
    // Pre-base vowel sign િ must be drawn before (left of) its consonant.
    const ki = await layoutText('કિ', { ...baseField, fontId: 'noto-sans-gujarati', autoFit: false, alignment: 'left' })
    expect(ki.glyphs.length).toBe(2)
    expect(ki.glyphs[0].x).toBeLessThan(ki.glyphs[1].x)
  })

  it('shapes Hindi conjuncts without missing glyphs', async () => {
    const layout = await layoutField({ ...baseField, fontId: 'noto-sans-devanagari' }, 'श्री राजेश पटेल सपरिवार')
    expect(layout.glyphs.every((g) => g.gid !== 0)).toBe(true)
    const shri = await layoutText('श्री', { ...baseField, fontId: 'noto-sans-devanagari', autoFit: false })
    expect(shri.glyphs.length).toBeLessThanOrEqual(2)
  })

  it('falls back to a Devanagari font when the selected font lacks Hindi glyphs', async () => {
    const layout = await layoutField({ ...baseField, fontId: 'noto-serif' }, 'श्री राजेश पटेल सपरिवार')
    expect(layout.runs.some((r) => r.font.fontId === 'noto-sans-devanagari')).toBe(true)
    expect(layout.glyphs.length).toBeGreaterThan(0)
  })

  it('handles mixed Latin and Gujarati text with separate fonts', async () => {
    const layout = await layoutField(baseField, 'Rajesh પટેલ & Family')
    const ids = new Set(layout.runs.map((r) => r.font.fontId))
    expect(ids.has('noto-sans')).toBe(true)
    expect(ids.has('noto-sans-gujarati')).toBe(true)
  })

  it('shrinks long names to fit within the box', async () => {
    const field: LayoutFieldOptions = { ...baseField, width: 250 }
    const layout = await layoutField(field, 'Shri Rajeshkumar Ramanlal Patel and Family Members')
    expect(layout.shrunk).toBe(true)
    expect(layout.overflow).toBe(false)
    expect(layout.fontSize).toBeLessThan(24)
    const minLeft = Math.min(...layout.runs.map((r) => r.x))
    const maxRight = Math.max(...layout.runs.map((r) => r.x + r.width))
    expect(minLeft).toBeGreaterThanOrEqual(-0.02)
    expect(maxRight).toBeLessThanOrEqual(250.02)
  })

  it('reports overflow when the minimum size is still too large', async () => {
    const layout = await layoutField({ ...baseField, width: 40, minimumFontSize: 20 }, 'A very long guest name indeed')
    expect(layout.overflow).toBe(true)
    expect(layout.fontSize).toBe(20)
  })

  it('wraps onto multiple lines when multiline is enabled', async () => {
    const layout = await layoutField(
      { ...baseField, width: 120, height: 120, multiline: true, autoFit: true },
      'Rajesh Patel and Family',
    )
    expect(layout.lines.length).toBeGreaterThan(1)
    expect(layout.overflow).toBe(false)
  })

  it('applies prefix, suffix and case transforms', async () => {
    const layout = await layoutField(
      { ...baseField, prefix: 'Shri', suffix: '& Family', textTransform: 'uppercase' },
      'Rajesh Patel',
    )
    expect(layout.text).toBe('SHRI RAJESH PATEL & FAMILY')
  })

  it('centres short names horizontally', async () => {
    const layout = await layoutField({ ...baseField, autoFit: false }, 'Ram')
    const run = layout.runs[0]
    expect(Math.abs(run.x + run.width / 2 - 150)).toBeLessThan(0.5)
  })
})

describe('PDF generation', () => {
  it('preserves pages and dimensions and inserts the guest name', async () => {
    const original = await samplePdf()
    const before = original.slice()
    const { bytes, warnings } = await generatePersonalizedPdf({
      pdfBytes: original,
      fields: [baseField],
      guestName: 'Rajesh Patel',
    })
    expect(Array.from(original)).toEqual(Array.from(before))
    const info = await inspectPdf(bytes)
    expect(info.pageCount).toBe(2)
    expect(info.pageDimensions[0]).toEqual({ width: 595, height: 842 })
    expect(info.pageDimensions[1]).toEqual({ width: 400, height: 400 })
    expect(warnings[0].overflow).toBe(false)
    const text = await extractText(bytes)
    expect(text).toContain('You are invited')
    expect(text).toContain('Rajesh Patel')
  })

  it('supports rotated pages', async () => {
    const original = await samplePdf(90)
    const info = await inspectPdf(original)
    expect(info.pageDimensions[0]).toEqual({ width: 842, height: 595 })
    const { bytes } = await generatePersonalizedPdf({
      pdfBytes: original,
      fields: [{ ...baseField, x: 500, y: 400 }],
      guestName: 'Rotated Guest',
    })
    expect(await extractText(bytes)).toContain('Rotated Guest')
  })

  it('places a field on a later page only', async () => {
    const { bytes } = await generatePersonalizedPdf({
      pdfBytes: await samplePdf(),
      fields: [{ ...baseField, pageNumber: 2, x: 20, y: 20, width: 200 }],
      guestName: 'Second Page Guest',
      includeTextLayer: true,
    })
    expect(await extractText(bytes, 1)).not.toContain('Second Page Guest')
    expect(await extractText(bytes, 2)).toContain('Second Page Guest')
  })

  it('keeps the name unselectable on designs without real text', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([420, 595]).drawRectangle({ x: 20, y: 20, width: 380, height: 555, color: rgb(0.9, 0.2, 0.2) })
    const outlined = await doc.save()
    const { bytes } = await generatePersonalizedPdf({ pdfBytes: outlined, fields: [baseField], guestName: 'Rajesh Patel' })
    expect(await extractText(bytes)).toBe('')
    expect(bytes.length).toBeGreaterThan(outlined.length)
  })

  it('renders Gujarati and Hindi names', async () => {
    const pdf = await samplePdf()
    for (const name of ['શ્રી રાજેશભાઈ પટેલ સહપરિવાર', 'श्री राजेश पटेल सपरिवार']) {
      const { bytes, warnings } = await generatePersonalizedPdf({ pdfBytes: pdf, fields: [baseField], guestName: name })
      expect(bytes.length).toBeGreaterThan(pdf.length)
      expect(warnings[0].missingFont).toBe(false)
    }
  })

  it('rejects non-PDF data', async () => {
    await expect(inspectPdf(new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(PdfProcessingError)
  })
})
