import {
  closePath,
  concatTransformationMatrix,
  EncryptedPDFError,
  fill,
  PDFDict,
  PDFName,
  PDFStream,
  fillAndStroke,
  lineTo,
  LineJoinStyle,
  moveTo,
  appendBezierCurve,
  PDFDocument,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { NameField, PageDimension } from '@/types'
import {
  glyphMatrix,
  hexToRgb,
  layoutField,
  type PathCommand,
  type ShapingFont,
  type TextLayout,
} from './TextLayoutService'
import { displayToUserSpace, fieldMatrix, multiply, type Matrix } from '@/utils/matrix'

export const MAX_TEMPLATE_SIZE_BYTES = 50 * 1024 * 1024
/** Assumed resolution for image templates when converting pixels to points. */
export const IMAGE_TEMPLATE_DPI = 150

export class PdfProcessingError extends Error {
  constructor(
    message: string,
    public code: 'encrypted' | 'invalid' | 'empty' | 'unsupported' | 'too_large',
  ) {
    super(message)
    this.name = 'PdfProcessingError'
  }
}

function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024))
  return head.includes('%PDF-')
}

export async function loadPdf(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (!isPdf(data)) throw new PdfProcessingError('This file is not a valid PDF document.', 'invalid')
  try {
    const doc = await PDFDocument.load(data, { updateMetadata: false })
    if (doc.getPageCount() === 0) throw new PdfProcessingError('The PDF has no pages.', 'empty')
    return doc
  } catch (err) {
    if (err instanceof PdfProcessingError) throw err
    if (err instanceof EncryptedPDFError || /encrypt/i.test(String(err))) {
      throw new PdfProcessingError(
        'This PDF is password-protected or encrypted. Please upload an unprotected copy.',
        'encrypted',
      )
    }
    throw new PdfProcessingError('The PDF appears to be damaged and could not be opened.', 'invalid')
  }
}

function normalizedRotation(page: PDFPage): number {
  return (((Math.round(page.getRotation().angle / 90) * 90) % 360) + 360) % 360
}

export function pageDisplaySize(page: PDFPage): PageDimension {
  const box = page.getCropBox()
  const rot = normalizedRotation(page)
  return rot === 90 || rot === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height }
}

export async function inspectPdf(bytes: ArrayBuffer | Uint8Array): Promise<{
  pageCount: number
  pageDimensions: PageDimension[]
}> {
  const doc = await loadPdf(bytes)
  const pages = doc.getPages()
  return { pageCount: pages.length, pageDimensions: pages.map(pageDisplaySize) }
}

/** Wraps a JPG/PNG losslessly in a single-page PDF sized to the image aspect ratio. */
export async function imageToPdf(bytes: ArrayBuffer, mimeType: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  let image
  try {
    image = mimeType === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch {
    throw new PdfProcessingError('The image file is damaged or in an unsupported format.', 'invalid')
  }
  const scale = 72 / IMAGE_TEMPLATE_DPI
  const width = image.width * scale
  const height = image.height * scale
  const page = doc.addPage([width, height])
  page.drawImage(image, { x: 0, y: 0, width, height })
  doc.setProducer('InvitePrint')
  return doc.save()
}

function pathOperators(cmds: PathCommand[]): PDFOperator[] {
  const ops: PDFOperator[] = []
  let cx = 0
  let cy = 0
  for (const c of cmds) {
    const v = c.values
    switch (c.type) {
      case 'M':
        ops.push(moveTo(v[0], v[1]))
        ;[cx, cy] = [v[0], v[1]]
        break
      case 'L':
        ops.push(lineTo(v[0], v[1]))
        ;[cx, cy] = [v[0], v[1]]
        break
      case 'Q': {
        // PDF has no quadratic curves; convert to an equivalent cubic.
        const [qx, qy, x, y] = v
        ops.push(
          appendBezierCurve(
            cx + (2 / 3) * (qx - cx),
            cy + (2 / 3) * (qy - cy),
            x + (2 / 3) * (qx - x),
            y + (2 / 3) * (qy - y),
            x,
            y,
          ),
        )
        ;[cx, cy] = [x, y]
        break
      }
      case 'C':
        ops.push(appendBezierCurve(v[0], v[1], v[2], v[3], v[4], v[5]))
        ;[cx, cy] = [v[4], v[5]]
        break
      case 'Z':
        ops.push(closePath())
        break
    }
  }
  return ops
}

class EmbeddedFonts {
  private cache = new Map<string, Promise<PDFFont | null>>()
  constructor(private doc: PDFDocument) {}
  get(font: ShapingFont): Promise<PDFFont | null> {
    let f = this.cache.get(font.key)
    if (!f) {
      f = this.doc.embedFont(font.bytes, { subset: true }).catch(() => null)
      this.cache.set(font.key, f)
    }
    return f
  }
}

/** Draws a computed layout onto a PDF page. Shares geometry with drawLayoutToCanvas. */
async function drawLayoutToPage(
  page: PDFPage,
  layout: TextLayout,
  field: Pick<NameField, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  fonts: EmbeddedFonts,
  includeTextLayer: boolean,
): Promise<void> {
  const box = page.getCropBox()
  const toUser = displayToUserSpace(box, normalizedRotation(page))
  const m: Matrix = multiply(toUser, fieldMatrix(field))
  const [r, g, b] = hexToRgb(layout.color)

  const ops: PDFOperator[] = [
    pushGraphicsState(),
    concatTransformationMatrix(...m),
    setFillingRgbColor(r, g, b),
    setStrokingRgbColor(r, g, b),
    setLineJoin(LineJoinStyle.Round),
  ]
  for (const glyph of layout.glyphs) {
    if (glyph.path.length === 0) continue
    ops.push(pushGraphicsState(), concatTransformationMatrix(...glyphMatrix(glyph, layout.skew)))
    ops.push(...pathOperators(glyph.path))
    if (glyph.stroke) ops.push(setLineWidth(glyph.stroke), fillAndStroke())
    else ops.push(fill())
    ops.push(popGraphicsState())
  }
  for (const u of layout.underlines) ops.push(rectangle(u.x, u.y, u.width, u.height), fill())
  page.pushOperators(...ops)

  if (includeTextLayer) {
    // Invisible real text so the name stays searchable and copyable.
    for (const run of layout.runs) {
      if (!run.text.trim()) continue
      const pdfFont = await fonts.get(run.font)
      if (!pdfFont) continue
      try {
        const natural = pdfFont.widthOfTextAtSize(run.text, run.size)
        if (!(natural > 0)) continue
        page.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(1, 0, 0, -1, run.x, run.baseline),
          concatTransformationMatrix(run.width / natural, 0, 0, 1, 0, 0),
        )
        page.drawText(run.text, { x: 0, y: 0, size: run.size, font: pdfFont, opacity: 0 })
        page.pushOperators(popGraphicsState())
      } catch {
        page.pushOperators(popGraphicsState())
      }
    }
  }
  page.pushOperators(popGraphicsState())
}

export interface GenerateOptions {
  pdfBytes: ArrayBuffer | Uint8Array
  fields: NameField[]
  guestName: string
  title?: string
  /**
   * Adds the name as invisible, selectable text. By default this only happens on pages
   * that already contain real text, so the name is never the only selectable thing on
   * a design that was exported as outlines or images.
   */
  includeTextLayer?: boolean
}

/** True if the page (or a form XObject it uses) references any font, i.e. it has real text. */
export function pageHasText(page: PDFPage): boolean {
  const context = page.doc.context
  const seen = new Set<PDFDict>()
  const visit = (resources: PDFDict | undefined, depth: number): boolean => {
    if (!resources || seen.has(resources) || depth > 10) return false
    seen.add(resources)
    const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (fonts && fonts.keys().length > 0) return true
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjects) return false
    for (const [, ref] of xobjects.entries()) {
      const xobj = context.lookup(ref)
      if (!(xobj instanceof PDFStream)) continue
      if (xobj.dict.lookupMaybe(PDFName.of('Subtype'), PDFName) !== PDFName.of('Form')) continue
      if (visit(xobj.dict.lookupMaybe(PDFName.of('Resources'), PDFDict), depth + 1)) return true
    }
    return false
  }
  return visit(page.node.Resources(), 0)
}

export interface FieldWarning {
  fieldId: string
  overflow: boolean
  missingFont: boolean
  fontSize: number
  skipped?: boolean
}

export interface GenerateResult {
  bytes: Uint8Array
  warnings: FieldWarning[]
}

export async function generatePersonalizedPdf(opts: GenerateOptions): Promise<GenerateResult> {
  if (!opts.guestName.trim()) throw new Error('Guest name is required.')
  if (opts.fields.length === 0) {
    throw new Error('This template has no guest name field. Open the template editor and add one.')
  }
  const doc = await loadPdf(opts.pdfBytes)
  doc.registerFontkit(fontkit)
  const fonts = new EmbeddedFonts(doc)
  const pages = doc.getPages()
  const warnings: FieldWarning[] = []
  // Decided before drawing, because the text layer itself adds fonts to the page.
  const textLayerByPage = pages.map((p) => opts.includeTextLayer ?? pageHasText(p))

  for (const field of opts.fields) {
    const page = pages[field.pageNumber - 1]
    if (!page) {
      warnings.push({ fieldId: field.id, overflow: false, missingFont: false, fontSize: 0, skipped: true })
      continue
    }
    const layout = await layoutField(field, opts.guestName)
    await drawLayoutToPage(page, layout, field, fonts, textLayerByPage[field.pageNumber - 1])
    warnings.push({
      fieldId: field.id,
      overflow: layout.overflow,
      missingFont: layout.missingFont,
      fontSize: layout.fontSize,
    })
  }

  if (opts.title) doc.setTitle(opts.title)
  return { bytes: await doc.save({ useObjectStreams: true }), warnings }
}
