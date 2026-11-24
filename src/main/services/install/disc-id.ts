import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { extname } from 'node:path'

/**
 * Reads a disc image's serial number (e.g. `SLUS-00402`) the way the projects
 * identify discs: the program the PlayStation's SYSTEM.CNF boots (PS1, PS2),
 * or a PSP disc's UMD_DATA.BIN. Works on .iso (2048-byte sectors) and raw
 * .bin tracks (2352-byte sectors, mode 1 or 2); a .cue is read through its
 * first data file by the caller. Null when the image has no ISO 9660 file
 * system or no serial (a compressed .chd, another kind of disc).
 */
export async function readDiscSerial(path: string): Promise<string | null> {
  const ext = extname(path).slice(1).toLowerCase()
  if (ext !== 'iso' && ext !== 'bin' && ext !== 'img') return null
  let file: FileHandle | null = null
  try {
    file = await fs.open(path, 'r')
    const layout = await sectorLayout(file)
    const read = (lba: number, bytes: number) => readData(file!, layout, lba, bytes)

    // Primary volume descriptor (sector 16): "CD001", then the root directory's record at 156.
    const pvd = await read(16, 2048)
    if (pvd.toString('latin1', 1, 6) !== 'CD001') return null
    const rootLba = pvd.readUInt32LE(156 + 2)
    const rootSize = Math.min(pvd.readUInt32LE(156 + 10), 64 * 2048)
    const root = await read(rootLba, rootSize)

    const cnf = findEntry(root, 'SYSTEM.CNF')
    if (cnf) {
      const text = (await read(cnf.lba, Math.min(cnf.size, 2048))).toString('latin1')
      const m = /BOOT2?\s*=\s*cdrom0?:\\?(?:[^\r\n]*\\)?([A-Z]{4})_(\d{3})\.(\d{2})/i.exec(text)
      if (m) return `${m[1]!.toUpperCase()}-${m[2]}${m[3]}`
    }
    const umd = findEntry(root, 'UMD_DATA.BIN')
    if (umd) {
      const m = /^([A-Z]{4})-(\d{5})/.exec((await read(umd.lba, 16)).toString('latin1'))
      if (m) return `${m[1]}-${m[2]}`
    }
    // Early discs without SYSTEM.CNF: the program itself sits in the root as SLUS_000.06.
    const exe = listEntries(root).map((e) => /^([A-Z]{4})_(\d{3})\.(\d{2})$/.exec(e.name)).find(Boolean)
    return exe ? `${exe[1]}-${exe[2]}${exe[3]}` : null
  } catch {
    return null
  } finally {
    await file?.close().catch(() => {})
  }
}

interface Layout {
  /** Bytes per sector in the file. */
  sector: number
  /** Where the 2048 bytes of user data start inside a sector. */
  offset: number
}

const SYNC = Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00])

/** A raw track starts every sector with the sync pattern; its mode byte says where the data is. */
async function sectorLayout(file: FileHandle): Promise<Layout> {
  const head = Buffer.alloc(16)
  await file.read(head, 0, 16, 0)
  if (!head.subarray(0, 12).equals(SYNC)) return { sector: 2048, offset: 0 }
  return { sector: 2352, offset: head[15] === 2 ? 24 : 16 }
}

async function readData(file: FileHandle, layout: Layout, lba: number, bytes: number): Promise<Buffer> {
  const out = Buffer.alloc(bytes)
  for (let done = 0, n = 0; done < bytes; n++) {
    const chunk = Math.min(2048, bytes - done)
    const { bytesRead } = await file.read(out, done, chunk, (lba + n) * layout.sector + layout.offset)
    if (bytesRead === 0) break
    done += chunk
  }
  return out
}

interface Entry {
  name: string
  lba: number
  size: number
}

/** The records of an ISO 9660 directory (names without their `;1` version). */
function listEntries(dir: Buffer): Entry[] {
  const entries: Entry[] = []
  let pos = 0
  while (pos < dir.length) {
    const len = dir[pos]!
    if (len === 0) {
      // Records never cross a sector: skip to the next one.
      pos = (Math.floor(pos / 2048) + 1) * 2048
      continue
    }
    if (pos + 33 > dir.length) break
    const nameLen = dir[pos + 32]!
    const name = dir.toString('latin1', pos + 33, pos + 33 + nameLen).replace(/;\d+$/, '')
    entries.push({ name: name.toUpperCase(), lba: dir.readUInt32LE(pos + 2), size: dir.readUInt32LE(pos + 10) })
    pos += len
  }
  return entries
}

function findEntry(dir: Buffer, name: string): Entry | undefined {
  return listEntries(dir).find((e) => e.name === name)
}
