import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => userData.dir, getVersion: () => '0.0.0-test' } }))

import { GameDefinition } from '../src/shared/registry-schema'
import { readDiscSerial } from '../src/main/services/install/disc-id'
import { SourcesService } from '../src/main/services/install/sources-service'
import { tempDir } from './helpers'

userData.dir = tempDir()

/** A minimal ISO 9660 image (2048-byte sectors): a root directory with the given files. */
function iso(files: Record<string, string>): Buffer {
  const sectors = 24 + Object.keys(files).length
  const img = Buffer.alloc(sectors * 2048)
  const record = (name: string, lba: number, size: number, dir = false) => {
    const nameBuf = Buffer.from(name, 'latin1')
    const len = 33 + nameBuf.length + (nameBuf.length % 2 === 0 ? 1 : 0)
    const r = Buffer.alloc(len)
    r[0] = len
    r.writeUInt32LE(lba, 2)
    r.writeUInt32LE(size, 10)
    r[25] = dir ? 2 : 0
    r[32] = nameBuf.length
    nameBuf.copy(r, 33)
    return r
  }
  // Primary volume descriptor at sector 16, root directory at sector 20, files from 22.
  img[16 * 2048] = 1
  img.write('CD001', 16 * 2048 + 1, 'latin1')
  record('\0', 20, 2048, true).copy(img, 16 * 2048 + 156)
  let pos = 20 * 2048
  for (const r of [record('\0', 20, 2048, true), record('\x01', 20, 2048, true)]) {
    r.copy(img, pos)
    pos += r.length
  }
  Object.entries(files).forEach(([name, content], i) => {
    const r = record(`${name};1`, 22 + i, content.length)
    r.copy(img, pos)
    pos += r.length
    img.write(content, (22 + i) * 2048, 'latin1')
  })
  return img
}

/** The same image as a raw mode 2 track (2352-byte sectors), as a PlayStation .bin is. */
function rawMode2(data: Buffer): Buffer {
  const n = data.length / 2048
  const out = Buffer.alloc(n * 2352)
  for (let i = 0; i < n; i++) {
    const s = i * 2352
    out[s] = 0
    out.fill(0xff, s + 1, s + 11)
    out[s + 11] = 0
    out[s + 15] = 2
    data.copy(out, s + 24, i * 2048, (i + 1) * 2048)
  }
  return out
}

const file = (name: string, content: Buffer) => {
  const p = join(tempDir(), name)
  writeFileSync(p, content)
  return p
}

describe('reading a disc serial', () => {
  it('reads the program SYSTEM.CNF boots, from an .iso and from a raw .bin', async () => {
    const img = iso({ 'SYSTEM.CNF': 'BOOT = cdrom:\\SLUS_004.02;1\r\nTCB = 4\r\n', 'SLUS_004.02': 'x' })
    expect(await readDiscSerial(file('t3.iso', img))).toBe('SLUS-00402')
    expect(await readDiscSerial(file('t3.bin', rawMode2(img)))).toBe('SLUS-00402')
  })

  it('reads a PS2 BOOT2 line and a PSP UMD_DATA.BIN', async () => {
    expect(await readDiscSerial(file('ttt.iso', iso({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SLUS_200.01;1\nVER = 1.00\n' })))).toBe('SLUS-20001')
    expect(await readDiscSerial(file('dr.iso', iso({ 'UMD_DATA.BIN': 'ULUS-10139|0001|G' })))).toBe('ULUS-10139')
  })

  it('falls back to the program in the root, and gives up on what is not a disc', async () => {
    expect(await readDiscSerial(file('t1.bin', rawMode2(iso({ 'SCES_000.05': 'x' }))))).toBe('SCES-00005')
    expect(await readDiscSerial(file('junk.bin', Buffer.alloc(40000)))).toBeNull()
    expect(await readDiscSerial(file('t2.chd', Buffer.alloc(100)))).toBeNull()
  })
})

describe('checking a chosen disc by its serial', () => {
  const games = [
    GameDefinition.parse({ id: 't2', name: 'Tekken 2', platform: 'PlayStation', extensions: ['bin', 'cue'], serials: [{ value: 'SCES-00255', region: 'Europe' }] }),
    GameDefinition.parse({ id: 't1', name: 'Tekken 1', platform: 'PlayStation', extensions: ['bin', 'cue'], serials: [{ value: 'SLUS-00006', region: 'USA' }] })
  ]
  const service = () => new SourcesService({ get: async () => ({ projects: [], games, issues: [] }) } as never)
  /** Choose the file and wait for the background check `assign` starts. */
  const check = async (s: SourcesService, gameId: string, path: string) => {
    await s.assign(gameId, path)
    for (let i = 0; i < 100 && !(await s.get(gameId))?.validation; i++) await new Promise((r) => setTimeout(r, 10))
    return (await s.get(gameId))?.validation
  }
  const disc = (serial: string) => file('disc.bin', rawMode2(iso({ 'SYSTEM.CNF': `BOOT = cdrom:\\${serial.replace('-', '_').replace(/(\d{3})(\d{2})$/, '$1.$2')};1\n` })))

  it('names the game and region of its own disc', async () => {
    const s = service()
    const v = await check(s, 't2', disc('SCES-00255'))
    expect(v).toMatchObject({ verdict: 'identified', matched: 'Tekken 2 Europe disc (SCES-00255)' })
  })

  it('says which game another game\'s disc belongs to', async () => {
    const s = service()
    const v = await check(s, 't2', disc('SLUS-00006'))
    expect(v).toMatchObject({ verdict: 'mismatch', belongsTo: 't1' })
    expect(v?.message).toMatch(/This is the Tekken 1 disc \(USA, SLUS-00006\): select it under Tekken 1/)
  })

  it('flags a serial it does not know for the game', async () => {
    const s = service()
    expect(await check(s, 't2', disc('SLPS-00300'))).toMatchObject({ verdict: 'mismatch', message: expect.stringMatching(/Serial SLPS-00300 is not a Tekken 2 disc the hub knows/) })
  })
})
