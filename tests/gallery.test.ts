import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GalleryService } from '../src/main/services/install/gallery-service'
import { tempDir } from './helpers'

function setup(screenshots: { folder: string } | null = { folder: 'screenshots' }) {
  const dir = tempDir()
  mkdirSync(join(dir, 'screenshots', 'sub'), { recursive: true })
  for (const f of ['shot_10.png', 'shot_2.jpg', 'notes.txt', '.hidden.png']) writeFileSync(join(dir, 'screenshots', f), 'x')
  writeFileSync(join(dir, 'secret.png'), 'x')
  const registry = { get: async () => ({ projects: [{ id: 'tmst', install: { screenshots: screenshots ?? undefined } }] }) }
  const installed = { all: async () => ({ tmst: { installPath: dir } }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { gallery: new GalleryService(registry as any, installed as any), dir }
}

describe('project screenshots', () => {
  it('lists the images of the folder in natural order, as media URLs', async () => {
    const { gallery } = setup()
    const shots = await gallery.list('tmst')
    expect(shots.map((s) => s.name)).toEqual(['shot_2.jpg', 'shot_10.png'])
    expect(shots[0]!.url).toMatch(/^expandedhub-media:\/\/screenshot\/tmst\/shot_2\.jpg\?v=\d+$/)
  })

  it('serves only image files directly inside the folder', async () => {
    const { gallery, dir } = setup()
    expect(await gallery.path('tmst', 'shot_2.jpg')).toBe(join(dir, 'screenshots', 'shot_2.jpg'))
    expect(await gallery.path('tmst', '../secret.png')).toBeNull()
    expect(await gallery.path('tmst', 'notes.txt')).toBeNull()
    expect(await gallery.path('tmst', 'missing.png')).toBeNull()
    expect(await gallery.path('other', 'shot_2.jpg')).toBeNull()
  })

  it('has nothing for projects without a screenshots folder', async () => {
    expect(await setup(null).gallery.list('tmst')).toEqual([])
  })
})
