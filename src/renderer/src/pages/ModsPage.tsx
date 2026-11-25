import { AlertTriangle, RefreshCw, Search, Star } from 'lucide-react'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { hostProjectId, type ProjectDefinition } from '@shared/registry-schema'
import type { ProjectStatus, RateLimitInfo } from '@shared/types'
import { FirstRunDialog } from '../components/install/FirstRunDialog'
import { ModCard } from '../components/mods/ModCard'
import { ModsTabs } from '../components/mods/ModsTabs'
import { Segmented } from '../components/ui/Segmented'
import { Label, LABEL_LEGEND } from '../components/ui/Label'
import { cx, relativeTime } from '../lib/format'
import { useHub } from '../store/hub-store'

type Filter = 'all' | 'installed' | 'updates' | 'available'
type Sort = 'curated' | 'liked'

const SORT_KEY = 'expandedhub.modsSort'
function readSort(): Sort {
  try {
    return localStorage.getItem(SORT_KEY) === 'liked' ? 'liked' : 'curated'
  } catch {
    return 'curated'
  }
}

const FILTERS: { id: Filter; label: string; match: (s: ProjectStatus) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'installed', label: 'Installed', match: (s) => s === 'up-to-date' || s === 'update-available' },
  { id: 'updates', label: 'Updates', match: (s) => s === 'update-available' },
  { id: 'available', label: 'Not installed', match: (s) => s === 'install-available' || s === 'not-installed' }
]

/**
 * The Mods page's frame: the header with its sections (Library, Mod Tours, Fix-it) stays while the
 * section below changes, so the tabs' highlight slides from one to the next.
 */
export function ModsLayout() {
  const { summary, refresh } = useHub()
  const { pathname } = useLocation()
  const title = pathname.startsWith('/mods/tours') ? 'Mod Tours' : pathname.startsWith('/mods/fix-it') ? 'Fix-it' : 'Mod Library'
  return (
    <div className="mx-auto max-w-[1280px] px-8 pb-16 pt-8">
      <FirstRunDialog />
      <div className="flex items-end justify-between gap-6">
        <div className="flex items-end gap-6">
          <div>
            <div className="font-display text-[13px] font-bold uppercase tracking-[0.3em] text-tekken-500">
              Supported projects
            </div>
            <h1 className="mt-1 font-display text-[44px] font-bold uppercase italic leading-none tracking-[0.02em] text-fg">
              {title}
            </h1>
          </div>
          <ModsTabs />
        </div>
        <UpdateCheckStatus
          running={summary?.running ?? false}
          lastSuccessAt={summary?.lastSuccessAt ?? null}
          lastError={summary?.lastError ?? null}
          mock={summary?.source === 'mock'}
          rateLimit={summary?.rateLimit ?? null}
          onRefresh={() => void refresh()}
        />
      </div>
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </div>
  )
}

/** The library: every supported project, filtered, searched and sorted. */
export function ModsPage() {
  const { projects, states, issues, ready, loadError } = useHub()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSortState] = useState<Sort>(readSort)
  const setSort = (s: Sort) => {
    setSortState(s)
    try {
      localStorage.setItem(SORT_KEY, s)
    } catch {
      /* the choice just is not remembered */
    }
  }

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>
    for (const f of FILTERS) c[f.id] = projects.filter((p) => f.match(states[p.id]?.status ?? 'not-installed')).length
    return c
  }, [projects, states])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = FILTERS.find((f) => f.id === filter)!.match
    return projects.filter((p) => {
      if (!match(states[p.id]?.status ?? 'not-installed')) return false
      if (!q) return true
      return [p.name, p.description, p.developer.name, ...p.labels.map((l) => l.text)].some((t) =>
        t.toLowerCase().includes(q)
      )
    })
  }, [projects, states, filter, query])

  // Add-ons go right under their host, indented. An add-on whose host is filtered out stands alone.
  const rows = useMemo(() => {
    const shown = new Set(visible.map((p) => p.id))
    const nested = (p: ProjectDefinition) => {
      const host = hostProjectId(p)
      return host !== null && shown.has(host)
    }
    const top = visible.filter((p) => !nested(p))
    // Popularity: by GitHub stars, unknown counts last; ties keep the curated order (the sort is stable).
    if (sort === 'liked') top.sort((a, b) => (states[b.id]?.stars ?? -1) - (states[a.id]?.stars ?? -1))
    return top.map((p) => ({ project: p, addons: visible.filter((a) => nested(a) && hostProjectId(a) === p.id) }))
  }, [visible, sort, states])

  return (
    <div>
      {/* Toolbar */}
      <div className="mt-7 flex items-center justify-between gap-4 border-b border-line/[0.06] pb-4">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            id: f.id,
            label: (
              <>
                {f.label}
                <span className={cx('text-[12px]', f.id === 'updates' && counts.updates > 0 ? 'text-emerald-400' : 'text-zinc-500')}>
                  {counts[f.id]}
                </span>
              </>
            )
          }))}
        />
        <div className="flex items-center gap-5">
          <Segmented
            label="Order"
            value={sort}
            onChange={setSort}
            options={[
              { id: 'curated', label: 'Default', title: 'The order set by the hub' },
              {
                id: 'liked',
                label: (
                  <>
                    <Star size={13} className={cx('shrink-0 transition-colors duration-300', sort === 'liked' && 'fill-amber-400/80 text-amber-400')} />
                    Popularity
                  </>
                ),
                title: 'By GitHub stars: the projects most people like first'
              }
            ]}
          />
          <div className="hidden grid-cols-2 gap-x-1.5 gap-y-1 xl:grid [&>span]:justify-center">
            {LABEL_LEGEND.map((l) => (
              <Label key={l.kind} kind={l.kind} text={l.text} />
            ))}
          </div>
          <label className="flex h-10 w-[260px] items-center gap-2 rounded-lg border border-ink-600 bg-ink-850 px-3 text-zinc-500 focus-within:border-tekken-500/60">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects, games, tools…"
              className="selectable w-full bg-transparent text-[14px] text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </label>
        </div>
      </div>

      {loadError && <Notice title="Could not load the hub" body={loadError} />}
      {issues.length > 0 && (
        <Notice
          title={`${issues.length} registry ${issues.length === 1 ? 'entry was' : 'entries were'} skipped or need attention`}
          body={issues.map((i) => `${i.file}: ${i.message}`).join('\n')}
        />
      )}

      {/* List */}
      <div className="mt-5 flex flex-col gap-3">
        {!ready && [0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        {ready &&
          rows.map(({ project: p, addons }, i) => (
            <div key={p.id} className="flex flex-col gap-3">
              <ModCard project={p} state={states[p.id]} index={i} />
              {addons.map((a) => (
                <div key={a.id} className="relative pl-12">
                  {/* tree connector from the host card */}
                  <span className="pointer-events-none absolute -top-3 bottom-1/2 left-6 w-5 rounded-bl-xl border-b-2 border-l-2 border-ink-600" />
                  <ModCard project={a} state={states[a.id]} index={i} addon />
                </div>
              ))}
            </div>
          ))}
        {ready && visible.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink-600 py-16 text-center text-zinc-500">
            {projects.length === 0 ? 'No projects in the registry yet.' : 'No projects match this filter.'}
          </div>
        )}
      </div>
    </div>
  )
}

function UpdateCheckStatus(props: {
  running: boolean
  lastSuccessAt: string | null
  lastError: string | null
  mock: boolean
  rateLimit: RateLimitInfo | null
  onRefresh: () => void
}) {
  // Re-render every 30s so "x minutes ago" stays current.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex items-center gap-4">
      <div className="text-right">
        <div className="text-[12px] uppercase tracking-[0.14em] text-zinc-500">
          {props.running ? 'Checking for updates…' : 'Last checked'}
        </div>
        <div className="text-[14px] text-zinc-300">
          {props.running ? ' ' : relativeTime(props.lastSuccessAt)}
          {props.mock && (
            <span
              className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300"
              title="Bundled demo release data, not GitHub. Change it in Settings → Advanced."
            >
              DEMO DATA
            </span>
          )}
          {!props.mock && props.rateLimit && (
            <span
              className={cx(
                'ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold',
                props.rateLimit.remaining < 10 ? 'bg-tekken-500/15 text-tekken-400' : 'bg-ink-700 text-zinc-400'
              )}
              title={`GitHub API: ${props.rateLimit.remaining} of ${props.rateLimit.limit} requests left this hour${props.rateLimit.authenticated ? ' (token)' : ' (anonymous)'}`}
            >
              API {props.rateLimit.remaining}/{props.rateLimit.limit}
            </span>
          )}
        </div>
        {props.lastError && <div className="ml-auto mt-0.5 max-w-[420px] text-[12px] leading-snug text-tekken-400">{props.lastError}</div>}
      </div>
      <button
        onClick={props.onRefresh}
        disabled={props.running}
        title="Check for updates now"
        className="flex size-11 items-center justify-center rounded-xl border border-ink-600 bg-ink-850 text-zinc-300 transition-colors hover:border-tekken-500/60 hover:text-fg disabled:opacity-60"
      >
        <RefreshCw size={18} className={props.running ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-5 flex gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-amber-200">{title}</div>
        <pre className="selectable mt-1 whitespace-pre-wrap font-sans text-[13px] text-zinc-400">{body}</pre>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="h-[178px] rounded-2xl border border-line/[0.04] bg-[linear-gradient(90deg,var(--color-ink-850)_0%,var(--color-ink-800)_50%,var(--color-ink-850)_100%)] bg-[length:200%_100%] animate-shimmer" />
  )
}
