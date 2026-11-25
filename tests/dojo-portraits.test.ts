import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => userData.dir, getVersion: () => '0.0.0-test' }, shell: {} }))

import { decodePortrait, PORTRAIT_FILES, PORTRAIT_HEIGHT, PORTRAIT_WIDTH } from '../src/shared/dojo-portraits'
import { encodePng } from '../src/main/services/dojo/png'
import { PortraitService } from '../src/main/services/dojo/portrait-service'
import { tempDir } from './helpers'

userData.dir = tempDir()
const W = PORTRAIT_WIDTH
const H = PORTRAIT_HEIGHT

/** A portrait file as Tekken 3 Expanded writes it: transparent, with one red texel at (x, y). */
function portraitFile(x = 0, y = 0): Buffer {
  const b = Buffer.alloc(W * H * 2)
  b.writeUInt16LE(31 | 0x8000, (y * W + x) * 2) // pure red, semi-transparency flag set
  return b
}

describe('portrait pixels', () => {
  it('turns 15-bit texels into RGBA, 0 transparent', () => {
    const rgba = decodePortrait(portraitFile(2, 1))!
    const at = (x: number, y: number) => Array.from(rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 4))
    expect(at(2, 1)).toEqual([255, 0, 0, 255])
    expect(at(0, 0)).toEqual([0, 0, 0, 0])
  })

  it('refuses files of another size', () => {
    expect(decodePortrait(new Uint8Array(100))).toBeNull()
  })

  it('writes a PNG that holds the same pixels', () => {
    const rgba = decodePortrait(portraitFile(5, 3))!
    const png = encodePng(rgba, W, H)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.readUInt32BE(16)).toBe(W)
    expect(png.readUInt32BE(20)).toBe(H)
    const idatLen = png.readUInt32BE(33)
    expect(png.toString('ascii', 37, 41)).toBe('IDAT')
    const raw = inflateSync(png.subarray(41, 41 + idatLen))
    const row = 3 * (W * 4 + 1)
    expect(raw[row]).toBe(0) // no filter
    expect(Array.from(raw.subarray(row + 1 + 5 * 4, row + 1 + 6 * 4))).toEqual([255, 0, 0, 255])
  })
})

function setup(opts: { enabled?: boolean; layout?: string } = {}) {
  const install = tempDir()
  const mods = join(install, ...(opts.layout ?? 'build-release/mods').split('/'))
  mkdirSync(join(mods, 'arcade-stages'), { recursive: true })
  mkdirSync(join(mods, 'ttt1'), { recursive: true })
  writeFileSync(join(mods, PORTRAIT_FILES.jin!), portraitFile())
  writeFileSync(join(mods, PORTRAIT_FILES.kazuya!), portraitFile(1, 1))
  writeFileSync(join(mods, 'arcade-stages', 'face-03-portrait-hd.bin'), Buffer.alloc(10)) // King: broken
  const state = { enabled: opts.enabled ?? true, installed: true }
  const cache = join(tempDir(), 'dojo-portraits')
  const service = new PortraitService({
    installed: async () => (state.installed ? { 'tekken3-expanded': { installPath: install } } : {}),
    enabled: async () => state.enabled,
    cacheDir: () => cache
  })
  return { service, state, mods, cache }
}

describe('portrait service', () => {
  it('converts the portraits of the installed Tekken 3 Expanded into its own folder', async () => {
    const { service, cache } = setup()
    const found = await service.list()
    expect(found.enabled).toBe(true)
    expect(found.source).toBe('tekken3-expanded')
    expect(Object.keys(found.portraits).sort()).toEqual(['jin', 'kazuya'])
    expect(found.portraits.jin).toMatch(/^expandedhub-media:\/\/portrait\/jin\.png\?v=\d+$/)
    expect(readFileSync(join(cache, 'jin.png')).subarray(1, 4).toString()).toBe('PNG')
    expect(await service.path('jin.png')).toBe(join(cache, 'jin.png'))
  })

  it('also finds the older layout without build-release', async () => {
    const { service } = setup({ layout: 'mods' })
    expect(Object.keys((await service.list()).portraits)).toContain('jin')
  })

  it('makes a PNG again only when the game has a newer file', async () => {
    const { service, cache, mods } = setup()
    await service.list()
    const png = join(cache, 'jin.png')
    const first = statSync(png).mtimeMs
    await service.list()
    expect(statSync(png).mtimeMs).toBe(first)
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(mods, PORTRAIT_FILES.jin!), later, later)
    await service.list()
    expect(statSync(png).mtimeMs).toBeGreaterThan(first)
  })

  it('shows nothing when switched off, and clear removes the images', async () => {
    const { service, state, cache } = setup()
    await service.list()
    state.enabled = false
    const off = await service.list()
    expect(off).toEqual({ enabled: false, source: null, portraits: {} })
    expect(await service.path('jin.png')).toBeNull()
    await service.clear()
    expect(existsSync(cache)).toBe(false)
  })

  it('has nothing without Tekken 3 Expanded, and serves only known fighters', async () => {
    const { service, state } = setup()
    state.installed = false
    expect((await service.list()).portraits).toEqual({})
    expect(await service.path('../settings.json')).toBeNull()
    expect(await service.path('anna.png')).toBeNull()
  })
})
