import type { ZodType, ZodTypeDef } from 'zod'
import { DojoFighter, DojoMovelist, DojoTour, type DojoMove } from '@shared/dojo-schema'

/**
 * The Dojo's bundled content, checked against the schema: fighters and tours (CC BY 4.0, see
 * `content/LICENSE.md`) and full move lists (CC BY-SA 3.0, see `content/movelists/LICENSE.md`).
 * A file that does not fit is left out and logged; `tests/dojo-content.test.ts` keeps them all valid.
 */
function load<T>(files: Record<string, unknown>, schema: ZodType<T, ZodTypeDef, unknown>): T[] {
  const out: T[] = []
  for (const [path, json] of Object.entries(files)) {
    const parsed = schema.safeParse(json)
    if (parsed.success) out.push(parsed.data)
    else void window.hub?.app.log('warn', `Dojo: ${path} skipped`, parsed.error.message)
  }
  return out
}

export const FIGHTERS: DojoFighter[] = load(
  import.meta.glob('./content/fighters/*.json', { eager: true, import: 'default' }),
  DojoFighter
).sort((a, b) => a.order - b.order)

export const TOURS: DojoTour[] = load(import.meta.glob('./content/tours/*.json', { eager: true, import: 'default' }), DojoTour)

export function fighterById(id: string | undefined): DojoFighter | undefined {
  return FIGHTERS.find((f) => f.id === id)
}

export const MOVELISTS: DojoMovelist[] = load(
  import.meta.glob('./content/movelists/*.json', { eager: true, import: 'default' }),
  DojoMovelist
)

/** The moves of a fighter's first move list (the one of the game they come from). */
export function movesOf(f: DojoFighter): DojoMove[] {
  return movesetsOf(f)[0]?.moves ?? []
}

export const ORIGIN_LABEL: Record<DojoFighter['origin'], string> = {
  t3: 'Tekken 3',
  ttt: 'Tag Tournament',
  t5dr: 'Tekken 5 DR'
}

/** Two-digit roster number: `07`. */
export const rosterNumber = (f: DojoFighter) => String(FIGHTERS.indexOf(f) + 1).padStart(2, '0')

export type MovesetId = DojoMovelist['game']

/** A game's short name: the moveset tabs and the badges on a fighter's page. */
export const GAME_LABEL: Record<MovesetId, string> = { t3: 'Tekken 3', ttt: 'Tag Tournament', t5dr: 'Tekken 5 DR' }
export interface Moveset {
  id: MovesetId
  label: string
  /** Shown as the tab's tooltip. */
  hint: string
  moves: DojoMove[]
  /** Where the list comes from, for the credit line under it. */
  source: DojoMovelist['source']
  verified: boolean
}

/**
 * The move lists a fighter can be played with (or those of the fighter they borrow from): the game
 * they come from first, then for Tekken 3's cast the Tag Tournament moveset of Tekken 3 Expanded's
 * MOVESET card.
 */
export function movesetsOf(f: DojoFighter): Moveset[] {
  const owner = f.movesFrom ?? f.id
  const lists = MOVELISTS.filter((l) => l.fighter === owner)
  const own = f.origin === 'ttt' ? 'ttt' : 't3'
  // Their own game's list first, then the MOVESET card's choices in its order.
  const rank = (g: MovesetId) => (g === own ? 0 : g === 'ttt' ? 1 : 2)
  lists.sort((a, b) => rank(a.game) - rank(b.game))
  return lists.map((l) => ({
    id: l.game,
    label: GAME_LABEL[l.game],
    hint:
      l.game === 't3'
        ? 'The moves of Tekken 3 itself'
        : l.game === 't5dr'
          ? 'The third choice on the MOVESET card, with Tekken 3 Expanded’s Tekken 5 DR Content add-on'
          : own === 'ttt'
            ? 'Their Tag Tournament moves, as Tekken 3 Expanded plays them'
            : 'Picked on the MOVESET card in Tekken 3 Expanded',
    moves: l.moves,
    source: l.source,
    verified: l.verified
  }))
}
