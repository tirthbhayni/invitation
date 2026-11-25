import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { configureFontLoaders } from '@/services/FontService'

export function useLocalFonts() {
  configureFontLoaders({
    bytes: async (path) => {
      const buf = await readFile(resolve(__dirname, '../public', path))
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    },
    custom: async () => undefined,
  })
}
