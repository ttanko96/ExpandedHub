import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DojoFighter, DojoTour } from '@shared/dojo-schema'
import { parseNotation } from '@shared/dojo-notation'

const root = join(__dirname, '..', 'src', 'renderer', 'src', 'dojo', 'content')
const read = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, json: JSON.parse(readFileSync(join(root, dir, f), 'utf8')) as unknown }))

describe('dojo fighters', () => {
  const files = read('fighters')
  const fighters = files.map(({ file, json }) => {
    const parsed = DojoFighter.safeParse(json)
    if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
    expect(`${parsed.data.id}.json`).toBe(file)
    return parsed.data
  })
  const ids = new Set(fighters.map((f) => f.id))

  it('has the whole Tekken 3 cast, once each', () => {
    expect(fighters.length).toBe(23)
    expect(ids.size).toBe(23)
    expect(new Set(fighters.map((f) => f.order)).size).toBe(23)
  })

  it('writes every command in the notation', () => {
    for (const f of fighters) for (const m of f.moves) expect(() => parseNotation(m.input), `${f.id}: ${m.name}`).not.toThrow()
  })

  it('points borrowed move lists and signatures at real entries', () => {
    for (const f of fighters) {
      if (f.movesFrom) {
        expect(ids.has(f.movesFrom), f.id).toBe(true)
        expect(f.moves, `${f.id} borrows its moves`).toEqual([])
      }
      const list = f.movesFrom ? fighters.find((x) => x.id === f.movesFrom)!.moves : f.moves
      if (f.signature) expect(list.some((m) => m.name === f.signature), `${f.id}: ${f.signature}`).toBe(true)
    }
  })
})

describe('dojo tours', () => {
  const projects = new Set(
    readdirSync(join(__dirname, '..', 'registry', 'projects'))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => (JSON.parse(readFileSync(join(__dirname, '..', 'registry', 'projects', f), 'utf8')) as { id: string }).id)
  )

  it('are valid and about projects in the registry', () => {
    for (const { file, json } of read('tours')) {
      const parsed = DojoTour.safeParse(json)
      if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
      expect(projects.has(parsed.data.projectId), file).toBe(true)
      expect(file).toBe(`${parsed.data.projectId}.json`)
    }
  })
})
