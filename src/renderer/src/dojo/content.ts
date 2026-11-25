import type { ZodType, ZodTypeDef } from 'zod'
import { DojoFighter, DojoTour, type DojoMove } from '@shared/dojo-schema'

/**
 * The Dojo's bundled content (CC BY 4.0, see `content/LICENSE.md`), checked against the schema.
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

/** The moves a fighter fights with: their own, or those of the fighter they borrow from. */
export function movesOf(f: DojoFighter): DojoMove[] {
  if (!f.movesFrom) return f.moves
  return fighterById(f.movesFrom)?.moves ?? []
}

export const ORIGIN_LABEL: Record<DojoFighter['origin'], string> = {
  t3: 'Tekken 3',
  ttt: 'Tag Tournament',
  t5dr: 'Tekken 5 DR'
}

/** Two-digit roster number: `07`. */
export const rosterNumber = (f: DojoFighter) => String(FIGHTERS.indexOf(f) + 1).padStart(2, '0')
