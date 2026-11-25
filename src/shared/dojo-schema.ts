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

export const DojoMove = z.object({
  name: z.string().min(1),
  /** The command in the hub's notation (see `notation.ts`): `d/f+1`, `f,n,d,d/f+2`, `WS+4`, `1+2`. */
  input: z.string().min(1),
  kind: z.enum(MOVE_KINDS),
  /** Hit levels in order, e.g. `h,m`. */
  hits: z.string().regex(HIT, 'hit levels like h,m,l').optional(),
  note: z.string().optional()
})
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
  /** How they are unlocked in Tekken 3 (PlayStation), when they are not there from the start. */
  unlock: z.string().optional(),
  accent: hex,
  /** Order on the roster. */
  order: z.number().int(),
  /** A fighter who fights with someone else's moves (Panda with Kuma's): their list is shown. */
  movesFrom: z.string().optional(),
  /** The move shown big on their page. */
  signature: z.string().optional(),
  /** True once someone checked every command in the game. */
  verified: z.boolean().default(false),
  moves: z.array(DojoMove).default([])
})
export type DojoFighter = z.infer<typeof DojoFighter>

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
