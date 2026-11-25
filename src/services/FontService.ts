import type { FontRecord } from '@/types'

export interface BuiltinFont {
  id: string
  name: string
  family: string
  regular: string
  bold?: string
  /** Variable font with a wght axis; bold uses wght=700. */
  variable?: boolean
  category: 'sans' | 'serif'
  supportedLanguages: string[]
}

export const BUILTIN_FONTS: BuiltinFont[] = [
  {
    id: 'noto-sans',
    name: 'Noto Sans',
    family: 'Noto Sans',
    regular: 'fonts/NotoSans-Regular.ttf',
    bold: 'fonts/NotoSans-Bold.ttf',
    category: 'sans',
    supportedLanguages: ['English'],
  },
  {
    id: 'noto-serif',
    name: 'Noto Serif',
    family: 'Noto Serif',
    regular: 'fonts/NotoSerif-Regular.ttf',
    bold: 'fonts/NotoSerif-Bold.ttf',
    category: 'serif',
    supportedLanguages: ['English'],
  },
  {
    id: 'noto-sans-gujarati',
    name: 'Noto Sans Gujarati',
    family: 'Noto Sans Gujarati',
    regular: 'fonts/NotoSansGujarati-Regular.ttf',
    bold: 'fonts/NotoSansGujarati-Bold.ttf',
    category: 'sans',
    supportedLanguages: ['Gujarati'],
  },
  {
    id: 'noto-serif-gujarati',
    name: 'Noto Serif Gujarati',
    family: 'Noto Serif Gujarati',
    regular: 'fonts/NotoSerifGujarati-Regular.ttf',
    bold: 'fonts/NotoSerifGujarati-Bold.ttf',
    category: 'serif',
    supportedLanguages: ['Gujarati'],
  },
  {
    id: 'noto-sans-devanagari',
    name: 'Noto Sans Devanagari',
    family: 'Noto Sans Devanagari',
    regular: 'fonts/NotoSansDevanagari-Regular.ttf',
    bold: 'fonts/NotoSansDevanagari-Bold.ttf',
    category: 'sans',
    supportedLanguages: ['Hindi', 'Marathi'],
  },
  {
    id: 'roboto',
    name: 'Roboto',
    family: 'Roboto',
    regular: 'fonts/Roboto-Variable.ttf',
    variable: true,
    category: 'sans',
    supportedLanguages: ['English'],
  },
  {
    id: 'poppins',
    name: 'Poppins',
    family: 'Poppins',
    regular: 'fonts/Poppins-Regular.ttf',
    bold: 'fonts/Poppins-Bold.ttf',
    category: 'sans',
    supportedLanguages: ['English', 'Hindi', 'Marathi'],
  },
  {
    id: 'montserrat',
    name: 'Montserrat',
    family: 'Montserrat',
    regular: 'fonts/Montserrat-Variable.ttf',
    variable: true,
    category: 'sans',
    supportedLanguages: ['English'],
  },
]

export const DEFAULT_FONT_ID = 'noto-sans'

export type ScriptName = 'latin' | 'gujarati' | 'devanagari' | 'other'

/** Fonts tried, in order, when the selected font cannot display a script. */
const SCRIPT_FALLBACKS: Record<ScriptName, { sans: string[]; serif: string[] }> = {
  latin: { sans: ['noto-sans'], serif: ['noto-serif', 'noto-sans'] },
  gujarati: {
    sans: ['noto-sans-gujarati', 'noto-serif-gujarati'],
    serif: ['noto-serif-gujarati', 'noto-sans-gujarati'],
  },
  devanagari: { sans: ['noto-sans-devanagari', 'poppins'], serif: ['noto-sans-devanagari'] },
  other: { sans: ['noto-sans', 'noto-serif'], serif: ['noto-serif', 'noto-sans'] },
}

export function fallbackFontIds(script: ScriptName, primaryId: string): string[] {
  const builtin = BUILTIN_FONTS.find((f) => f.id === primaryId)
  const group = builtin?.category === 'serif' ? 'serif' : 'sans'
  return SCRIPT_FALLBACKS[script][group]
}

export interface FontSource {
  id: string
  bytes: ArrayBuffer
  boldBytes?: ArrayBuffer
  variable: boolean
}

type BytesLoader = (path: string) => Promise<ArrayBuffer>
type CustomFontLoader = (id: string) => Promise<FontRecord | undefined>

function defaultBytesLoader(path: string): Promise<ArrayBuffer> {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  const origin = typeof self !== 'undefined' && self.location ? self.location.origin : ''
  const url = new URL(base + path, origin || 'http://localhost').href
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not load font file ${path} (HTTP ${r.status})`)
    return r.arrayBuffer()
  })
}

async function defaultCustomLoader(id: string): Promise<FontRecord | undefined> {
  const { db } = await import('@/database/db')
  return db.fonts.get(id)
}

let bytesLoader: BytesLoader = defaultBytesLoader
let customLoader: CustomFontLoader = defaultCustomLoader
const sourceCache = new Map<string, Promise<FontSource>>()

/** Overrides how font files are read (used by tests and the worker). */
export function configureFontLoaders(options: {
  bytes?: BytesLoader
  custom?: CustomFontLoader
}): void {
  if (options.bytes) bytesLoader = options.bytes
  if (options.custom) customLoader = options.custom
  sourceCache.clear()
}

export function isBuiltinFont(id: string): boolean {
  return BUILTIN_FONTS.some((f) => f.id === id)
}

export function loadFontSource(id: string): Promise<FontSource> {
  let cached = sourceCache.get(id)
  if (!cached) {
    cached = (async (): Promise<FontSource> => {
      const builtin = BUILTIN_FONTS.find((f) => f.id === id)
      if (builtin) {
        const [bytes, boldBytes] = await Promise.all([
          bytesLoader(builtin.regular),
          builtin.bold ? bytesLoader(builtin.bold) : Promise.resolve(undefined),
        ])
        return { id, bytes, boldBytes, variable: !!builtin.variable }
      }
      const record = await customLoader(id)
      if (!record) throw new MissingFontError(id)
      return { id, bytes: await record.fileBlob.arrayBuffer(), variable: false }
    })()
    cached.catch(() => sourceCache.delete(id))
    sourceCache.set(id, cached)
  }
  return cached
}

export function forgetFont(id: string): void {
  sourceCache.delete(id)
}

export class MissingFontError extends Error {
  constructor(public fontId: string) {
    super('The selected font is no longer available. A default font was used instead.')
    this.name = 'MissingFontError'
  }
}

export async function addCustomFont(file: File): Promise<FontRecord> {
  const { family, languages } = await inspectFontFile(file)
  const { db } = await import('@/database/db')
  const { createId } = await import('@/utils/id')
  const { withStorage } = await import('./StorageService')
  const record: FontRecord = {
    id: `custom-${createId()}`,
    name: family,
    family,
    fileBlob: new Blob([await file.arrayBuffer()], { type: file.type || 'font/ttf' }),
    fileType: /\.otf$/i.test(file.name) ? 'otf' : 'ttf',
    supportedLanguages: languages,
    createdAt: Date.now(),
  }
  await withStorage(() => db.fonts.add(record))
  return record
}

export async function deleteCustomFont(id: string): Promise<void> {
  const { db } = await import('@/database/db')
  await db.fonts.delete(id)
  forgetFont(id)
}

const TTF_MAGIC = [0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */]

export const MAX_FONT_SIZE_BYTES = 20 * 1024 * 1024

/** Validates a user-supplied font file and detects which languages it covers. */
export async function inspectFontFile(file: File): Promise<{ family: string; languages: string[] }> {
  if (file.size > MAX_FONT_SIZE_BYTES) throw new Error('Font file is larger than 20 MB.')
  const bytes = await file.arrayBuffer()
  const magic = new DataView(bytes).getUint32(0)
  if (!TTF_MAGIC.includes(magic)) {
    throw new Error('This is not a valid TTF or OTF font file.')
  }
  const { getHbFont } = await import('./TextLayoutService')
  const font = await getHbFont({ id: `inspect:${file.name}`, bytes, variable: false }, false)
  const languages: string[] = []
  const has = (s: string) => [...s].every((ch) => font.glyph(ch.codePointAt(0)!) !== undefined)
  if (has('AaZz')) languages.push('English')
  if (has('કખગ')) languages.push('Gujarati')
  if (has('कखग')) languages.push('Hindi', 'Marathi')
  if (languages.length === 0) languages.push('Other')
  const family = file.name.replace(/\.(ttf|otf)$/i, '').replace(/[-_]+/g, ' ').trim()
  return { family, languages }
}
