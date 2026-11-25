/**
 * The Dojo's input notation, and the matcher the Input Trainer checks a player's inputs with.
 *
 * Notation (the usual fighting-game shorthand, written so it can be parsed):
 * - Steps are joined by `,` (one after the other), `~` (immediately) or `:` (on the exact frame).
 * - A step is parts joined by `+`: a direction, buttons and stance prefixes, e.g. `d/f+1`, `WS+4`,
 *   `FC+d/f+3`, `b+1+2`.
 * - Directions: `f b u d u/f u/b d/f d/b n`; in capitals (`F`, `D/F`) held instead of tapped.
 * - Motions: `qcf qcb hcf hcb` (quarter / half circles) and `cd` (crouch dash: f,n,d,d/f).
 * - Buttons: `1` left punch, `2` right punch, `3` left kick, `4` right kick.
 * - Prefixes: `WS` while standing up, `FC` fully crouched, `SS` sidestep, `WR` while running,
 *   `BT` back turned.
 */

export type Dir = 'n' | 'u' | 'd' | 'f' | 'b' | 'u/f' | 'u/b' | 'd/f' | 'd/b'
export type Button = 1 | 2 | 3 | 4
export type Link = ',' | '~' | ':'
export type Prefix = 'WS' | 'FC' | 'SS' | 'WR' | 'BT'
export type Motion = 'qcf' | 'qcb' | 'hcf' | 'hcb' | 'cd'

export interface Step {
  /** How this step follows the one before; null for the first. */
  link: Link | null
  prefixes: Prefix[]
  motion: Motion | null
  dir: Dir | null
  /** Held (capital letters) instead of tapped. */
  hold: boolean
  buttons: Button[]
}

const DIRS: Dir[] = ['n', 'u', 'd', 'f', 'b', 'u/f', 'u/b', 'd/f', 'd/b']
const PREFIXES: Prefix[] = ['WS', 'FC', 'SS', 'WR', 'BT']
const MOTIONS: Motion[] = ['qcf', 'qcb', 'hcf', 'hcb', 'cd']

export class NotationError extends Error {}

export function parseNotation(input: string): Step[] {
  const src = input.trim()
  if (!src) throw new NotationError('empty command')
  const steps: Step[] = []
  let link: Link | null = null
  for (const piece of src.split(/([,~:])/)) {
    if (piece === ',' || piece === '~' || piece === ':') {
      if (link !== null || steps.length === 0) throw new NotationError(`"${input}": a link without a step before it`)
      link = piece
      continue
    }
    const text = piece.trim()
    if (!text) throw new NotationError(`"${input}": an empty step`)
    const step: Step = { link: steps.length === 0 ? null : link, prefixes: [], motion: null, dir: null, hold: false, buttons: [] }
    if (steps.length > 0 && link === null) throw new NotationError(`"${input}": steps need , ~ or : between them`)
    link = null
    for (const raw of text.split('+')) {
      const part = raw.trim()
      if (/^[1-4]$/.test(part)) {
        const b = Number(part) as Button
        if (step.buttons.includes(b)) throw new NotationError(`"${input}": button ${b} twice in one step`)
        step.buttons.push(b)
      } else if ((PREFIXES as string[]).includes(part)) {
        step.prefixes.push(part as Prefix)
      } else if ((MOTIONS as string[]).includes(part)) {
        if (step.motion || step.dir) throw new NotationError(`"${input}": two directions in one step`)
        step.motion = part as Motion
      } else if ((DIRS as string[]).includes(part.toLowerCase())) {
        if (step.motion || step.dir) throw new NotationError(`"${input}": two directions in one step`)
        step.dir = part.toLowerCase() as Dir
        step.hold = part !== part.toLowerCase()
      } else {
        throw new NotationError(`"${input}": "${part}" is not a direction, button or prefix`)
      }
    }
    if (!step.dir && !step.motion && step.buttons.length === 0) throw new NotationError(`"${input}": a step without a direction or button`)
    steps.push(step)
  }
  if (link !== null) throw new NotationError(`"${input}": ends with a link`)
  for (const s of steps) s.buttons.sort((a, b) => a - b)
  return steps
}

/** Parse, or null when the command is not in the notation. */
export function tryParse(input: string): Step[] | null {
  try {
    return parseNotation(input)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Trainer

/** What a target accepts as its direction: one, the down family (d, d/f, d/b), up or down (sidestep), or any. */
export type DirMatch = Dir | 'down' | 'ss' | null

export interface Target {
  dir: DirMatch
  buttons: Button[]
  /** How long after the previous target it may come, in ms. */
  window: number
  /** A button target that needs the direction tapped again (the second f of `f,f+2`). */
  retap: boolean
}

const MOTION_DIRS: Record<Motion, Dir[]> = {
  qcf: ['d', 'd/f', 'f'],
  qcb: ['d', 'd/b', 'b'],
  hcf: ['b', 'd/b', 'd', 'd/f', 'f'],
  hcb: ['f', 'd/f', 'd', 'd/b', 'b'],
  cd: ['f', 'n', 'd', 'd/f']
}

/** How long, in ms, a link lets the next input wait. Lenient: the hub cannot see the game's frames. */
export const LINK_WINDOW: Record<Link, number> = { ',': 650, '~': 320, ':': 220 }
/** Inside a motion (d, d/f, f) each direction may wait this long. */
const MOTION_WINDOW = 320
/** A crouch (WS, FC) may be held this long before the buttons. */
const CROUCH_WINDOW = 2500
/** Buttons pressed within this many ms of each other count as pressed together. */
export const TOGETHER_MS = 90

/**
 * The inputs a command needs, in order, for the Trainer; null when it cannot be practised
 * outside the game (back turned, or a command that does not parse).
 */
export function trainerTargets(input: string): Target[] | null {
  const steps = tryParse(input)
  if (!steps) return null
  const out: Target[] = []
  const push = (dir: DirMatch, buttons: Button[], window: number) => {
    const prev = out[out.length - 1]
    const retap = buttons.length > 0 && dir !== null && prev !== undefined && prev.buttons.length === 0 && prev.dir === dir
    out.push({ dir, buttons, window: out.length === 0 ? Infinity : window, retap })
  }
  for (const s of steps) {
    if (s.prefixes.includes('BT')) return null
    const crouch = s.prefixes.includes('WS') || s.prefixes.includes('FC')
    // The leading directions, each with how long it may wait for the one before.
    const lead: [DirMatch, number][] = []
    let window = LINK_WINDOW[s.link ?? ',']
    const add = (d: DirMatch, next: number) => {
      lead.push([d, window])
      window = next
    }
    if (s.prefixes.includes('WR')) {
      add('f', LINK_WINDOW[','])
      add('f', LINK_WINDOW[','])
    }
    if (s.prefixes.includes('SS')) add('ss', 500)
    if (crouch) add('down', CROUCH_WINDOW)
    if (s.motion) for (const d of MOTION_DIRS[s.motion]) add(d, MOTION_WINDOW)

    let dir: DirMatch = s.dir
    if (dir === null) {
      if (s.prefixes.includes('WS')) dir = 'n'
      else if (s.prefixes.includes('FC')) dir = 'down'
      else if (s.prefixes.includes('WR')) dir = 'f'
    }
    // A motion's last direction is the one its buttons come with.
    if (s.motion && s.buttons.length > 0 && s.dir === null) {
      const last = lead.pop()!
      dir = last[0]
      window = last[1]
    }
    for (const [d, w] of lead) push(d, [], w)
    if (s.buttons.length > 0) push(dir, s.buttons, window)
    else if (s.dir) push(s.dir, [], window)
  }
  return out
}

export function dirMatches(want: DirMatch, have: Dir): boolean {
  if (want === null) return true
  if (want === 'down') return have === 'd' || have === 'd/f' || have === 'd/b'
  if (want === 'ss') return have === 'u' || have === 'd'
  return want === have
}

export type MatchEvent =
  | { type: 'progress'; index: number }
  | { type: 'done' }
  | { type: 'fail'; reason: 'slow' | 'button' | 'direction'; index: number }

/**
 * Follows a player's inputs, frame by frame, against a command's targets.
 * Feed it the direction (already turned so that `f` is towards the opponent) and the buttons held.
 */
export class InputMatcher {
  private index = 0
  private lastAt = 0
  private prevDir: Dir = 'n'
  private prevDown = new Set<Button>()
  private pressAt = new Map<Button, number>()
  private dirAt = new Map<Dir, number>()

  constructor(private readonly targets: Target[]) {}

  get progress(): number {
    return this.index
  }

  reset(): void {
    this.index = 0
  }

  feed(t: number, dir: Dir, down: Button[]): MatchEvent | null {
    const held = new Set(down)
    const pressed = down.filter((b) => !this.prevDown.has(b))
    for (const b of pressed) this.pressAt.set(b, t)
    const dirChanged = dir !== this.prevDir
    if (dirChanged) this.dirAt.set(dir, t)
    this.prevDir = dir
    this.prevDown = held

    if (this.index > 0 && t - this.lastAt > this.targets[this.index]!.window) {
      const index = this.index
      this.index = 0
      return { type: 'fail', reason: 'slow', index }
    }

    let event: MatchEvent | null = null
    // A dir target and the button target after it can both be met in one frame (qcf+1 pressed together).
    for (let guard = 0; guard < 2 && this.index < this.targets.length; guard++) {
      const target = this.targets[this.index]!
      const wrong = pressed.filter((b) => !target.buttons.includes(b))
      if (wrong.length > 0 && this.index > 0) {
        const index = this.index
        this.index = 0
        return { type: 'fail', reason: 'button', index }
      }
      if (!this.met(target, t, dir, dirChanged, held, pressed)) {
        if (this.index > 0 && target.buttons.length > 0 && pressed.some((b) => target.buttons.includes(b)) && !dirMatches(target.dir, dir)) {
          const index = this.index
          this.index = 0
          return { type: 'fail', reason: 'direction', index }
        }
        break
      }
      this.index++
      this.lastAt = t
      if (this.index === this.targets.length) {
        this.index = 0
        return { type: 'done' }
      }
      event = { type: 'progress', index: this.index }
      // A direction's edge is used up by its target; only a button target may follow in the same frame.
      if (target.buttons.length > 0 || this.targets[this.index]!.buttons.length === 0) break
    }
    return event
  }

  private met(target: Target, t: number, dir: Dir, dirChanged: boolean, held: Set<Button>, pressed: Button[]): boolean {
    if (target.buttons.length === 0) return dirChanged && dirMatches(target.dir, dir)
    if (!dirMatches(target.dir, dir)) return false
    if (!target.buttons.every((b) => held.has(b))) return false
    if (!pressed.some((b) => target.buttons.includes(b))) return false
    const times = target.buttons.map((b) => this.pressAt.get(b) ?? -Infinity)
    if (t - Math.min(...times) > TOGETHER_MS) return false
    if (target.retap && (this.dirAt.get(dir) ?? -Infinity) <= this.lastAt) return false
    return true
  }
}
