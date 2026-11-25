import { AlertTriangle, CheckCircle2, CircleSlash, Download, HardDrive, Info, Loader2, Play, RefreshCw, Stethoscope, Wrench, XCircle, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Preflight } from '@shared/install'
import { cx } from '../lib/format'
import { useHub } from '../store/hub-store'

type Symptom = 'start' | 'install' | 'download' | 'missing' | 'all'
type Area = 'files' | 'projects' | 'tools' | 'downloads' | 'hub'

const SYMPTOMS: { id: Symptom; label: string; icon: LucideIcon; areas: Area[]; tips: string[] }[] = [
  {
    id: 'start',
    label: 'A game will not start',
    icon: Play,
    areas: ['projects', 'tools', 'files'],
    tips: [
      'Browser games (DriftEngine) open in Chrome or Edge, and the hub must stay open while you play.',
      'A project built before you changed your game files needs Build again.'
    ]
  },
  {
    id: 'install',
    label: 'An install or build failed',
    icon: Wrench,
    areas: ['downloads', 'files', 'tools'],
    tips: [
      'Builds read your own discs: a file that does not match the expected version is the most common cause.',
      'Look at the failed operation’s log on the Downloads page; its last lines usually name the problem.'
    ]
  },
  {
    id: 'download',
    label: 'Downloads or update checks fail',
    icon: Download,
    areas: ['downloads', 'hub'],
    tips: [
      'GitHub allows only 60 anonymous checks an hour. A personal token in Settings raises that a lot.',
      'Paused or failed downloads can be resumed: the parts already downloaded are kept.'
    ]
  },
  {
    id: 'missing',
    label: 'Something is missing in a game',
    icon: CircleSlash,
    areas: ['files', 'projects'],
    tips: [
      'Optional content (arcade stages, extra fighters, music) appears only when its game file is set up.',
      'After adding a game file or an add-on, click Build again on the project it belongs to.'
    ]
  },
  { id: 'all', label: 'Check everything', icon: Stethoscope, areas: ['files', 'projects', 'tools', 'downloads', 'hub'], tips: [] }
]

const AREA_LABEL: Record<Area, string> = {
  files: 'Your game files',
  projects: 'Installed projects',
  tools: 'Tools and dependencies',
  downloads: 'Downloads',
  hub: 'The hub'
}

type Level = 'ok' | 'info' | 'warn' | 'fail'
interface Finding {
  key: string
  level: Level
  title: string
  detail?: string
  action?: { label: string; run: () => void }
}

const LEVEL: Record<Level, { icon: LucideIcon; cls: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-emerald-400' },
  info: { icon: Info, cls: 'text-sky-400' },
  warn: { icon: AlertTriangle, cls: 'text-amber-300' },
  fail: { icon: XCircle, cls: 'text-tekken-400' }
}

/** Runs the hub's own checks and shows each problem with the button that fixes it. Nothing is changed without a click. */
export function FixIt() {
  const [symptom, setSymptom] = useState<Symptom | null>(null)
  const [run, setRun] = useState(0)
  const chosen = SYMPTOMS.find((s) => s.id === symptom) ?? null

  return (
    <div>
      <div className="grid grid-cols-5 gap-3">
        {SYMPTOMS.map((s) => {
          const Icon = s.icon
          const active = s.id === symptom
          return (
            <button
              key={s.id}
              onClick={() => {
                setSymptom(s.id)
                setRun((n) => n + 1)
              }}
              className={cx(
                'group flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-all',
                active ? 'border-tekken-500/70 bg-ink-800 shadow-[0_14px_36px_-18px_var(--color-tekken-500)]' : 'border-line/[0.06] bg-ink-850 hover:-translate-y-0.5 hover:border-ink-500'
              )}
            >
              <span className={cx('flex size-10 items-center justify-center rounded-xl transition-colors', active ? 'bg-tekken-500 text-white' : 'bg-ink-700 text-zinc-300 group-hover:text-fg')}>
                <Icon size={19} />
              </span>
              <span className={cx('font-display text-[16px] font-bold uppercase leading-tight tracking-[0.04em]', active ? 'text-fg' : 'text-zinc-300')}>{s.label}</span>
            </button>
          )
        })}
      </div>

      {!chosen && (
        <div className="mt-6 rounded-2xl border border-dashed border-ink-600 py-14 text-center text-[14px] text-zinc-500">
          Pick what is going wrong. The hub looks at your game files, installed projects, tools and downloads and
          suggests a fix. It changes nothing until you click.
        </div>
      )}
      {chosen && <Checks key={run} areas={chosen.areas} tips={chosen.tips} />}
    </div>
  )
}

function Checks({ areas, tips }: { areas: Area[]; tips: string[] }) {
  const navigate = useNavigate()
  const { projects, games, states, sources, operations, hubUpdate, summary, openInstall } = useHub()
  const [preflights, setPreflights] = useState<Record<string, Preflight | null> | null>(null)
  const [revealed, setRevealed] = useState(0)

  const installed = useMemo(() => projects.filter((p) => states[p.id]?.installed), [projects, states])

  // Tool and dependency checks need the main process: ask once per installed project.
  useEffect(() => {
    if (!areas.includes('tools')) {
      setPreflights({})
      return
    }
    let live = true
    Promise.all(
      installed.map((p) =>
        window.hub.install
          .preflight(p.id)
          .then((pf) => [p.id, pf] as const)
          .catch(() => [p.id, null] as const)
      )
    ).then((list) => live && setPreflights(Object.fromEntries(list)))
    return () => {
      live = false
    }
  }, [areas, installed])

  const findings = useMemo<Record<Area, Finding[]>>(() => {
    const out: Record<Area, Finding[]> = { files: [], projects: [], tools: [], downloads: [], hub: [] }

    // Game files
    const configured = Object.values(sources)
    if (configured.length === 0) {
      out.files.push({ key: 'none', level: 'warn', title: 'No game files set up yet', detail: 'Every project builds from your own discs or ROMs. Choose them on a project’s page under Your game files.', action: { label: 'Open the mods', run: () => navigate('/mods') } })
    }
    for (const s of configured) {
      const name = games.find((g) => g.id === s.gameId)?.name ?? s.gameId
      const v = s.validation
      const recheck = { label: 'Check again', run: () => void window.hub.sources.validate(s.gameId) }
      if (s.validating) out.files.push({ key: s.gameId, level: 'info', title: `${name}: being checked…` })
      else if (!v) out.files.push({ key: s.gameId, level: 'info', title: `${name}: not checked yet`, action: recheck })
      else if (v.verdict === 'verified') out.files.push({ key: s.gameId, level: 'ok', title: `${name}: verified`, detail: v.matched })
      else if (v.verdict === 'identified' || v.verdict === 'unverified') out.files.push({ key: s.gameId, level: 'info', title: `${name}: accepted`, detail: v.message })
      else out.files.push({ key: s.gameId, level: 'fail', title: `${name}: ${v.verdict === 'missing' ? 'the file is gone' : v.verdict === 'mismatch' ? 'not the expected version' : 'cannot be read'}`, detail: `${v.message}\n${s.path}`, action: recheck })
    }

    // Installed projects
    if (installed.length === 0) out.projects.push({ key: 'none', level: 'info', title: 'No project installed yet' })
    for (const p of installed) {
      const st = states[p.id]!
      const page = { label: 'Project page', run: () => navigate(`/mods/${p.id}`) }
      if (st.missing) out.projects.push({ key: p.id, level: 'fail', title: `${p.name}: its folder is not there`, detail: `Moved, deleted, or on a drive that is not connected.\n${st.installed?.installPath ?? ''}`, action: page })
      else if (st.rebuild.length > 0) out.projects.push({ key: p.id, level: 'warn', title: `${p.name}: needs Build again`, detail: `Changed since its last build: ${st.rebuild.join(', ')}.`, action: { label: 'Build again', run: () => openInstall(p.id, 'build') } })
      else if (st.status === 'update-available') out.projects.push({ key: p.id, level: 'info', title: `${p.name}: an update is available`, detail: st.latest ? `Version ${st.latest.version}` : undefined, action: { label: 'Update', run: () => openInstall(p.id) } })
      else if (st.error) out.projects.push({ key: p.id, level: 'warn', title: `${p.name}: the last update check failed`, detail: st.error, action: page })
      else out.projects.push({ key: p.id, level: 'ok', title: `${p.name}: installed and up to date` })
    }

    // Tools and dependencies
    for (const p of installed) {
      const pf = preflights?.[p.id]
      if (!pf) {
        out.tools.push({ key: `${p.id}:unknown`, level: 'info', title: `${p.name}: could not be checked`, detail: 'Its page shows what it needs when you click Install or Build again.' })
        continue
      }
      let fine = true
      for (const d of pf.dependencies.filter((d) => !d.installed)) {
        fine = false
        out.tools.push({ key: `${p.id}:dep:${d.id}`, level: 'fail', title: `${p.name} needs ${d.name}`, detail: `${d.name} is not installed.`, action: { label: `Open ${d.name}`, run: () => navigate(`/mods/${d.id}`) } })
      }
      for (const t of pf.tools.filter((t) => t.found === false && !t.optional)) {
        fine = false
        const fetched = pf.provisions.some((x) => x.toolId === t.id)
        out.tools.push({
          key: `${p.id}:tool:${t.id}`,
          level: fetched ? 'info' : 'warn',
          title: `${p.name}: ${t.name} not found`,
          detail: fetched ? 'The hub downloads it on the next install or build.' : 'Install it, or show the hub where it is.',
          action: fetched ? undefined : { label: 'Locate…', run: () => void window.hub.tools.pick(t.id) }
        })
      }
      if (fine) out.tools.push({ key: `${p.id}:ok`, level: 'ok', title: `${p.name}: everything it needs is there` })
    }
    if (installed.length === 0) out.tools.push({ key: 'none', level: 'info', title: 'Nothing to check until a project is installed' })

    // Downloads
    const failed = operations.filter((o) => o.status === 'failed')
    for (const o of failed) {
      out.downloads.push({
        key: o.id,
        level: 'fail',
        title: `${o.projectName}: ${o.kind === 'tool' ? 'tool download' : o.kind} failed`,
        detail: [o.error, o.hint].filter(Boolean).join('\n') || undefined,
        action: { label: 'Retry', run: () => void window.hub.operations.retry(o.id) }
      })
    }
    const paused = operations.filter((o) => o.status === 'paused')
    if (paused.length > 0) out.downloads.push({ key: 'paused', level: 'info', title: `${paused.length} paused`, action: { label: 'Downloads', run: () => navigate('/downloads') } })
    if (failed.length === 0 && paused.length === 0) out.downloads.push({ key: 'ok', level: 'ok', title: 'No failed or stuck downloads' })

    // The hub
    const rl = summary?.rateLimit
    if (rl && rl.remaining < 10) out.hub.push({ key: 'rate', level: 'warn', title: `GitHub checks almost used up (${rl.remaining} of ${rl.limit} left)`, detail: rl.authenticated ? 'They come back within the hour.' : 'Add a GitHub token in Settings for many more.', action: { label: 'Settings', run: () => navigate('/settings') } })
    if (summary?.lastError) out.hub.push({ key: 'check', level: 'warn', title: 'The last update check failed', detail: summary.lastError })
    if (hubUpdate?.status === 'available') out.hub.push({ key: 'update', level: 'info', title: `ExpandedHub ${hubUpdate.latest?.version ?? ''} is available`, detail: 'A newer hub may fix the problem.' })
    if (out.hub.length === 0) out.hub.push({ key: 'ok', level: 'ok', title: 'The hub is up to date and can reach GitHub' })

    return out
  }, [sources, games, installed, states, preflights, operations, summary, hubUpdate, navigate, openInstall])

  // The areas appear one after the other, as if being scanned.
  useEffect(() => {
    if (preflights === null) return
    if (revealed >= areas.length) return
    const t = setTimeout(() => setRevealed((n) => n + 1), revealed === 0 ? 250 : 420)
    return () => clearTimeout(t)
  }, [preflights, revealed, areas.length])

  const shown = areas.slice(0, revealed)
  const problems = shown.flatMap((a) => findings[a]).filter((f) => f.level === 'fail' || f.level === 'warn').length
  const done = revealed >= areas.length

  return (
    <div className="mt-6 grid grid-cols-[minmax(0,1fr)_300px] gap-6">
      <div className="flex flex-col gap-3">
        {areas.map((a, i) => {
          const visible = i < revealed
          const scanning = i === revealed
          return (
            <div key={a} className={cx('rounded-2xl border border-line/[0.06] bg-ink-850 p-4 transition-opacity', !visible && !scanning && 'opacity-40')}>
              <div className="flex items-center gap-2 font-display text-[14px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                {a === 'files' ? <HardDrive size={15} /> : a === 'downloads' ? <Download size={15} /> : a === 'tools' ? <Wrench size={15} /> : a === 'hub' ? <RefreshCw size={15} /> : <Play size={15} />}
                {AREA_LABEL[a]}
                {scanning && <Loader2 size={14} className="ml-auto animate-spin text-tekken-500" />}
              </div>
              {visible && (
                <ul className="mt-3 flex flex-col gap-2">
                  {findings[a].map((f, j) => (
                    <FindingRow key={f.key} finding={f} delay={j * 60} />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <aside className="flex flex-col gap-3">
        <div className={cx('rounded-2xl border p-5 transition-colors', !done ? 'border-line/[0.06] bg-ink-850' : problems > 0 ? 'border-amber-400/40 bg-amber-400/[0.06]' : 'border-emerald-400/40 bg-emerald-400/[0.06]')}>
          <div className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-zinc-500">Result</div>
          <div className="mt-1 font-display text-[28px] font-bold uppercase italic leading-tight text-fg">
            {!done ? 'Checking…' : problems === 0 ? 'All clear' : `${problems} to look at`}
          </div>
          {done && problems === 0 && <p className="mt-1 text-[13px] text-zinc-400">The hub found nothing wrong on its side. The tips below may still help.</p>}
        </div>
        {tips.length > 0 && (
          <div className="rounded-2xl border border-line/[0.06] bg-ink-850 p-5">
            <div className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-zinc-500">Good to know</div>
            <ul className="mt-2 flex list-disc flex-col gap-2 pl-4 text-[13px] leading-relaxed text-zinc-300">
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        <button
          onClick={() => void window.hub.app.openLogs()}
          className="rounded-xl border border-ink-600 px-4 py-2 text-[13px] text-zinc-300 hover:border-tekken-500/60 hover:text-fg"
        >
          Open the hub’s logs
        </button>
      </aside>
    </div>
  )
}

function FindingRow({ finding: f, delay }: { finding: Finding; delay: number }) {
  const { icon: Icon, cls } = LEVEL[f.level]
  return (
    <li className="flex animate-fade-up items-start gap-3 rounded-xl bg-ink-900/50 px-3 py-2.5" style={{ animationDelay: `${delay}ms` }}>
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
