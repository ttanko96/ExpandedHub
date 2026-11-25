import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { tryParse, type Button, type Dir, type DirMatch, type Link, type Prefix, type Step, type Target } from '@shared/dojo-notation'
import { cx } from '../lib/format'

/**
 * The Dojo's own drawing of commands: arrows in rings, a 2×2 button pad and an animated stick.
 * Nothing here comes from a game; it is the hub's own way to show the notation.
 */

const ANGLE: Record<Exclude<Dir, 'n'>, number> = { f: 0, 'd/f': 45, d: 90, 'd/b': 135, b: 180, 'u/b': 225, u: 270, 'u/f': 315 }
const OFFSET: Record<Dir, [number, number]> = {
  n: [0, 0],
  f: [1, 0],
  b: [-1, 0],
  u: [0, -1],
  d: [0, 1],
  'u/f': [0.71, -0.71],
  'u/b': [-0.71, -0.71],
  'd/f': [0.71, 0.71],
  'd/b': [-0.71, 0.71]
}

const PREFIX_TITLE: Record<Prefix, string> = {
  WS: 'While standing up from a crouch',
  FC: 'From a full crouch',
  SS: 'During a sidestep',
  WR: 'While running',
  BT: 'With your back to the opponent'
}

const DIR_TITLE: Record<Dir, string> = {
  n: 'Neutral (let go of the stick)',
  f: 'Forward',
  b: 'Back',
  u: 'Up',
  d: 'Down',
  'u/f': 'Up-forward',
  'u/b': 'Up-back',
  'd/f': 'Down-forward',
  'd/b': 'Down-back'
}

type Size = 'sm' | 'md' | 'lg'
const PX: Record<Size, number> = { sm: 22, md: 28, lg: 44 }

export function DirGlyph({ dir, hold, size = 'md', state }: { dir: DirMatch; hold?: boolean; size?: Size; state?: GlyphState }) {
  const px = PX[size]
  const title = dir === null ? 'Any direction' : dir === 'down' ? 'Down (any down)' : dir === 'ss' ? 'Up or down (sidestep)' : `${DIR_TITLE[dir]}${hold ? ', held' : ''}`
  const angle = dir === null || dir === 'n' ? null : dir === 'down' ? 90 : dir === 'ss' ? null : ANGLE[dir]
  return (
    <span
      title={title}
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200',
        hold ? 'border-[var(--dojo-accent)] bg-[var(--dojo-accent)] text-white' : 'border-line/25 text-fg',
        stateClass(state)
      )}
      style={{ width: px, height: px }}
    >
      {angle !== null ? (
        <svg viewBox="0 0 24 24" width={px * 0.62} height={px * 0.62} style={{ transform: `rotate(${angle}deg)` }} aria-hidden>
          <path d="M4 12h13M12 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : dir === 'ss' ? (
        <svg viewBox="0 0 24 24" width={px * 0.62} height={px * 0.62} aria-hidden>
          <path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className="rounded-full bg-current" style={{ width: px * 0.22, height: px * 0.22 }} />
      )}
    </span>
  )
}

const BUTTON_NAME: Record<Button, string> = { 1: 'Left punch', 2: 'Right punch', 3: 'Left kick', 4: 'Right kick' }

export function ButtonGlyph({ buttons, size = 'md', state }: { buttons: Button[]; size?: Size; state?: GlyphState }) {
  const px = PX[size]
  return (
    <span
      title={buttons.map((b) => `${b} ${BUTTON_NAME[b]}`).join(' + ')}
      className={cx('inline-grid shrink-0 grid-cols-2 gap-[2px] rounded-lg bg-ink-700 p-[3px] transition-all duration-200', stateClass(state))}
      style={{ width: px, height: px }}
    >
      {([1, 2, 3, 4] as Button[]).map((b) => (
        <span
          key={b}
          className={cx(
            'flex items-center justify-center rounded-[4px] font-display font-bold leading-none transition-colors',
            buttons.includes(b) ? 'bg-[var(--dojo-accent)] text-white' : 'bg-ink-500/60 text-transparent'
          )}
          style={{ fontSize: px * 0.3 }}
        >
          {b}
        </span>
      ))}
    </span>
  )
}

type GlyphState = 'done' | 'active' | 'idle' | 'fail'
function stateClass(state?: GlyphState) {
  if (state === 'done') return 'opacity-100 ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-ink-900'
  if (state === 'active') return 'scale-110 ring-2 ring-[var(--dojo-accent)] ring-offset-2 ring-offset-ink-900'
  if (state === 'fail') return 'ring-2 ring-tekken-500 ring-offset-2 ring-offset-ink-900'
  if (state === 'idle') return 'opacity-40'
  return ''
}

function LinkGlyph({ link }: { link: Link }) {
  const title = link === ',' ? 'then' : link === '~' ? 'immediately' : 'on the exact frame'
  return (
    <span title={title} className="px-0.5 font-display text-[15px] font-bold text-zinc-500">
      {link === ',' ? '›' : link === '~' ? '~' : '⁝'}
    </span>
  )
}

function PrefixGlyph({ prefix }: { prefix: Prefix }) {
  return (
    <span
      title={PREFIX_TITLE[prefix]}
      className="inline-flex h-6 items-center rounded-md border border-[var(--dojo-accent)]/60 px-1.5 font-display text-[12px] font-bold tracking-[0.08em] text-[var(--dojo-accent)]"
    >
      {prefix}
    </span>
  )
}

const MOTION_LABEL = { qcf: 'Quarter circle forward', qcb: 'Quarter circle back', hcf: 'Half circle forward', hcb: 'Half circle back', cd: 'Crouch dash' }
const MOTION_DIRS: Record<keyof typeof MOTION_LABEL, Dir[]> = {
  qcf: ['d', 'd/f', 'f'],
  qcb: ['d', 'd/b', 'b'],
  hcf: ['b', 'd/b', 'd', 'd/f', 'f'],
  hcb: ['f', 'd/f', 'd', 'd/b', 'b'],
  cd: ['f', 'n', 'd', 'd/f']
}

/** A command drawn as glyphs; falls back to the plain text when it does not parse. */
export function Notation({ input, size = 'md', activeStep, accent }: { input: string; size?: Size; activeStep?: number | null; accent?: string }) {
  const steps = useMemo(() => tryParse(input), [input])
  const style = accent ? ({ '--dojo-accent': accent } as CSSProperties) : undefined
  if (!steps) return <code className="font-mono text-[13px] text-zinc-300">{input}</code>
  return (
    <span className="inline-flex flex-wrap items-center gap-1" style={style} aria-label={input}>
      {steps.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {s.link && <LinkGlyph link={s.link} />}
          <StepGlyphs step={s} size={size} state={activeStep == null ? undefined : i === activeStep ? 'active' : i < activeStep ? undefined : 'idle'} />
        </span>
      ))}
    </span>
  )
}

function StepGlyphs({ step, size, state }: { step: Step; size: Size; state?: GlyphState }) {
  return (
    <span className="inline-flex items-center gap-1">
      {step.prefixes.map((p) => (
        <PrefixGlyph key={p} prefix={p} />
      ))}
      {step.motion && (
        <span title={MOTION_LABEL[step.motion]} className="inline-flex items-center gap-[2px] rounded-full bg-ink-700/70 px-1 py-[2px]">
          {MOTION_DIRS[step.motion].map((d, i) => (
            <DirGlyph key={i} dir={d} size="sm" state={state} />
          ))}
        </span>
      )}
      {step.dir && <DirGlyph dir={step.dir} hold={step.hold} size={size} state={state} />}
      {step.buttons.length > 0 && <ButtonGlyph buttons={step.buttons} size={size} state={state} />}
    </span>
  )
}

/** The Trainer's view of a command: one glyph group per input it waits for. */
export function TargetGlyphs({ targets, progress, failed }: { targets: Target[]; progress: number; failed: number | null }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-2.5">
      {targets.map((t, i) => {
        const state: GlyphState = failed === i ? 'fail' : i < progress ? 'done' : i === progress ? 'active' : 'idle'
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-zinc-600">›</span>}
            {(t.dir !== null || t.buttons.length === 0) && <DirGlyph dir={t.dir} size="lg" state={state} />}
            {t.buttons.length > 0 && <ButtonGlyph buttons={t.buttons} size="lg" state={state} />}
          </span>
        )
      })}
    </span>
  )
}

// ---------------------------------------------------------------------------
// The animated stick and buttons

interface Frame {
  dir: Dir
  buttons: Button[]
  ms: number
  step: number
}

/** How a command looks played out on a stick, frame by frame (for the demo loop). */
export function demoTimeline(steps: Step[]): Frame[] {
  const out: Frame[] = []
  const add = (dir: Dir, buttons: Button[], ms: number, step: number) => out.push({ dir, buttons, ms, step })
  steps.forEach((s, i) => {
    if (i > 0) add(s.link === ',' ? 'n' : out[out.length - 1]!.dir, [], s.link === ',' ? 110 : 40, i)
    if (s.prefixes.includes('WR')) {
      add('f', [], 110, i)
      add('n', [], 60, i)
      add('f', [], 110, i)
      add('n', [], 60, i)
    }
    if (s.prefixes.includes('SS')) {
      add('u', [], 130, i)
      add('n', [], 90, i)
    }
    if (s.prefixes.includes('WS')) {
      add('d', [], 420, i)
      add('n', [], 40, i)
    }
    if (s.prefixes.includes('FC')) add('d', [], 300, i)
    if (s.motion) for (const d of MOTION_DIRS[s.motion]) add(d, [], 75, i)
    const dir: Dir = s.dir ?? (s.prefixes.includes('FC') ? 'd' : s.motion ? MOTION_DIRS[s.motion].at(-1)! : 'n')
    if (s.buttons.length > 0) add(dir, s.buttons, 190, i)
    else if (s.dir) add(s.dir, [], s.hold ? 300 : 150, i)
  })
  add('n', [], 900, steps.length)
  return out
}

/**
 * A stick and four buttons. With `input` it plays the command in a loop; with `live` it shows
 * what the player holds right now.
 */
export function InputPad({
  input,
  live,
  accent,
  size = 220,
  onStep
}: {
  input?: string
  live?: { dir: Dir; buttons: Button[] }
  accent: string
  size?: number
  onStep?: (step: number | null) => void
}) {
  const frames = useMemo(() => {
    const steps = input ? tryParse(input) : null
    return steps ? demoTimeline(steps) : null
  }, [input])
  const [frame, setFrame] = useState(0)
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  useEffect(() => {
    setFrame(0)
    if (!frames || reduced) return
    let i = 0
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      i = (i + 1) % frames.length
      setFrame(i)
      timer = setTimeout(tick, frames[i]!.ms)
    }
    timer = setTimeout(tick, frames[0]!.ms)
    return () => clearTimeout(timer)
  }, [frames, reduced])

  const current = live ?? (frames && !reduced ? frames[frame] : null) ?? { dir: 'n' as Dir, buttons: [] as Button[] }
  const step = frames && !live && !reduced ? (frames[frame]?.step ?? null) : null
  // The last frame's step is one past the command: the pause before the loop starts again.
  useEffect(() => onStep?.(step), [step, onStep])

  const [ox, oy] = OFFSET[current.dir]
  const cx0 = 62
  const cy0 = 60
  const bx = cx0 + ox * 26
  const by = cy0 + oy * 26
  const btn: Record<Button, [number, number]> = { 1: [158, 42], 2: [200, 42], 3: [158, 82], 4: [200, 82] }

  return (
    <svg viewBox="0 0 240 120" width={size} height={(size * 120) / 240} role="img" aria-label={input ? `Input demo: ${input}` : 'Your input'}>
      <defs>
        <radialGradient id={`ball-${accent.slice(1)}`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="45%" stopColor={accent} />
          <stop offset="100%" stopColor={accent} stopOpacity="0.85" />
        </radialGradient>
      </defs>
      {/* gate */}
      <circle cx={cx0} cy={cy0} r={44} className="fill-ink-850 stroke-line/10" strokeWidth={2} />
      {(Object.keys(ANGLE) as Exclude<Dir, 'n'>[]).map((d) => {
        const [dx, dy] = OFFSET[d]
        const on = current.dir === d
        return <circle key={d} cx={cx0 + dx * 36} cy={cy0 + dy * 36} r={on ? 4 : 2.5} fill={on ? accent : 'currentColor'} className={on ? '' : 'text-zinc-600'} />
      })}
      <line x1={cx0} y1={cy0} x2={bx} y2={by} stroke="currentColor" strokeWidth={7} strokeLinecap="round" className="text-ink-500 transition-all duration-75" />
      <circle
        cx={bx}
        cy={by}
        r={17}
        fill={`url(#ball-${accent.slice(1)})`}
        style={{ transition: 'cx 70ms ease-out, cy 70ms ease-out', filter: current.dir !== 'n' ? `drop-shadow(0 0 8px ${accent})` : undefined }}
      />
      {/* buttons */}
      {([1, 2, 3, 4] as Button[]).map((b) => {
        const on = current.buttons.includes(b)
        const [x, y] = btn[b]
        return (
          <g key={b}>
            <circle
              cx={x}
              cy={y}
              r={on ? 17 : 16}
              fill={on ? accent : 'currentColor'}
              className={on ? '' : 'text-ink-700'}
              style={{ transition: 'r 60ms', filter: on ? `drop-shadow(0 0 10px ${accent})` : undefined }}
            />
            <text x={x} y={y + 5} textAnchor="middle" className={cx('font-display text-[15px] font-bold', on ? 'fill-white' : 'fill-zinc-500')}>
              {b}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
