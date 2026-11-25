// Generates the PWA PNG icons from simple vector shapes (no image dependencies).
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function inRoundRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r)
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
function distToSegment(px, py, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
}

// Colour at a point in a 64×64 design space.
function sample(x, y) {
  const green = [22, 163, 74]
  if (!inRoundRect(x, y, 0, 0, 64, 64, 14)) return null
  if (inRoundRect(x, y, 14, 18, 36, 28, 3)) {
    const d = Math.min(distToSegment(x, y, 14, 21, 32, 34), distToSegment(x, y, 32, 34, 50, 21))
    return d < 1.75 ? green : [255, 255, 255]
  }
  return green
}

function render(size) {
  const ss = 4
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((px + (sx + 0.5) / ss) / size) * 64, ((py + (sy + 0.5) / ss) / size) * 64)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a++
          }
        }
      const o = py * (size * 4 + 1) + 1 + px * 4
      raw[o] = a ? r / a : 0
      raw[o + 1] = a ? g / a : 0
      raw[o + 2] = a ? b / a : 0
      raw[o + 3] = (a / (ss * ss)) * 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync('public/icons', { recursive: true })
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, render(size))
console.log('Icons written to public/icons')
