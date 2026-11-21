import { describe, expect, it } from 'vitest'
import type { SourceConfig } from '../src/shared/install'
import { GameDefinition, SourceRequirement } from '../src/shared/registry-schema'
import { sourceFit } from '../src/shared/source-fit'

const game = GameDefinition.parse({
  id: 'tekken3-arcade',
  name: 'Tekken 3 Arcade',
  platform: 'Arcade',
  extensions: ['zip'],
  knownHashes: [
    { algorithm: 'sha1', value: 'aa', label: 'tet2vere1.2e', revision: 'World TET2/VER.E1' },
    { algorithm: 'sha1', value: 'bb', label: 'tet1vere.2e', revision: 'Japan TET1/VER.E' }
  ]
})
const file = (verdict: 'verified' | 'mismatch' | 'invalid', matched?: string): SourceConfig => ({
  gameId: game.id,
  path: 'x.zip',
  size: 1,
  validation: { verdict, message: '', matched, checkedAt: '' }
})
const anyRev = SourceRequirement.parse({ gameId: game.id, required: false })
const japanOnly = SourceRequirement.parse({ gameId: game.id, required: false, revisions: ['Japan TET1/VER.E'] })

describe('sourceFit', () => {
  it('has nothing to say without a usable file', () => {
    expect(sourceFit(game, anyRev, undefined)).toBeNull()
    expect(sourceFit(game, anyRev, file('invalid'))).toBeNull()
  })
  it('accepts any verified dump when the project names no revision', () => {
    expect(sourceFit(game, anyRev, file('verified', 'tet2vere1.2e'))).toEqual({ kind: 'ok' })
    expect(sourceFit(game, anyRev, file('mismatch'))).toEqual({ kind: 'doubtful' })
  })
  it('tells a verified dump of another revision apart', () => {
    expect(sourceFit(game, japanOnly, file('verified', 'tet1vere.2e'))).toEqual({ kind: 'ok' })
    expect(sourceFit(game, japanOnly, file('verified', 'tet2vere1.2e'))).toEqual({
      kind: 'wrong-revision',
      have: 'World TET2/VER.E1',
      need: ['Japan TET1/VER.E']
    })
    expect(sourceFit(game, japanOnly, file('mismatch'))).toEqual({ kind: 'doubtful' })
  })
})

describe('registry revisions', () => {
  it('every revision a project requires is a known revision of that game', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { GamesCatalog, ProjectDefinition } = await import('../src/shared/registry-schema')
    const dir = join(__dirname, '..', 'registry')
    const games = GamesCatalog.parse(JSON.parse(readFileSync(join(dir, 'games.json'), 'utf8'))).games
    const known = new Map(games.map((g) => [g.id, new Set(g.knownHashes.map((h) => h.revision).filter(Boolean))]))
    for (const f of readdirSync(join(dir, 'projects')).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
      const p = ProjectDefinition.parse(JSON.parse(readFileSync(join(dir, 'projects', f), 'utf8')))
      for (const s of p.install?.sources ?? []) for (const r of s.revisions ?? []) expect(known.get(s.gameId)?.has(r), `${f}: ${s.gameId} "${r}"`).toBe(true)
    }
  })
})
