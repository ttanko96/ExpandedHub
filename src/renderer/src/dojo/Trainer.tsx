import { ArrowLeftRight, Flame, Gamepad2, Keyboard, RotateCcw, Target as TargetIcon, Trophy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { InputMatcher, trainerTargets, type Button, type Dir, type MatchEvent } from '@shared/dojo-notation'
import { cx } from '../lib/format'
import { FIGHTERS, fighterById, movesetsOf } from './content'
import { ButtonGlyph, DirGlyph, InputPad, Notation, TargetGlyphs } from './InputGlyphs'

interface Drill {
  key: string
  name: string
  input: string
  hint: string
}

/** The basics: one of each kind of input the notation has. */
const BASICS: Drill[] = [
  { key: 'b:df1', name: 'Down-forward jab', input: 'd/f+1', hint: 'Hold d/f, then press 1.' },
  { key: 'b:12', name: 'One-two', input: '1,2', hint: 'Two presses in rhythm, not too slow.' },
  { key: 'b:1p2', name: 'Two at once', input: '1+2', hint: 'Both buttons on the same moment.' },
  { key: 'b:ff2', name: 'Dash punch', input: 'f,f+2', hint: 'Tap forward twice; 2 with the second tap.' },
  { key: 'b:qcf', name: 'Quarter circle', input: 'qcf+1', hint: 'Roll d, d/f, f and press 1 at the end.' },
  { key: 'b:ws4', name: 'While standing', input: 'WS+4', hint: 'Crouch, let go of the stick, kick as you rise.' },
  { key: 'b:cd', name: 'Crouch dash', input: 'cd', hint: 'f, let go, d, d/f: quick and smooth.' },
  { key: 'b:wgf', name: 'God Fist motion', input: 'f,n,d,d/f+2', hint: 'The crouch dash, with 2 on the d/f.' },
  { key: 'b:hcf', name: 'Half circle', input: 'hcf+1', hint: 'b, d/b, d, d/f, f, then 1.' }
]

const ACCENT = '#d81e34'

// --- Input ---------------------------------------------------------------

const KEY_DIR: Record<string, 'u' | 'd' | 'l' | 'r'> = {
  KeyW: 'u',
  ArrowUp: 'u',
  KeyS: 'd',
  ArrowDown: 'd',
  KeyA: 'l',
  ArrowLeft: 'l',
  KeyD: 'r',
  ArrowRight: 'r'
}
const KEY_BUTTON: Record<string, Button> = { KeyU: 1, KeyI: 2, KeyJ: 3, KeyK: 4 }
/** Standard gamepad: □/X → 1, △/Y → 2, ✕/A → 3, ○/B → 4 (the PlayStation layout of the four limbs). */
const PAD_BUTTON: [number, Button][] = [
  [2, 1],
  [3, 2],
  [0, 3],
  [1, 4]
]

function toDir(x: number, y: number): Dir {
  const v = y < 0 ? 'u' : y > 0 ? 'd' : ''
  const h = x > 0 ? 'f' : x < 0 ? 'b' : ''
  if (v && h) return `${v}/${h}` as Dir
  return (v || h || 'n') as Dir
}

/**
 * The keys held now. `onChange` runs on every press and release, so a quick tap counts even
 * when the window draws few frames.
 */
function useKeyboard(onChange: { current: (() => void) | null }) {
  const held = useRef(new Set<string>())
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
    }
    const down = (e: KeyboardEvent) => {
      if (typing(e) || !(e.code in KEY_DIR || e.code in KEY_BUTTON)) return
      e.preventDefault()
      if (held.current.has(e.code)) return
      held.current.add(e.code)
      onChange.current?.()
    }
    const up = (e: KeyboardEvent) => {
      if (held.current.delete(e.code)) onChange.current?.()
    }
    const blur = () => {
      held.current.clear()
      onChange.current?.()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [onChange])
  return held
}

interface Live {
  dir: Dir
  buttons: Button[]
  pad: string | null
}

// --- Page ----------------------------------------------------------------

type Flash = { kind: 'clean' | 'slow' | 'button' | 'direction'; at: number } | null

const BEST_KEY = 'expandedhub.dojo.best'
function readBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function Trainer() {
  const [params, setParams] = useSearchParams()
  const fighter = fighterById(params.get('fighter') ?? undefined)
  const sets = useMemo(() => (fighter ? movesetsOf(fighter) : []), [fighter])
  const set = sets.find((x) => x.id === params.get('set')) ?? sets[0]
  const fighterDrills = useMemo<Drill[]>(
    () =>
      fighter && set
        ? set.moves
            .filter((m): m is typeof m & { input: string } => !!m.input && !m.when && trainerTargets(m.input) !== null)
            .map((m, i) => ({ key: `${fighter.id}:${set.id}:${i}:${m.name}`, name: m.name, input: m.input, hint: m.note ?? '' }))
        : [],
    [fighter, set]
  )
  const drills = fighter ? fighterDrills : BASICS
  const wanted = params.get('move')
  const drill = drills.find((d) => d.name === wanted) ?? drills[0] ?? BASICS[0]!
  const accent = fighter?.accent ?? ACCENT
  const targets = useMemo(() => trainerTargets(drill.input) ?? [], [drill.input])

  const [facingRight, setFacingRight] = useState(true)
  const [live, setLive] = useState<Live>({ dir: 'n', buttons: [], pad: null })
  const [progress, setProgress] = useState(0)
  const [failedAt, setFailedAt] = useState<number | null>(null)
  const [flash, setFlash] = useState<Flash>(null)
  const [stats, setStats] = useState({ tries: 0, clean: 0, streak: 0 })
  const [best, setBest] = useState<Record<string, number>>(readBest)
  const [log, setLog] = useState<{ id: number; dir: Dir; buttons: Button[] }[]>([])
  const keyChanged = useRef<(() => void) | null>(null)
  const keys = useKeyboard(keyChanged)
  const streakRef = useRef(0)

  // New drill: fresh counters.
  useEffect(() => {
    streakRef.current = 0
    setStats({ tries: 0, clean: 0, streak: 0 })
    setProgress(0)
    setFailedAt(null)
    setFlash(null)
    setLog([])
  }, [drill.key])

  const facing = useRef(facingRight)
  facing.current = facingRight

  useEffect(() => {
    const matcher = new InputMatcher(targets)
    let raf = 0
    let last = { dir: 'n' as Dir, buttons: '', pad: null as string | null }
    let logId = 0

    const onEvent = (e: MatchEvent) => {
      if (e.type === 'progress') {
        setProgress(e.index)
        setFailedAt(null)
        return
      }
      if (e.type === 'done') {
        setProgress(0)
        setFailedAt(null)
        setFlash({ kind: 'clean', at: performance.now() })
        const streak = ++streakRef.current
        setStats((s) => ({ tries: s.tries + 1, clean: s.clean + 1, streak }))
        setBest((b) => {
          if ((b[drill.key] ?? 0) >= streak) return b
          const nb = { ...b, [drill.key]: streak }
          try {
            localStorage.setItem(BEST_KEY, JSON.stringify(nb))
          } catch {
            /* the record is just not kept */
          }
          return nb
        })
        return
      }
      setProgress(0)
      setFailedAt(e.index)
      setFlash({ kind: e.reason, at: performance.now() })
      streakRef.current = 0
      setStats((s) => ({ ...s, tries: s.tries + 1, streak: 0 }))
    }

    const sample = () => {
      let x = 0
      let y = 0
      const buttons = new Set<Button>()
      let pad: string | null = null
      const gp = navigator.getGamepads?.().find((g) => g && g.connected) ?? null
      if (gp) {
        pad = gp.id.replace(/\s*\(.*\)\s*$/, '') || 'Controller'
        const b = (i: number) => gp.buttons[i]?.pressed ?? false
        if (b(12) || (gp.axes[1] ?? 0) < -0.5) y = -1
        if (b(13) || (gp.axes[1] ?? 0) > 0.5) y = 1
        if (b(14) || (gp.axes[0] ?? 0) < -0.5) x = -1
        if (b(15) || (gp.axes[0] ?? 0) > 0.5) x = 1
        for (const [i, btn] of PAD_BUTTON) if (b(i)) buttons.add(btn)
      }
      for (const code of keys.current) {
        const d = KEY_DIR[code]
        if (d === 'u') y = -1
        else if (d === 'd') y = 1
        else if (d === 'l') x = -1
        else if (d === 'r') x = 1
        const btn = KEY_BUTTON[code]
        if (btn) buttons.add(btn)
      }
      const dir = toDir(facing.current ? x : -x, y)
      const list = [...buttons].sort((a, b) => a - b)
      const e = matcher.feed(performance.now(), dir, list)
      if (e) onEvent(e)

      const sig = list.join('+')
      if (dir !== last.dir || sig !== last.buttons || pad !== last.pad) {
        const pressedNew = list.some((b) => !last.buttons.split('+').includes(String(b)))
        if ((dir !== last.dir && dir !== 'n') || pressedNew) {
          const entry = { id: ++logId, dir, buttons: list }
          setLog((l) => [...l.slice(-13), entry])
        }
        last = { dir, buttons: sig, pad }
        setLive({ dir, buttons: list, pad })
      }
    }
    // Every frame for the controller (and to notice a command that took too long), and at once on a key.
    const frame = () => {
      sample()
      raf = requestAnimationFrame(frame)
    }
    keyChanged.current = sample
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      keyChanged.current = null
    }
  }, [targets, drill.key, keys])

  const pick = (d: Drill) => {
    const next = new URLSearchParams(params)
    next.set('move', d.name)
    setParams(next, { replace: true })
  }
  const pickSet = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('set', id)
    next.delete('move')
    setParams(next, { replace: true })
  }
  const pickFighter = (id: string) => {
    const next = new URLSearchParams()
    if (id) next.set('fighter', id)
    setParams(next, { replace: true })
  }

  const accuracy = stats.tries > 0 ? Math.round((stats.clean / stats.tries) * 100) : null

  return (
    <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-6" style={{ '--dojo-accent': accent } as CSSProperties}>
      {/* Drill list */}
      <aside className="flex max-h-[680px] flex-col rounded-2xl border border-line/[0.06] bg-ink-850 p-3">
        <label className="block px-1 pb-2">
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-zinc-500">Drills</span>
          <select
            value={fighter?.id ?? ''}
            onChange={(e) => pickFighter(e.target.value)}
            className="mt-1.5 h-9 w-full rounded-lg border border-ink-600 bg-ink-800 px-2 text-[14px] text-zinc-200 outline-none focus:border-[var(--dojo-accent)]"
          >
            <option value="">The basics</option>
            {FIGHTERS.filter((f) => movesetsOf(f).some((x) => x.moves.some((m) => m.input && !m.when && trainerTargets(m.input)))).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {sets.length > 1 && (
          <div className="flex gap-1 px-1 pb-2" role="radiogroup" aria-label="Moveset">
            {sets.map((x) => (
              <button
                key={x.id}
                role="radio"
                aria-checked={x.id === set?.id}
                title={x.hint}
                onClick={() => pickSet(x.id)}
                className={cx(
                  'flex-1 rounded-lg px-2 py-1 font-display text-[12px] font-bold uppercase tracking-[0.1em] transition-colors',
                  x.id === set?.id ? 'bg-[var(--dojo-accent)] text-white' : 'bg-ink-800 text-zinc-400 hover:text-fg'
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
        <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {drills.map((d) => (
            <li key={d.key}>
              <button
                onClick={() => pick(d)}
                className={cx(
                  'flex w-full flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                  d.key === drill.key ? 'bg-ink-700' : 'hover:bg-ink-800'
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={cx('truncate text-[14px] font-semibold', d.key === drill.key ? 'text-fg' : 'text-zinc-300')}>{d.name}</span>
                  {(best[d.key] ?? 0) > 0 && (
                    <span title="Best streak" className="flex items-center gap-0.5 text-[12px] text-amber-300">
                      <Trophy size={11} />
                      {best[d.key]}
                    </span>
                  )}
                </span>
                <Notation input={d.input} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Stage */}
      <section className="relative isolate overflow-hidden rounded-3xl border border-line/[0.06] bg-ink-850 p-8">
        <span className="absolute -right-20 -top-20 -z-10 h-[160%] w-40 rotate-[20deg] bg-[var(--dojo-accent)] opacity-15" />
        <FlashBanner flash={flash} />

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-display text-[12px] font-bold uppercase tracking-[0.24em] text-zinc-500">{fighter ? fighter.name : 'The basics'}</div>
            <h2 className="mt-1 font-display text-[36px] font-bold uppercase italic leading-none text-fg">{drill.name}</h2>
            {drill.hint && <p className="mt-2 max-w-lg text-[14px] text-zinc-400">{drill.hint}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFacingRight((v) => !v)}
              title="Which side you stand on: forward is towards the opponent"
              className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-1.5 text-[13px] text-zinc-300 hover:border-[var(--dojo-accent)]"
            >
              <ArrowLeftRight size={14} /> {facingRight ? 'P1 side (facing right)' : 'P2 side (facing left)'}
            </button>
            <button
              onClick={() => {
                streakRef.current = 0
                setStats({ tries: 0, clean: 0, streak: 0 })
              }}
              title="Start counting again"
              className="flex size-8 items-center justify-center rounded-lg border border-ink-600 text-zinc-400 hover:text-fg"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div className="mt-10 flex min-h-[90px] items-center justify-center">
          <TargetGlyphs targets={targets} progress={progress} failed={failedAt} />
        </div>

        <div className="mt-8 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-10">
          <div className="flex flex-col items-center gap-2">
            <InputPad live={live} accent={accent} size={260} />
            <div className="flex items-center gap-1.5 text-[12px] text-zinc-500">
              {live.pad ? (
                <>
                  <Gamepad2 size={13} className="text-emerald-400" /> {live.pad}
                </>
              ) : (
                <>
                  <Keyboard size={13} /> WASD / arrows · U I J K = 1 2 3 4
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={Flame} label="Streak" value={String(stats.streak)} hot={stats.streak >= 3} />
            <Stat icon={TargetIcon} label="Accuracy" value={accuracy === null ? '–' : `${accuracy}%`} sub={`${stats.clean} / ${stats.tries}`} />
            <Stat icon={Trophy} label="Best streak" value={String(best[drill.key] ?? 0)} />
          </div>
        </div>

        {/* Input log, newest on the right */}
        <div className="mt-8 border-t border-line/[0.06] pt-4">
          <div className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-zinc-500">Your inputs</div>
          <div className="mt-2 flex h-9 items-center gap-1.5 overflow-hidden">
            {log.length === 0 && <span className="text-[13px] text-zinc-600">Press something on your controller or keyboard.</span>}
            {log.map((e) => (
              <span key={e.id} className="flex animate-fade-in items-center gap-0.5">
                <DirGlyph dir={e.dir} size="sm" />
                {e.buttons.length > 0 && <ButtonGlyph buttons={e.buttons} size="sm" />}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

const FLASH_TEXT = {
  clean: ['Clean!', 'text-emerald-300'],
  slow: ['Too slow', 'text-amber-300'],
  button: ['Wrong button', 'text-tekken-400'],
  direction: ['Wrong direction', 'text-tekken-400']
} as const

function FlashBanner({ flash }: { flash: Flash }) {
  if (!flash) return null
  const [text, cls] = FLASH_TEXT[flash.kind]
  return (
    <div key={flash.at} className="pointer-events-none absolute inset-x-0 top-[38%] z-10 flex justify-center">
      <span className={cx('dojo-flash font-display text-[64px] font-bold uppercase italic tracking-[0.02em] drop-shadow-[0_6px_24px_rgba(0,0,0,0.6)]', cls)}>{text}</span>
    </div>
  )
}

function Stat({ icon: Icon, label, value, sub, hot }: { icon: typeof Flame; label: string; value: string; sub?: string; hot?: boolean }) {
  return (
    <div className={cx('rounded-2xl border bg-ink-900/60 p-4 transition-colors', hot ? 'border-amber-400/50' : 'border-line/[0.06]')}>
      <div className="flex items-center gap-1.5 font-display text-[12px] font-bold uppercase tracking-[0.18em] text-zinc-500">
        <Icon size={13} className={hot ? 'text-amber-300' : ''} /> {label}
      </div>
      <div className="mt-1 font-display text-[38px] font-bold leading-none text-fg">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-zinc-500">{sub}</div>}
    </div>
  )
}
