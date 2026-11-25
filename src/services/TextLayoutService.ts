import type { Font as HbFont } from 'harfbuzzjs'
import type { NameField } from '@/types'
import {
  DEFAULT_FONT_ID,
  fallbackFontIds,
  loadFontSource,
  MissingFontError,
  type FontSource,
  type ScriptName,
} from './FontService'
import { fieldMatrix, type Matrix } from '@/utils/matrix'

type HarfBuzz = typeof import('harfbuzzjs')

let hbPromise: Promise<HarfBuzz> | null = null
function loadHarfBuzz(): Promise<HarfBuzz> {
  hbPromise ??= import('harfbuzzjs').catch((err) => {
    hbPromise = null
    throw new Error(`Text shaping engine failed to load: ${err instanceof Error ? err.message : err}`)
  })
  return hbPromise
}

export interface PathCommand {
  type: string
  values: number[]
}

export interface ShapingFont {
  key: string
  fontId: string
  bold: boolean
  hb: HbFont
  upem: number
  ascender: number
  descender: number
  /** Stroke the outline to simulate bold when no bold face exists. */
  syntheticBold: boolean
  /** Raw font file bytes for the face actually used (for PDF text embedding). */
  bytes: ArrayBuffer
  glyphPaths: Map<number, PathCommand[]>
}

const shapingFontCache = new Map<string, Promise<ShapingFont>>()

export async function getShapingFont(source: FontSource, bold: boolean): Promise<ShapingFont> {
  const key = `${source.id}:${bold ? 'b' : 'r'}`
  let cached = shapingFontCache.get(key)
  if (!cached) {
    cached = (async () => {
      const hb = await loadHarfBuzz()
      const useBoldFile = bold && !!source.boldBytes
      const bytes = useBoldFile ? source.boldBytes! : source.bytes
      const face = new hb.Face(new hb.Blob(bytes))
      if (!face.upem) throw new Error('Font file could not be read.')
      const font = new hb.Font(face)
      let syntheticBold = bold && !useBoldFile
      if (bold && !useBoldFile && source.variable) {
        font.setVariations([new hb.Variation('wght', 700)])
        syntheticBold = false
      }
      const ext = font.hExtents()
      return {
        key,
        fontId: source.id,
        bold,
        hb: font,
        upem: face.upem,
        ascender: ext.ascender,
        descender: Math.abs(ext.descender),
        syntheticBold,
        bytes,
        glyphPaths: new Map(),
      }
    })()
    cached.catch(() => shapingFontCache.delete(key))
    shapingFontCache.set(key, cached)
  }
  return cached
}

export async function getHbFont(source: FontSource, bold: boolean): Promise<HbFont> {
  return (await getShapingFont(source, bold)).hb
}

export function forgetShapingFont(fontId: string): void {
  for (const key of [...shapingFontCache.keys()]) {
    if (key.startsWith(`${fontId}:`)) shapingFontCache.delete(key)
  }
}

function glyphPath(font: ShapingFont, gid: number): PathCommand[] {
  let path = font.glyphPaths.get(gid)
  if (!path) {
    path = font.hb.glyphToJson(gid) as PathCommand[]
    font.glyphPaths.set(gid, path)
  }
  return path
}

// ---------------------------------------------------------------------------
// Script segmentation and font fallback

function scriptOf(cp: number): ScriptName | 'common' {
  if (cp === 0x0964 || cp === 0x0965) return 'common'
  if (cp >= 0x0a80 && cp <= 0x0aff) return 'gujarati'
  if ((cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff) || (cp >= 0x1cd0 && cp <= 0x1cff))
    return 'devanagari'
  if (
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a) ||
    (cp >= 0xc0 && cp <= 0x24f && cp !== 0xd7 && cp !== 0xf7) ||
    (cp >= 0x1e00 && cp <= 0x1eff)
  )
    return 'latin'
  if (cp < 0xc0 || (cp >= 0x2000 && cp <= 0x206f) || cp === 0xd7 || cp === 0xf7 || (cp >= 0x300 && cp <= 0x36f))
    return 'common'
  return 'other'
}

const IGNORABLE = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff])

function covers(font: ShapingFont, cp: number): boolean {
  return IGNORABLE.has(cp) || font.hb.glyph(cp) !== undefined
}

interface FontRun {
  font: ShapingFont
  text: string
}

class FontResolver {
  private fonts = new Map<string, ShapingFont | null>()
  missingPrimary = false

  constructor(
    private primaryId: string,
    private bold: boolean,
  ) {}

  async get(id: string): Promise<ShapingFont | null> {
    if (this.fonts.has(id)) return this.fonts.get(id)!
    let font: ShapingFont | null = null
    try {
      font = await getShapingFont(await loadFontSource(id), this.bold)
    } catch (err) {
      if (id === this.primaryId && err instanceof MissingFontError) this.missingPrimary = true
      else if (id !== this.primaryId) throw err
    }
    this.fonts.set(id, font)
    return font
  }

  async primary(): Promise<ShapingFont> {
    return (await this.get(this.primaryId)) ?? (await this.get(DEFAULT_FONT_ID))!
  }

  async runs(text: string): Promise<FontRun[]> {
    const chars = [...text]
    const assigned: (ShapingFont | null)[] = new Array(chars.length).fill(null)
    const primary = await this.primary()

    for (let i = 0; i < chars.length; i++) {
      const cp = chars[i].codePointAt(0)!
      const script = scriptOf(cp)
      if (script === 'common') continue
      if (covers(primary, cp)) {
        assigned[i] = primary
        continue
      }
      for (const id of fallbackFontIds(script, this.primaryId)) {
        const f = await this.get(id)
        if (f && covers(f, cp)) {
          assigned[i] = f
          break
        }
      }
      assigned[i] ??= primary
    }

    for (let i = 0; i < chars.length; i++) {
      if (assigned[i]) continue
      const cp = chars[i].codePointAt(0)!
      const prev = i > 0 ? assigned[i - 1] : null
      let next: ShapingFont | null = null
      for (let j = i + 1; j < chars.length; j++) {
        if (assigned[j]) {
          next = assigned[j]
          break
        }
      }
      if (prev && covers(prev, cp)) assigned[i] = prev
      else if (next && covers(next, cp)) assigned[i] = next
      else if (covers(primary, cp)) assigned[i] = primary
      else assigned[i] = (await this.get(DEFAULT_FONT_ID)) ?? primary
    }

    const runs: FontRun[] = []
    chars.forEach((ch, i) => {
      const font = assigned[i]!
      const last = runs[runs.length - 1]
      if (last && last.font === font) last.text += ch
      else runs.push({ font, text: ch })
    })
    return runs
  }

  usedFonts(): ShapingFont[] {
    return [...this.fonts.values()].filter((f): f is ShapingFont => !!f)
  }
}

// ---------------------------------------------------------------------------
// Shaping

interface ShapedGlyph {
  gid: number
  ax: number
  dx: number
  dy: number
  /** True when this glyph ends a cluster (letter spacing goes after it). */
  clusterEnd: boolean
}

interface ShapedRun {
  font: ShapingFont
  text: string
  glyphs: ShapedGlyph[]
  advance: number
}

interface ShapedLine {
  text: string
  runs: ShapedRun[]
  gaps: number
}

async function shapeRun(run: FontRun): Promise<ShapedRun> {
  const hb = await loadHarfBuzz()
  const buffer = new hb.Buffer()
  buffer.addText(run.text)
  buffer.guessSegmentProperties()
  hb.shape(run.font.hb, buffer)
  const infos = buffer.getGlyphInfos()
  const positions = buffer.getGlyphPositions()
  let advance = 0
  const glyphs = infos.map((info, i) => {
    const p = positions[i]
    advance += p.xAdvance
    const next = infos[i + 1]
    return {
      gid: info.codepoint,
      ax: p.xAdvance,
      dx: p.xOffset,
      dy: p.yOffset,
      clusterEnd: !next || next.cluster !== info.cluster,
    }
  })
  return { font: run.font, text: run.text, glyphs, advance }
}

class LineShaper {
  private cache = new Map<string, Promise<ShapedLine>>()
  constructor(private resolver: FontResolver) {}

  shape(text: string): Promise<ShapedLine> {
    let cached = this.cache.get(text)
    if (!cached) {
      cached = (async () => {
        const runs = await Promise.all((await this.resolver.runs(text)).map(shapeRun))
        let gaps = 0
        runs.forEach((r) => r.glyphs.forEach((g) => g.clusterEnd && gaps++))
        return { text, runs, gaps: Math.max(0, gaps - 1) }
      })()
      this.cache.set(text, cached)
    }
    return cached
  }
}

function lineWidth(line: ShapedLine, size: number, letterSpacing: number): number {
  let w = 0
  for (const r of line.runs) w += (r.advance * size) / r.font.upem
  return w + letterSpacing * line.gaps
}

// ---------------------------------------------------------------------------
// Layout

export interface GlyphDraw {
  gid: number
  path: PathCommand[]
  /** Glyph origin on the baseline, in field-local points (y down). */
  x: number
  y: number
  /** Points per font unit. */
  scale: number
  /** Outline stroke width in font units for synthetic bold, 0 for none. */
  stroke: number
}

export interface TextRunPlacement {
  text: string
  font: ShapingFont
  x: number
  baseline: number
  size: number
  width: number
}

export interface TextLayout {
  text: string
  glyphs: GlyphDraw[]
  underlines: { x: number; y: number; width: number; height: number }[]
  runs: TextRunPlacement[]
  fontSize: number
  lines: string[]
  overflow: boolean
  /** Text was reduced from the configured size to fit. */
  shrunk: boolean
  skew: number
  color: string
  missingFont: boolean
}

export type LayoutFieldOptions = Pick<
  NameField,
  | 'width'
  | 'height'
  | 'fontId'
  | 'fontSize'
  | 'minimumFontSize'
  | 'fontColor'
  | 'fontWeight'
  | 'fontStyle'
  | 'underline'
  | 'alignment'
  | 'verticalAlignment'
  | 'letterSpacing'
  | 'lineSpacing'
  | 'prefix'
  | 'suffix'
  | 'autoFit'
  | 'multiline'
  | 'textTransform'
>

export function composeFieldText(field: Pick<NameField, 'prefix' | 'suffix' | 'textTransform'>, guestName: string): string {
  const name = guestName.normalize('NFC').trim()
  if (!name) return ''
  let text = [field.prefix?.trim(), name, field.suffix?.trim()].filter(Boolean).join(' ')
  if (field.textTransform === 'uppercase') text = text.toLocaleUpperCase()
  else if (field.textTransform === 'lowercase') text = text.toLocaleLowerCase()
  return text
}

const ITALIC_SKEW = Math.tan((12 * Math.PI) / 180)
const EPS = 0.01

async function wrapParagraph(
  shaper: LineShaper,
  paragraph: string,
  maxWidth: number,
  size: number,
  ls: number,
): Promise<ShapedLine[]> {
  const words = paragraph.split(' ').filter(Boolean)
  if (words.length === 0) return []
  const lines: ShapedLine[] = []
  let current = words[0]
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`
    if (lineWidth(await shaper.shape(candidate), size, ls) <= maxWidth + EPS) current = candidate
    else {
      lines.push(await shaper.shape(current))
      current = words[i]
    }
  }
  lines.push(await shaper.shape(current))
  return lines
}

export async function layoutText(text: string, field: LayoutFieldOptions): Promise<TextLayout> {
  const bold = field.fontWeight === 'bold'
  const resolver = new FontResolver(field.fontId || DEFAULT_FONT_ID, bold)
  const shaper = new LineShaper(resolver)
  const ls = field.letterSpacing || 0
  const lineSpacing = field.lineSpacing > 0 ? field.lineSpacing : 1.2
  const boxW = Math.max(1, field.width)
  const boxH = Math.max(1, field.height)
  const maxSize = Math.max(1, field.fontSize)
  const minSize = field.autoFit ? Math.max(1, Math.min(field.minimumFontSize || maxSize, maxSize)) : maxSize

  const empty: TextLayout = {
    text,
    glyphs: [],
    underlines: [],
    runs: [],
    fontSize: maxSize,
    lines: [],
    overflow: false,
    shrunk: false,
    skew: 0,
    color: field.fontColor,
    missingFont: false,
  }
  if (!text) {
    await resolver.primary()
    return { ...empty, missingFont: resolver.missingPrimary }
  }

  const normalized = field.multiline ? text.replace(/[^\S\n]+/g, ' ') : text.replace(/\s+/g, ' ')
  const paragraphs = normalized.split('\n').map((p) => p.trim())

  const metrics = () => {
    const fonts = resolver.usedFonts()
    const asc = Math.max(...fonts.map((f) => f.ascender / f.upem))
    const desc = Math.max(...fonts.map((f) => f.descender / f.upem))
    return { asc, desc }
  }

  const fit = async (size: number) => {
    let lines: ShapedLine[] = []
    if (field.multiline) {
      for (const p of paragraphs) lines.push(...(await wrapParagraph(shaper, p, boxW, size, ls)))
    } else {
      lines = [await shaper.shape(paragraphs.join(' '))]
    }
    const { asc, desc } = metrics()
    const lineHeight = (asc + desc) * size * lineSpacing
    const blockH = (asc + desc) * size + Math.max(0, lines.length - 1) * lineHeight
    const maxW = Math.max(0, ...lines.map((l) => lineWidth(l, size, ls)))
    const fits = maxW <= boxW + EPS && blockH <= boxH + EPS
    return { lines, fits, asc, desc, lineHeight, blockH }
  }

  let size = maxSize
  let result = await fit(size)
  if (!result.fits && field.autoFit) {
    // Coarse-to-fine search keeps long batches fast while landing within 0.25pt.
    let lo = minSize
    let hi = maxSize
    let best: { size: number; result: typeof result } | null = null
    const low = await fit(lo)
    if (low.fits) {
      best = { size: lo, result: low }
      while (hi - lo > 0.25) {
        const mid = (lo + hi) / 2
        const r = await fit(mid)
        if (r.fits) {
          lo = mid
          best = { size: mid, result: r }
        } else hi = mid
      }
    }
    if (best) {
      size = Math.floor(best.size * 4) / 4
      result = await fit(size)
      if (!result.fits) {
        size = best.size
        result = best.result
      }
    } else {
      size = minSize
      result = low
    }
  }

  const { lines, asc, lineHeight, blockH } = result
  let top = 0
  if (field.verticalAlignment === 'middle') top = (boxH - blockH) / 2
  else if (field.verticalAlignment === 'bottom') top = boxH - blockH

  const glyphs: GlyphDraw[] = []
  const underlines: TextLayout['underlines'] = []
  const runs: TextRunPlacement[] = []

  lines.forEach((line, li) => {
    const width = lineWidth(line, size, ls)
    let x = 0
    if (field.alignment === 'center') x = (boxW - width) / 2
    else if (field.alignment === 'right') x = boxW - width
    const baseline = top + asc * size + li * lineHeight
    const lineStart = x
    const totalGlyphs = line.runs.reduce((n, r) => n + r.glyphs.length, 0)
    let index = 0
    for (const run of line.runs) {
      const scale = size / run.font.upem
      const runStart = x
      const stroke = run.font.syntheticBold ? run.font.upem * 0.035 : 0
      for (const g of run.glyphs) {
        index++
        glyphs.push({
          gid: g.gid,
          path: glyphPath(run.font, g.gid),
          x: x + g.dx * scale,
          y: baseline - g.dy * scale,
          scale,
          stroke,
        })
        x += g.ax * scale
        if (g.clusterEnd && index < totalGlyphs) x += ls
      }
      runs.push({ text: run.text, font: run.font, x: runStart, baseline, size, width: x - runStart })
    }
    if (field.underline && width > 0) {
      underlines.push({
        x: lineStart,
        y: baseline + size * 0.1,
        width,
        height: Math.max(0.5, size * 0.06),
      })
    }
  })

  return {
    text,
    glyphs,
    underlines,
    runs,
    fontSize: size,
    lines: lines.map((l) => l.text),
    overflow: !result.fits,
    shrunk: size < maxSize - EPS,
    skew: field.fontStyle === 'italic' ? ITALIC_SKEW : 0,
    color: field.fontColor,
    missingFont: resolver.missingPrimary,
  }
}

export function layoutField(field: LayoutFieldOptions, guestName: string): Promise<TextLayout> {
  return layoutText(composeFieldText(field, guestName), field)
}

/** Glyph-space to field-space matrix for one glyph. */
export function glyphMatrix(g: GlyphDraw, skew: number): Matrix {
  return [g.scale, 0, g.scale * skew, -g.scale, g.x, g.y]
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || '#000000').replace('#', '').trim()
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = Number.parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// ---------------------------------------------------------------------------
// Canvas rendering (preview). Uses exactly the same geometry as the PDF renderer.

const path2dCache = new WeakMap<PathCommand[], Path2D>()

function toPath2D(cmds: PathCommand[]): Path2D {
  let p = path2dCache.get(cmds)
  if (!p) {
    p = new Path2D()
    for (const c of cmds) {
      const v = c.values
      if (c.type === 'M') p.moveTo(v[0], v[1])
      else if (c.type === 'L') p.lineTo(v[0], v[1])
      else if (c.type === 'Q') p.quadraticCurveTo(v[0], v[1], v[2], v[3])
      else if (c.type === 'C') p.bezierCurveTo(v[0], v[1], v[2], v[3], v[4], v[5])
      else if (c.type === 'Z') p.closePath()
    }
    path2dCache.set(cmds, p)
  }
  return p
}

/**
 * Draws a layout onto a canvas whose current transform maps page display
 * points to device pixels.
 */
export function drawLayoutToCanvas(
  ctx: CanvasRenderingContext2D,
  layout: TextLayout,
  field: Pick<NameField, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
): void {
  const fm = fieldMatrix(field)
  ctx.save()
  ctx.transform(...fm)
  ctx.fillStyle = layout.color
  ctx.strokeStyle = layout.color
  ctx.lineJoin = 'round'
  for (const g of layout.glyphs) {
    if (g.path.length === 0) continue
    ctx.save()
    ctx.transform(...glyphMatrix(g, layout.skew))
    const p = toPath2D(g.path)
    ctx.fill(p)
    if (g.stroke) {
      ctx.lineWidth = g.stroke
      ctx.stroke(p)
    }
    ctx.restore()
  }
  for (const u of layout.underlines) ctx.fillRect(u.x, u.y, u.width, u.height)
  ctx.restore()
}
