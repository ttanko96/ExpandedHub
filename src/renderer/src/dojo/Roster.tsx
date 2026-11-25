import { Lock, Search } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { DojoFighter } from '@shared/dojo-schema'
import { Segmented } from '../components/ui/Segmented'
import { cx } from '../lib/format'
import { FIGHTERS, movesOf, ORIGIN_LABEL, rosterNumber } from './content'

type Filter = 'all' | 'start' | 'hidden' | 'ttt'

export function Roster() {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return FIGHTERS.filter((f) => {
      if (filter === 'start' && (f.origin !== 't3' || f.unlock)) return false
      if (filter === 'hidden' && (f.origin !== 't3' || !f.unlock)) return false
      if (filter === 'ttt' && f.origin !== 'ttt') return false
      return !q || [f.name, f.style, f.country].some((t) => t.toLowerCase().includes(q))
    })
  }, [filter, query])

  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-b border-line/[0.06] pb-4">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: <>All <span className="text-[12px] text-zinc-500">{FIGHTERS.length}</span></> },
            { id: 'start', label: 'From the start' },
            { id: 'hidden', label: 'Hidden' },
            { id: 'ttt', label: 'Tag Tournament', title: 'Added by Tekken 3 Expanded' }
          ]}
        />
        <label className="flex h-10 w-[260px] items-center gap-2 rounded-lg border border-ink-600 bg-ink-850 px-3 text-zinc-500 focus-within:border-tekken-500/60">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fighters, styles…"
            className="selectable w-full bg-transparent text-[14px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </label>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visible.map((f, i) => (
          <FighterCard key={f.id} fighter={f} index={i} />
        ))}
      </div>
      {visible.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-ink-600 py-16 text-center text-zinc-500">No fighter matches.</div>
      )}
    </div>
  )
}

/** A roster card: the hub's own typographic art (number, name, a slash of the fighter's colour). */
function FighterCard({ fighter: f, index }: { fighter: DojoFighter; index: number }) {
  const moves = movesOf(f).length
  return (
    <Link
      to={`/dojo/fighters/${f.id}`}
      style={{ '--dojo-accent': f.accent, animationDelay: `${Math.min(index, 20) * 25}ms` } as CSSProperties}
      className="group relative isolate flex aspect-[3/4] animate-fade-up flex-col overflow-hidden rounded-2xl border border-line/[0.06] bg-ink-850 p-4 transition-all duration-300 hover:-translate-y-1 hover:border-[var(--dojo-accent)]/60 hover:shadow-[0_18px_40px_-18px_var(--dojo-accent)]"
    >
      {/* colour slash */}
      <span className="absolute -right-10 -top-6 -z-10 h-[140%] w-24 rotate-[20deg] bg-[var(--dojo-accent)] opacity-80 transition-all duration-500 ease-out group-hover:-right-4 group-hover:w-40 group-hover:opacity-100" />
      <span className="absolute -right-16 top-0 -z-10 h-[140%] w-6 rotate-[20deg] bg-[var(--dojo-accent)] opacity-30 transition-all duration-500 ease-out group-hover:-right-1" />
      {/* big outlined number */}
      <span
        className="pointer-events-none absolute -left-1 -top-3 -z-10 font-display text-[96px] font-bold italic leading-none text-transparent opacity-40 transition-opacity group-hover:opacity-70"
        style={{ WebkitTextStroke: '1.5px var(--color-ink-500)' }}
      >
        {rosterNumber(f)}
      </span>

      <div className="flex items-start justify-between">
        <span className="rounded bg-ink-900/70 px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">{f.country}</span>
        {f.origin !== 't3' ? (
          <span
            title={`${ORIGIN_LABEL[f.origin]}: added by Tekken 3 Expanded`}
            className="rounded bg-ink-900/80 px-1.5 py-0.5 font-display text-[11px] font-bold tracking-[0.14em] text-white"
          >
            TTT
          </span>
        ) : (
          f.unlock && (
            <span title={f.unlock} className="rounded-full bg-ink-900/70 p-1 text-zinc-300">
              <Lock size={12} />
            </span>
          )
        )}
      </div>

      <div className="mt-auto">
        <div className={cx('font-display font-bold uppercase italic leading-[0.9] tracking-[0.01em] text-fg', f.name.length > 14 ? 'text-[24px]' : 'text-[30px]')}>
          {f.name.split(' ').map((w, i) => (
            <span key={i} className="block">
              {w}
            </span>
          ))}
        </div>
        <div className="mt-2 line-clamp-2 max-w-[68%] text-[12px] leading-snug text-zinc-400">{f.style}</div>
        <div className="mt-2 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-[color-mix(in_oklab,var(--dojo-accent)_65%,white)]">
          {f.movesFrom ? 'Shared moves' : moves > 0 ? `${moves} moves` : 'Random style'}
        </div>
      </div>
    </Link>
  )
}
