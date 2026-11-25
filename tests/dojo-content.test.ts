import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DojoFighter, DojoMovelist, DojoTour } from '@shared/dojo-schema'
import { parseNotation } from '@shared/dojo-notation'

const root = join(__dirname, '..', 'src', 'renderer', 'src', 'dojo', 'content')
const read = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, json: JSON.parse(readFileSync(join(root, dir, f), 'utf8')) as unknown }))

const fighters = read('fighters').map(({ file, json }) => {
  const parsed = DojoFighter.safeParse(json)
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
  expect(`${parsed.data.id}.json`).toBe(file)
  return parsed.data
})
const ids = new Set(fighters.map((f) => f.id))

const lists = read('movelists').map(({ file, json }) => {
  const parsed = DojoMovelist.safeParse(json)
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
  expect(`${parsed.data.fighter}.${parsed.data.game}.json`).toBe(file)
  return parsed.data
})
const listsOf = (id: string) => lists.filter((l) => l.fighter === id)

describe('dojo fighters', () => {
  it('has the whole Tekken 3 cast and the 18 Tag Tournament fighters, once each', () => {
    expect(fighters.filter((f) => f.origin === 't3').length).toBe(23)
    expect(fighters.filter((f) => f.origin === 'ttt').length).toBe(18)
    expect(ids.size).toBe(fighters.length)
    expect(new Set(fighters.map((f) => f.order)).size).toBe(fighters.length)
  })

  it('gives every fighter a move list, their own, a borrowed one, or the styles they copy', () => {
    for (const f of fighters) {
      if (f.mimics) {
        expect(listsOf(f.id), `${f.id} copies others`).toEqual([])
        for (const id of f.mimics.fighters) {
          expect(ids.has(id), `${f.id} copies ${id}`).toBe(true)
          expect(listsOf(id).some((l) => l.game === f.mimics!.moveset), `${f.id}: ${id} has a ${f.mimics.moveset} list`).toBe(true)
        }
        continue
      }
      if (f.movesFrom) {
        expect(ids.has(f.movesFrom), f.id).toBe(true)
        expect(listsOf(f.id), `${f.id} borrows its lists`).toEqual([])
      }
      const own = f.origin === 'ttt' ? 'ttt' : 't3'
      expect(listsOf(f.movesFrom ?? f.id).some((l) => l.game === own), f.id).toBe(true)
    }
  })

  it('points signatures at a drawable move of their first list', () => {
    for (const f of fighters.filter((x) => x.signature)) {
      const own = f.origin === 'ttt' ? 'ttt' : 't3'
      const list = listsOf(f.movesFrom ?? f.id).find((l) => l.game === own)!
      expect(list.moves.some((m) => m.name === f.signature && m.input), `${f.id}: ${f.signature}`).toBe(true)
    }
  })
})

describe('the copying fighters', () => {
  it('copy as many styles as in the games', () => {
    const count = (id: string) => fighters.find((f) => f.id === id)!.mimics!.fighters.length
    expect(count('unknown')).toBe(23)
    expect(count('tetsujin')).toBe(12)
    expect(count('mokujin')).toBe(15)
  })
})

describe('dojo move lists', () => {
  it('belong to fighters and name their source and licence', () => {
    for (const l of lists) {
      expect(ids.has(l.fighter), l.fighter).toBe(true)
      expect(l.source.license).toBe('CC BY-SA 3.0')
    }
  })

  it('write every drawable command in the notation', () => {
    let drawable = 0
    for (const l of lists) {
      for (const m of l.moves) {
        if (!m.input) continue
        drawable++
        expect(() => parseNotation(m.input!), `${l.fighter}.${l.game}: ${m.name}`).not.toThrow()
      }
    }
    expect(drawable).toBeGreaterThan(3000)
  })

  it("give Jin his Tekken 5 DR moveset, Tekken 3 Expanded's third MOVESET choice", () => {
    expect(lists.filter((l) => l.game === 't5dr').map((l) => l.fighter)).toEqual(['jin'])
  })

  it('give the TTT moveset to the 18 fighters with a MOVESET card in Tekken 3 Expanded', () => {
    const withCard = ['paul', 'law', 'lei', 'king', 'yoshimitsu', 'nina', 'hwoarang', 'xiaoyu', 'eddy', 'jin', 'julia', 'bryan', 'heihachi', 'anna', 'kuma', 'ogre', 'gun-jack', 'true-ogre']
    const t3WithTtt = fighters.filter((f) => f.origin === 't3' && listsOf(f.id).some((l) => l.game === 'ttt')).map((f) => f.id)
    expect(t3WithTtt.sort()).toEqual([...withCard].sort())
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
