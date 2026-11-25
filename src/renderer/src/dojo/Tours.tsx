import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Disc,
  Download,
  ExternalLink,
  Film,
  Gamepad2,
  Layers,
  Map,
  Monitor,
  Music,
  Play,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import type { Screenshot } from '@shared/install'
import type { TOUR_ICONS } from '@shared/dojo-schema'
import { cx } from '../lib/format'
import { useHub } from '../store/hub-store'
import { TOURS } from './content'

const ICON: Record<(typeof TOUR_ICONS)[number], LucideIcon> = {
  disc: Disc,
  download: Download,
  play: Play,
  music: Music,
  camera: Camera,
  trophy: Trophy,
  swords: Swords,
  users: Users,
  map: Map,
  sparkles: Sparkles,
  gamepad: Gamepad2,
  cpu: Cpu,
  film: Film,
  wrench: Wrench,
  layers: Layers,
  monitor: Monitor
}

/** What each project adds, chapter by chapter, over the project's own screenshots once it is installed. */
export function Tours() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const projects = useHub((s) => s.projects)
  const states = useHub((s) => s.states)

  // Tours in the registry's order; only for projects the hub shows.
  const tours = useMemo(
    () =>
      TOURS.map((t) => ({ tour: t, project: projects.find((p) => p.id === t.projectId) }))
        .filter((x) => x.project && !x.project.hidden)
        .sort((a, b) => a.project!.order - b.project!.order),
    [projects]
  )
  const current = tours.find((t) => t.tour.projectId === projectId) ?? null
  const [chapter, setChapter] = useState(0)
  const [shots, setShots] = useState<Screenshot[]>([])
  const installed = current ? !!states[current.tour.projectId]?.installed : false

  useEffect(() => setChapter(0), [projectId])
  useEffect(() => {
    setShots([])
    if (!current || !installed) return
    let live = true
    window.hub.install
      .screenshots(current.tour.projectId)
      .then((s) => live && setShots(s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [current?.tour.projectId, installed]) // eslint-disable-line react-hooks/exhaustive-deps

  const count = current?.tour.chapters.length ?? 0
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setChapter((c) => Math.min(c + 1, count - 1))
      if (e.key === 'ArrowLeft') setChapter((c) => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, count])

  if (tours.length === 0) return <div className="rounded-2xl border border-dashed border-ink-600 py-16 text-center text-zinc-500">No tours yet.</div>
  if (!projectId) return <Navigate to={`/mods/tours/${tours[0]!.tour.projectId}`} replace />
  if (!current) return <Navigate to="/mods/tours" replace />

  const { tour, project } = current
  const accent = project!.artwork.accent
  const ch = tour.chapters[chapter]!
  const Icon = ICON[ch.icon]
  // The chapter's own screenshot when the project has it, else one of the project's, in turn.
  const shot = shots.find((s) => s.name === ch.screenshot) ?? (shots.length > 0 ? shots[chapter % shots.length] : undefined)

  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6" style={{ '--dojo-accent': accent } as CSSProperties}>
      <nav aria-label="Projects" className="flex flex-col gap-1.5">
        {tours.map(({ tour: t, project: p }) => {
          const active = t.projectId === tour.projectId
          return (
            <button
              key={t.projectId}
              onClick={() => navigate(`/mods/tours/${t.projectId}`)}
              style={{ '--tile': p!.artwork.accent } as CSSProperties}
              className={cx(
                'group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                active ? 'border-[var(--tile)]/60 bg-ink-800' : 'border-transparent hover:bg-ink-850'
              )}
            >
              <span className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--tile)] font-display text-[13px] font-bold italic text-white">
                {p!.artwork.monogram ?? p!.name.slice(0, 3)}
              </span>
              <span className="min-w-0">
                <span className={cx('block truncate text-[14px] font-semibold', active ? 'text-fg' : 'text-zinc-300')}>{p!.name}</span>
                <span className="block text-[12px] text-zinc-500">
                  {t.chapters.length} chapters{states[t.projectId]?.installed ? ' · installed' : ''}
                </span>
              </span>
            </button>
          )
        })}
      </nav>

      <section className="relative isolate min-h-[520px] overflow-hidden rounded-3xl border border-line/[0.06] bg-ink-900">
        {/* Backdrop: the project's own screenshot, or the hub's drawn tile */}
        {shot ? (
          <div key={shot.url} className="absolute inset-0 -z-10 animate-fade-in">
            <img src={shot.url} alt="" className="dojo-kenburns h-full w-full object-cover opacity-45" />
          </div>
        ) : (
          <div className="absolute inset-0 -z-10">
            <span className="absolute -right-24 -top-24 h-[170%] w-[42%] rotate-[20deg] bg-[var(--dojo-accent)] opacity-70" />
            <span className="absolute right-[38%] -top-24 h-[170%] w-5 rotate-[20deg] bg-[var(--dojo-accent)] opacity-30" />
            <span
              className="absolute -bottom-10 right-6 font-display text-[220px] font-bold italic leading-none text-transparent opacity-50"
              style={{ WebkitTextStroke: '2px var(--color-ink-600)' }}
            >
              {project!.artwork.monogram ?? ''}
            </span>
          </div>
        )}
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,var(--color-ink-900)_0%,color-mix(in_oklab,var(--color-ink-900)_85%,transparent)_45%,transparent_100%)]" />

        <div className="flex h-full min-h-[520px] flex-col p-9">
          <div className="flex items-start justify-between gap-4">
            <div className="max-w-xl">
              <div className="font-display text-[12px] font-bold uppercase tracking-[0.24em] text-[var(--dojo-accent)]">{project!.name}</div>
              <h2 className="mt-1 font-display text-[40px] font-bold uppercase italic leading-none text-fg">{tour.title}</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-zinc-400">{tour.intro}</p>
            </div>
            <Link
              to={`/mods/${project!.id}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-900/70 px-3 py-1.5 text-[13px] text-zinc-300 hover:border-[var(--dojo-accent)] hover:text-fg"
            >
              Project page <ExternalLink size={13} />
            </Link>
          </div>

          {/* Chapter */}
          <div key={`${tour.projectId}-${chapter}`} className="mt-auto max-w-xl animate-fade-up pt-10">
            <div className="flex items-center gap-4">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-[var(--dojo-accent)] text-white shadow-[0_10px_30px_-10px_var(--dojo-accent)]">
                <Icon size={26} />
              </span>
              <div>
                <div className="font-display text-[13px] font-bold tracking-[0.2em] text-zinc-500">
                  {String(chapter + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
                </div>
                <h3 className="font-display text-[30px] font-bold uppercase leading-none text-fg">{ch.title}</h3>
              </div>
            </div>
            <p className="mt-4 text-[16px] leading-relaxed text-zinc-200">{ch.body}</p>
            {ch.keys.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {ch.keys.map((k) => (
                  <span key={k} className="rounded-lg border border-line/10 border-b-[3px] bg-ink-800/90 px-2.5 py-1 text-[13px] text-zinc-200">
                    {k}
                  </span>
                ))}
              </div>
            )}
            {!installed && <p className="mt-4 text-[12px] text-zinc-500">Install the project to see its own screenshots here.</p>}
          </div>

          {/* Stepper */}
          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={() => setChapter((c) => Math.max(c - 1, 0))}
              disabled={chapter === 0}
              aria-label="Previous chapter"
              className="flex size-9 items-center justify-center rounded-lg border border-ink-600 bg-ink-900/70 text-zinc-300 hover:text-fg disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex flex-1 gap-1.5">
              {tour.chapters.map((c, i) => (
                <button
                  key={i}
                  title={c.title}
                  onClick={() => setChapter(i)}
                  className="group h-8 flex-1 py-3.5"
                  aria-label={`Chapter ${i + 1}: ${c.title}`}
                >
                  <span
                    className={cx(
                      'block h-1 rounded-full transition-all duration-300',
                      i === chapter ? 'bg-[var(--dojo-accent)]' : i < chapter ? 'bg-zinc-500' : 'bg-ink-600 group-hover:bg-ink-500'
                    )}
                  />
                </button>
              ))}
            </div>
            <button
              onClick={() => setChapter((c) => Math.min(c + 1, count - 1))}
              disabled={chapter === count - 1}
              aria-label="Next chapter"
              className="flex size-9 items-center justify-center rounded-lg border border-ink-600 bg-ink-900/70 text-zinc-300 hover:text-fg disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
