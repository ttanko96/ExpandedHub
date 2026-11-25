import { AlertTriangle, CheckCircle2, Download, FolderOpen, HardDrive, Info, Loader2, Wrench, XCircle, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Preflight } from '@shared/install'
import type { ProjectDefinition } from '@shared/registry-schema'
import { cx } from '../../../lib/format'
import { useHub } from '../../../store/hub-store'
import { commonChecks } from './checks'
import { methodFor } from './methods'
import { AREA_LABEL, type Area, type Finding, type FixContext, type Level, type Symptom } from './types'

const LEVEL: Record<Level, { icon: LucideIcon; cls: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-emerald-400' },
  info: { icon: Info, cls: 'text-sky-400' },
  warn: { icon: AlertTriangle, cls: 'text-amber-300' },
  fail: { icon: XCircle, cls: 'text-tekken-400' }
}

const AREA_ICON: Record<Area, LucideIcon> = { install: FolderOpen, files: HardDrive, tools: Wrench, downloads: Download }

/**
 * Fix-it on a mod's page: the user picks what is going wrong with this mod, and
 * its own method (see `methods.ts`) shows each problem with the button that
 * fixes it. Nothing is changed without a click.
 */
export function FixItPanel({ project }: { project: ProjectDefinition }) {
  const method = methodFor(project.id)
  const [symptomId, setSymptomId] = useState<string | null>(null)
  const [run, setRun] = useState(0)
  const symptom = method.symptoms.find((s) => s.id === symptomId) ?? null

  // Another mod's page: start over.
  useEffect(() => setSymptomId(null), [project.id])

  return (
    <section className="rounded-2xl border border-line/[0.06] bg-ink-850 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[15px] font-bold uppercase tracking-[0.16em] text-zinc-300">Fix-it</h3>
        <span className="text-[13px] text-zinc-500">What is going wrong with {project.name}?</span>
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {method.symptoms.map((s) => {
          const Icon = s.icon
          const active = s.id === symptomId
          return (
            <button
              key={s.id}
              onClick={() => {
                setSymptomId(s.id)
                setRun((n) => n + 1)
              }}
              className={cx(
                'group flex flex-col items-start gap-2.5 rounded-xl border p-3 text-left transition-all',
                active ? 'border-tekken-500/70 bg-ink-800' : 'border-line/[0.06] bg-ink-900/50 hover:-translate-y-0.5 hover:border-ink-500'
              )}
            >
              <span className={cx('flex size-8 items-center justify-center rounded-lg transition-colors', active ? 'bg-tekken-500 text-white' : 'bg-ink-700 text-zinc-300 group-hover:text-fg')}>
                <Icon size={16} />
              </span>
              <span className={cx('text-[13px] font-semibold leading-snug', active ? 'text-fg' : 'text-zinc-300')}>{s.label}</span>
            </button>
          )
        })}
      </div>
      {symptom ? (
        <Checks key={run} project={project} symptom={symptom} />
      ) : (
        <p className="mt-4 text-[13px] text-zinc-500">The hub looks at this mod’s folder, game files, tools and downloads and suggests a fix. It changes nothing until you click.</p>
      )}
    </section>
  )
}

function Checks({ project, symptom }: { project: ProjectDefinition; symptom: Symptom }) {
  const navigate = useNavigate()
  const { projects, states, games, sources, operations, openInstall } = useHub()
  const [preflight, setPreflight] = useState<Preflight | null | undefined>(undefined)
  const [revealed, setRevealed] = useState(0)
  const areas = symptom.areas

  // Tools and dependencies come from the main process; asked again when files or installs change.
  useEffect(() => {
    let live = true
    window.hub.install.preflight(project.id).then(
      (pf) => live && setPreflight(pf),
      () => live && setPreflight(null)
    )
    return () => {
      live = false
    }
  }, [project.id, states, sources])

  const findings = useMemo<Record<Area, Finding[]>>(() => {
    const ctx: FixContext = { project, state: states[project.id], preflight: preflight ?? null, projects, states, games, sources, operations, navigate, openInstall }
    const out = commonChecks(ctx)
    const own = methodFor(project.id).checks?.(ctx) ?? {}
    for (const a of Object.keys(own) as Area[]) {
      const extra = own[a] ?? []
      if (extra.length === 0) continue
      // A problem the method found outranks the common "all fine" line.
      const problem = extra.some((f) => f.level === 'fail' || f.level === 'warn')
      out[a] = [...extra, ...out[a].filter((f) => !(problem && f.level === 'ok'))]
    }
    return out
  }, [project, preflight, projects, states, games, sources, operations, navigate, openInstall])

  // The areas appear one after the other, as if being scanned.
  useEffect(() => {
    if (preflight === undefined || revealed >= areas.length) return
    const t = setTimeout(() => setRevealed((n) => n + 1), revealed === 0 ? 250 : 420)
    return () => clearTimeout(t)
  }, [preflight, revealed, areas.length])

  const shown = areas.slice(0, revealed)
  const problems = shown.flatMap((a) => findings[a]).filter((f) => f.level === 'fail' || f.level === 'warn').length
  const done = revealed >= areas.length

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div
        className={cx(
          'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors',
          !done ? 'border-line/[0.06] bg-ink-900/50' : problems > 0 ? 'border-amber-400/40 bg-amber-400/[0.06]' : 'border-emerald-400/40 bg-emerald-400/[0.06]'
        )}
      >
        <span className="font-display text-[20px] font-bold uppercase italic leading-none text-fg">{!done ? 'Checking…' : problems === 0 ? 'All clear' : `${problems} to look at`}</span>
        <button onClick={() => void window.hub.app.openLogs()} className="text-[12px] text-zinc-400 hover:text-fg">
          Open the hub’s logs
        </button>
      </div>

      {areas.map((a, i) => {
        const visible = i < revealed
        const scanning = i === revealed
        const Icon = AREA_ICON[a]
        return (
          <div key={a} className={cx('rounded-xl border border-line/[0.06] bg-ink-900/40 p-3.5 transition-opacity', !visible && !scanning && 'opacity-40')}>
            <div className="flex items-center gap-2 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-zinc-400">
              <Icon size={14} />
              {AREA_LABEL[a]}
              {scanning && <Loader2 size={13} className="ml-auto animate-spin text-tekken-500" />}
            </div>
            {visible && (
              <ul className="mt-2.5 flex flex-col gap-2">
                {findings[a].map((f, j) => (
                  <FindingRow key={f.key} finding={f} delay={j * 60} />
                ))}
              </ul>
            )}
          </div>
        )
      })}

      {done && symptom.tips.length > 0 && (
        <div className="rounded-xl border border-line/[0.06] bg-ink-900/40 p-4">
          <div className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-zinc-500">Good to know</div>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[13px] leading-relaxed text-zinc-300">
            {symptom.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function FindingRow({ finding: f, delay }: { finding: Finding; delay: number }) {
  const { icon: Icon, cls } = LEVEL[f.level]
  return (
    <li className="flex animate-fade-up items-start gap-3 rounded-lg bg-ink-850/80 px-3 py-2.5" style={{ animationDelay: `${delay}ms` }}>
      <Icon size={17} className={cx('mt-0.5 shrink-0', cls)} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-zinc-100">{f.title}</div>
        {f.detail && <div className="selectable mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-zinc-500">{f.detail}</div>}
      </div>
      {f.action && (
        <button
          onClick={f.action.run}
          className="shrink-0 rounded-lg border border-ink-600 px-2.5 py-1 text-[12px] font-semibold text-zinc-200 hover:border-tekken-500/60 hover:text-fg"
        >
          {f.action.label}
        </button>
      )}
    </li>
  )
}
