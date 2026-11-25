import { deflateSync, inflateSync } from 'node:zlib'

/** A minimal PNG encoder and decoder (8-bit RGB / RGBA): enough for the Dojo's portraits, no dependency. */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * RGBA pixels of an 8-bit RGB or RGBA, non-interlaced PNG (what tools such as TMST write), or null for
 * anything else.
 */
export function decodePng(data: Buffer): { width: number; height: number; rgba: Uint8Array } | null {
  if (data.length < 33 || !data.subarray(0, 8).equals(SIGNATURE)) return null
  let width = 0
  let height = 0
  let channels = 0
  const idat: Buffer[] = []
  for (let p = 8; p + 12 <= data.length; ) {
    const len = data.readUInt32BE(p)
    const type = data.toString('ascii', p + 4, p + 8)
    const body = data.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]]
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) return null
      channels = colour === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (!channels || !width || !height) return null
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }
  const stride = width * channels
  if (raw.length < (stride + 1) * height) return null
  // Undo the row filters (None, Sub, Up, Average, Paeth), in place.
  const px = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!
      const a = x >= channels ? px[row + x - channels]! : 0
      const b = y > 0 ? px[row - stride + x]! : 0
      const c = x >= channels && y > 0 ? px[row - stride + x - channels]! : 0
      let pred = 0
      if (filter === 1) pred = a
      else if (filter === 2) pred = b
      else if (filter === 3) pred = (a + b) >> 1
      else if (filter === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) return null
      px[row + x] = (v + pred) & 0xff
    }
  }
  if (channels === 4) return { width, height, rgba: px }
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = px[i * 3]!
    rgba[i * 4 + 1] = px[i * 3 + 1]!
    rgba[i * 4 + 2] = px[i * 3 + 2]!
    rgba[i * 4 + 3] = 255
  }
  return { width, height, rgba }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('pixel data does not match the size')
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // compression, filter and interlace methods: 0
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
