import { z } from 'zod'

/**
 * The Dojo's content: fighters with their move lists, and the tours of the projects.
 *
 * Everything here is written for ExpandedHub (CC BY 4.0, see the content folder's
 * LICENSE.md): names and commands are facts about the games, every description is our
 * own words. Nothing is taken from the games' files, manuals or official guides.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #d81e34')

export const MOVE_KINDS = ['string', 'poke', 'launcher', 'low', 'power', 'throw', 'special', 'stance'] as const
export type MoveKind = (typeof MOVE_KINDS)[number]

/** Where a hit lands: high, mid, low, special mid, or a throw / unblockable. */
const HIT = /^(h|m|l|s|t|!)(,(h|m|l|s|t|!))*$/

export const DojoMove = z
  .object({
    name: z.string().min(1),
    /** The command in the hub's notation (see `dojo-notation.ts`): `d/f+1`, `f,n,d,d/f+2`, `WS+4`, `1+2`. */
    input: z.string().min(1).optional(),
    /** A command the notation cannot hold (it depends on the opponent's move, a stance's timing...), as text. */
    text: z.string().min(1).optional(),
    /** The situation it is done in: `During Tackle`, `Opponent on the ground`, `From the back`. */
    when: z.string().min(1).optional(),
    kind: z.enum(MOVE_KINDS),
    /** Hit levels in order, e.g. `h,m`. */
    hits: z.string().regex(HIT, 'hit levels like h,m,l').optional(),
    note: z.string().optional()
  })
  .refine((m) => (m.input === undefined) !== (m.text === undefined), 'a move has either an input or a text')
export type DojoMove = z.infer<typeof DojoMove>

export const ORIGINS = ['t3', 'ttt', 't5dr'] as const
export type FighterOrigin = (typeof ORIGINS)[number]

export const DojoFighter = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** Which game's cast they come from in the hub's projects. */
  origin: z.enum(ORIGINS).default('t3'),
  style: z.string().min(1),
  country: z.string().min(1),
  /** One line in our own words. */
  tagline: z.string().min(1),
  accent: hex,
  /** Order on the roster. */
  order: z.number().int(),
  /** A fighter who fights with someone else's moves (Panda with Kuma's): their lists are shown. */
  movesFrom: z.string().optional(),
  /** The move shown big on their page, by name, from their first move list. */
  signature: z.string().optional(),
  /**
   * A fighter with no moves of their own who copies others (Mokujin, Tetsujin, Unknown): whose
   * moves, from which of their move lists, and how, in our own words.
   */
  mimics: z
    .object({
      fighters: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
      moveset: z.enum(['t3', 'ttt']),
      how: z.string().min(1)
    })
    .optional()
})
export type DojoFighter = z.infer<typeof DojoFighter>

/**
 * A fighter's full move list in one game, in `content/movelists/` (CC BY-SA 3.0, from the Tekken wiki;
 * see that folder's LICENSE.md). `t3`: Tekken 3's own moves; `ttt`: Tag Tournament's, which
 * Tekken 3 Expanded plays (for Tekken 3's cast, on the MOVESET card); `t5dr`: Tekken 5 DR's, from
 * Tekken 3 Expanded's Tekken 5 DR Content add-on (Jin's third MOVESET choice).
 */
export const DojoMovelist = z.object({
  schemaVersion: z.literal(1),
  fighter: z.string().regex(/^[a-z0-9-]+$/),
  game: z.enum(['t3', 'ttt', 't5dr']),
  source: z.object({ title: z.string().min(1), site: z.string().min(1), license: z.string().min(1) }),
  /** True once someone checked every command in the game. */
  verified: z.boolean().default(false),
  moves: z.array(DojoMove).min(1)
})
export type DojoMovelist = z.infer<typeof DojoMovelist>


/** Icons a tour chapter can use (a fixed set, so content cannot ask for anything else). */
export const TOUR_ICONS = [
  'disc',
  'download',
  'play',
  'music',
  'camera',
  'trophy',
  'swords',
  'users',
  'map',
  'sparkles',
  'gamepad',
  'cpu',
  'film',
  'wrench',
  'layers',
  'monitor'
] as const

export const DojoTourChapter = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  icon: z.enum(TOUR_ICONS).default('sparkles'),
  /** Controls or menu paths, shown as key caps: `["✕ take a photo", "△ hide the HUD"]`. */
  keys: z.array(z.string().min(1)).default([]),
  /** A file in the project's own screenshot folder (shown once installed). */
  screenshot: z.string().optional()
})

export const DojoTour = z.object({
  schemaVersion: z.literal(1),
  /** The registry project this tour is about. */
  projectId: z.string().min(1),
  title: z.string().min(1),
  intro: z.string().min(1),
  chapters: z.array(DojoTourChapter).min(1)
})
export type DojoTour = z.infer<typeof DojoTour>
