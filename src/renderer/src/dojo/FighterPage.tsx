import { AlertTriangle, ChevronLeft, ChevronRight, Dumbbell, Search } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Segmented } from '../components/ui/Segmented'
import type { DojoFighter, DojoMove, MoveKind } from '@shared/dojo-schema'
import { trainerTargets } from '@shared/dojo-notation'
import { cx } from '../lib/format'
import { FIGHTERS, fighterById, GAME_LABEL, movesetsOf, ORIGIN_LABEL, rosterNumber, type MovesetId } from './content'
import { InputPad, Notation } from './InputGlyphs'
import { usePortrait, usePortraits } from './portraits'

const KIND_LABEL: Record<MoveKind, string> = {
  string: 'Strings',
  poke: 'Pokes',
  launcher: 'Launchers',
  low: 'Lows',
  power: 'Power',
  throw: 'Throws',
  special: 'Specials',
  stance: 'Stances'
}

const KIND_ORDER: MoveKind[] = ['string', 'poke', 'launcher', 'low', 'power', 'special', 'stance', 'throw']

const HIT_STYLE: Record<string, [string, string]> = {
  h: ['H', 'bg-sky-500/20 text-sky-300'],
  m: ['M', 'bg-amber-500/20 text-amber-300'],
  l: ['L', 'bg-violet-500/20 text-violet-300'],
  s: ['SM', 'bg-amber-500/20 text-amber-300'],
  t: ['T', 'bg-zinc-500/25 text-zinc-300'],
  '!': ['!', 'bg-tekken-500/25 text-tekken-400']
}

export function FighterPage() {
  const { id } = useParams()
  const fighter = fighterById(id)
  const navigate = useNavigate()
  const [kind, setKind] = useState<MoveKind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [heroStep, setHeroStep] = useState<number | null>(null)
  const onHeroStep = useCallback((s: number | null) => setHeroStep(s), [])
  const portrait = usePortrait(fighter?.id ?? '')
  // Opened from far down the roster (or through prev / next): start at the top, not where the roster was.
  useLayoutEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [id])

  // Grouped by kind, throws last; the order inside a kind stays as written.
  const sets = useMemo(() => (fighter ? movesetsOf(fighter) : []), [fighter])
  // A link can open a given moveset (?set=ttt), as Unknown's and Tetsujin's do.
  const [params] = useSearchParams()
  const [setId, setSetId] = useState<MovesetId | null>((params.get('set') as MovesetId | null) ?? null)
  useEffect(() => setSetId((params.get('set') as MovesetId | null) ?? null), [id, params])
  const active = sets.find((x) => x.id === setId) ?? sets[0]
  const moves = useMemo(
    () => (active ? [...active.moves].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) : []),
    [active]
  )
  const kinds = useMemo(() => KIND_ORDER.filter((k) => moves.some((m) => m.kind === k)), [moves])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return moves.filter((m) => (kind === 'all' || m.kind === kind) && (!q || m.name.toLowerCase().includes(q) || (m.input ?? m.text ?? '').toLowerCase().includes(q)))
  }, [moves, kind, query])

  if (!fighter) return <Navigate to="/dojo/roster" replace />
  const index = FIGHTERS.indexOf(fighter)
  const prev = FIGHTERS[(index - 1 + FIGHTERS.length) % FIGHTERS.length]!
  const next = FIGHTERS[(index + 1) % FIGHTERS.length]!
  const lender = fighter.movesFrom ? fighterById(fighter.movesFrom) : undefined
  // The other way round: who fights with this fighter's moves (Roger → Alex, Kuma → Panda, …).
  const borrowers = FIGHTERS.filter((f) => f.movesFrom === fighter.id)
  // The hero always shows the fighter's own list's signature move.
  const heroMoves = (sets[0]?.moves ?? []).filter((m): m is DojoMove & { input: string } => !!m.input && !m.when)
  const signature = heroMoves.find((m) => m.name === fighter.signature) ?? heroMoves.find((m) => m.kind === 'launcher') ?? heroMoves[0]
  const style = { '--dojo-accent': fighter.accent } as CSSProperties

  return (
    <div style={style} key={fighter.id}>
      <Link to="/dojo/roster" className="-mt-3 mb-3 flex w-fit items-center gap-1 text-[13px] text-zinc-400 hover:text-fg">
        <ChevronLeft size={15} /> Roster
      </Link>

      {/* Hero */}
      <section className="relative isolate overflow-hidden rounded-3xl border border-line/[0.06] bg-ink-850">
        <span className="absolute -right-24 -top-20 -z-10 h-[180%] w-[46%] rotate-[20deg] bg-[var(--dojo-accent)] opacity-90" />
        <span className="absolute right-[40%] -top-20 -z-10 h-[180%] w-4 rotate-[20deg] bg-[var(--dojo-accent)] opacity-40" />
        <span className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_20%_120%,color-mix(in_oklab,var(--dojo-accent)_22%,transparent),transparent_60%)]" />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-8 left-4 -z-10 whitespace-nowrap font-display text-[180px] font-bold uppercase italic leading-none text-transparent opacity-50"
          style={{ WebkitTextStroke: '2px var(--color-ink-600)' }}
        >
          {fighter.name}
        </span>

        {/* the player's own portrait, from their Tekken 3 Expanded (Settings → Dojo) */}
        {portrait && (
          <img
            key={portrait}
            src={portrait}
            alt=""
            draggable={false}
            className={cx(
              'dojo-portrait pointer-events-none absolute bottom-0 right-[340px] -z-10 h-[118%] w-auto animate-fade-in object-contain drop-shadow-[0_16px_30px_rgba(0,0,0,0.6)]',
              // Lowered so the head stays inside the panel: Tag Tournament's portraits fill more of their frame.
              fighter.origin === 'ttt' ? 'translate-y-[22%]' : 'translate-y-[15%]'
            )}
          />
        )}
        <div className="flex min-h-[300px] items-stretch gap-8 p-8">
          <div className="flex min-w-0 flex-1 animate-fade-up flex-col">
            <div className="flex items-center gap-2">
              <span className="font-display text-[15px] font-bold tracking-[0.2em] text-[color-mix(in_oklab,var(--dojo-accent)_65%,white)]">#{rosterNumber(fighter)}</span>
              {/* every game the fighter can be played with: their own, then the MOVESET card's */}
              {[...new Set([ORIGIN_LABEL[fighter.origin], ...sets.map((x) => GAME_LABEL[x.id])])].map((game) => (
                <span key={game} className="rounded bg-ink-700 px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-300">
                  {game}
                </span>
              ))}
            </div>
            <h2 className="mt-2 font-display text-[64px] font-bold uppercase italic leading-[0.9] tracking-[0.01em] text-fg">{fighter.name}</h2>
            <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-zinc-300">{fighter.tagline}</p>
            <dl className="mt-auto flex gap-10 pt-6">
              <Fact label="Style" value={fighter.style} />
              <Fact label="From" value={fighter.country} />
              <Fact
                label="Moves"
                value={lender ? `${lender.name}'s` : fighter.mimics ? `${fighter.mimics.fighters.length} styles` : String(moves.length)}
              />
            </dl>
          </div>

          {signature && (
            <div className="flex w-[300px] shrink-0 animate-fade-in flex-col items-center justify-center rounded-2xl bg-ink-900/80 p-5 backdrop-blur">
              <div className="font-display text-[12px] font-bold uppercase tracking-[0.24em] text-zinc-500">Signature</div>
              <div className="mt-1 text-center font-display text-[22px] font-bold uppercase leading-tight text-fg">{signature.name}</div>
              <div className="mt-3">
                <InputPad input={signature.input} accent={fighter.accent} size={240} onStep={onHeroStep} />
              </div>
              <div className="mt-3">
                <Notation input={signature.input} activeStep={heroStep} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Moves */}
      <section className="mt-8">
        {sets.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              label="Moveset"
              value={active!.id}
              onChange={(id) => {
                setSetId(id)
                setKind('all')
                setOpen(null)
              }}
              options={sets.map((x) => ({ id: x.id, label: x.label, title: x.hint }))}
            />
          </div>
        )}
        {active && !active.verified && (
          <div className="mb-4 flex gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-[13px] text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <span>
              The full list from the Tekken Wiki, not yet checked {active.id === 't3' ? 'in Tekken 3' : 'in Tekken 3 Expanded'}: a command may
              differ there. Try it in Practice mode before you rely on it.
            </span>
          </div>
        )}
        {lender && (
          <div className="mb-4 text-[14px] text-zinc-400">
            {fighter.name} fights with{' '}
            <Link to={`/dojo/fighters/${lender.id}`} className="font-semibold text-[var(--dojo-accent)] hover:underline">
              {lender.name}
            </Link>
            ’s moves.
          </div>
        )}
        {borrowers.length > 0 && (
          <div className="mb-4 text-[14px] text-zinc-400">
            {borrowers.map((b, i) => (
              <span key={b.id}>
                {i > 0 && (i === borrowers.length - 1 ? ' and ' : ', ')}
                <Link to={`/dojo/fighters/${b.id}`} className="font-semibold text-[var(--dojo-accent)] hover:underline">
                  {b.name}
                </Link>
              </span>
            ))}{' '}
            {borrowers.length > 1 ? 'fight' : 'fights'} with {fighter.name}’s moves too.
          </div>
        )}
        {fighter.mimics && <Mimics fighterName={fighter.name} mimics={fighter.mimics} />}

        {moves.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/[0.06] pb-4">
              <div className="flex flex-wrap gap-1.5">
                {(['all', ...kinds] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={cx(
                      'rounded-full px-3 py-1 font-display text-[13px] font-bold uppercase tracking-[0.1em] transition-colors',
                      kind === k ? 'bg-[var(--dojo-accent)] text-white' : 'bg-ink-850 text-zinc-400 hover:text-fg'
                    )}
                  >
                    {k === 'all' ? `All ${moves.length}` : KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <label className="flex h-9 w-[240px] items-center gap-2 rounded-lg border border-ink-600 bg-ink-850 px-3 text-zinc-500 focus-within:border-[var(--dojo-accent)]/60">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a move or command…"
                  className="selectable w-full bg-transparent text-[13px] text-zinc-200 outline-none placeholder:text-zinc-600"
                />
              </label>
            </div>
            <ul className="mt-2 divide-y divide-line/[0.05]">
              {visible.map((m, i) => {
                const key = `${m.name}|${m.when ?? ''}|${m.input ?? m.text}|${i}`
                return (
                <MoveRow
                  key={key}
                  move={m}
                  accent={fighter.accent}
                  open={open === key}
                  onToggle={() => setOpen(open === key ? null : key)}
                  onPractise={() => navigate(`/dojo/trainer?fighter=${fighter.id}&set=${active!.id}&move=${encodeURIComponent(m.name)}`)}
                />
                )
              })}
            </ul>
            {active && (
              <p className="mt-3 px-3 text-[12px] text-zinc-600">
                Move list:{' '}
                <button
                  className="underline decoration-dotted hover:text-zinc-400"
                  onClick={() => void window.hub.app.openExternal(`https://tekken.fandom.com/wiki/${encodeURIComponent(active.source.title.replace(/ /g, '_')).replace(/%2F/g, '/')}`)}
                >
                  {active.source.title}
                </button>
                , {active.source.site} contributors, {active.source.license}, turned into the hub’s notation. Descriptions are the hub’s own.
              </p>
            )}
          </>
        )}
      </section>

      {/* Prev / next */}
      <div className="mt-10 flex justify-between">
        <NeighbourLink to={prev.id} name={prev.name} accent={prev.accent} dir="prev" />
        <NeighbourLink to={next.id} name={next.name} accent={next.accent} dir="next" />
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium text-zinc-200">{value}</dd>
    </div>
  )
}

function MoveRow({ move, accent, open, onToggle, onPractise }: { move: DojoMove; accent: string; open: boolean; onToggle: () => void; onPractise: () => void }) {
  const trainable = !!move.input && !move.when && trainerTargets(move.input) !== null
  const [step, setStep] = useState<number | null>(null)
  const onStep = useCallback((s: number | null) => setStep(s), [])
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}
        className={cx('group grid cursor-pointer grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_150px] items-center gap-4 rounded-lg px-3 py-3 transition-colors', open ? 'bg-ink-850' : 'hover:bg-ink-850/60')}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-zinc-100">{move.name}</div>
            <div className="font-display text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-500">{KIND_LABEL[move.kind].replace(/s$/, '')}</div>
          </div>
          {/* beside the name, so long inputs and hit lists never run into it */}
          {trainable && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onPractise()
              }}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-zinc-300 opacity-0 transition-all hover:border-[var(--dojo-accent)] hover:text-fg group-hover:opacity-100 focus:opacity-100"
            >
              <Dumbbell size={13} /> Practise
            </button>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {move.when && <span className="rounded-md bg-ink-700 px-1.5 py-0.5 text-[12px] text-zinc-300">{move.when}</span>}
          {move.input ? <Notation input={move.input} activeStep={open ? step : null} /> : <span className="text-[13px] italic text-zinc-400">{move.text}</span>}
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {(move.hits?.split(',') ?? []).map((h, i) => {
            const [label, cls] = HIT_STYLE[h] ?? [h, '']
            return (
              <span key={i} className={cx('rounded px-1.5 py-0.5 font-display text-[12px] font-bold', cls)}>
                {label}
              </span>
            )
          })}
        </div>
      </div>
      {open && (
        <div className="flex animate-fade-up items-center gap-6 px-3 pb-4 pt-1">
          {move.input && <InputPad input={move.input} accent={accent} size={200} onStep={onStep} />}
          <div className="min-w-0 text-[14px] leading-relaxed text-zinc-400">
            {move.when && <p className="mb-1 text-zinc-300">{move.when}:</p>}
            <code className="selectable rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[13px] text-zinc-200">{move.input ?? move.text}</code>
            {move.note && <p className="mt-2">{move.note}</p>}
            {!trainable && (
              <p className="mt-2 text-zinc-500">
                {move.input
                  ? 'Needs a situation only the game can set up, so the Trainer cannot check it.'
                  : 'The notation cannot draw this one: it depends on what happens in the fight.'}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function NeighbourLink({ to, name, accent, dir }: { to: string; name: string; accent: string; dir: 'prev' | 'next' }) {
  return (
    <Link
      to={`/dojo/fighters/${to}`}
      style={{ '--dojo-accent': accent } as CSSProperties}
      className={cx('group flex items-center gap-3 rounded-xl border border-line/[0.06] bg-ink-850 px-4 py-3 transition-colors hover:border-[var(--dojo-accent)]/60', dir === 'next' && 'flex-row-reverse text-right')}
    >
      {dir === 'prev' ? <ChevronLeft size={18} className="text-zinc-500" /> : <ChevronRight size={18} className="text-zinc-500" />}
      <span>
        <span className="block font-display text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">{dir === 'prev' ? 'Previous' : 'Next'}</span>
        <span className="block font-display text-[18px] font-bold uppercase italic text-fg">
          <span className="mr-1.5 inline-block h-3 w-1.5 -skew-x-12 bg-[var(--dojo-accent)]" />
          {name}
        </span>
      </span>
    </Link>
  )
}

/** A copying fighter's page: the fighters whose moves they take, each linking to that moveset. */
function Mimics({ fighterName, mimics }: { fighterName: string; mimics: NonNullable<DojoFighter['mimics']> }) {
  const portraits = usePortraits()?.portraits ?? {}
  const fighters = mimics.fighters.map((id) => fighterById(id)).filter((f): f is DojoFighter => !!f)
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-[22px] font-bold uppercase text-fg">Fights with their moves</h3>
        <span className="text-[14px] text-zinc-400">{mimics.how}</span>
      </div>
      <p className="mb-4 text-[13px] text-zinc-500">
        {fighterName} has no move list of their own: open a fighter to see the moves {fighterName} uses with their style
        ({mimics.moveset === 'ttt' ? 'their Tag Tournament moveset' : 'their Tekken 3 moves'}).
      </p>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {fighters.map((f, i) => (
          <Link
            key={f.id}
            to={`/dojo/fighters/${f.id}?set=${mimics.moveset}`}
            style={{ '--dojo-accent': f.accent, animationDelay: `${Math.min(i, 24) * 20}ms` } as CSSProperties}
            className="group relative isolate flex h-[104px] animate-fade-up items-end overflow-hidden rounded-xl border border-line/[0.06] bg-ink-850 p-3 transition-all hover:-translate-y-0.5 hover:border-[var(--dojo-accent)]/60"
          >
            <span className="absolute -right-6 -top-4 -z-10 h-[150%] w-12 rotate-[20deg] bg-[var(--dojo-accent)] opacity-80 transition-all duration-300 group-hover:w-16" />
            {portraits[f.id] && (
              <img
                src={portraits[f.id]}
                alt=""
                draggable={false}
                className="dojo-portrait pointer-events-none absolute -right-1 bottom-0 -z-10 h-[92%] w-auto object-contain"
              />
            )}
            {portraits[f.id] && <span className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-ink-850 to-transparent" />}
            <span className="font-display text-[16px] font-bold uppercase italic leading-[0.95] text-fg">
              {f.name.split(' ').map((w, j) => (
                <span key={j} className="block">
                  {w}
                </span>
              ))}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
