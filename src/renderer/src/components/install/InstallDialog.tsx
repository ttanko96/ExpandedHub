import { AlertTriangle, CheckCircle2, Link2, Lock, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Preflight } from '@shared/install'
import { cx, formatBytes } from '../../lib/format'
import { useHub } from '../../store/hub-store'
import { ipcMessage, projectActions } from '../mods/actions'
import { Button } from '../ui/Button'
import { ProjectTile } from '../ui/ProjectTile'
import { SourceRow } from './SourceRow'
import { ToolRow } from './ToolRow'

/**
 * Pre-installation checklist: game files, tools, dependencies, and an explicit
 * consent for every project script that will run. Nothing starts until the
 * user presses Install here.
 */
export function InstallDialog() {
  const { installFor, installMode, installExtra, openInstall, projects, states, sources } = useHub()
  const extraId = installMode === 'extra' ? installExtra : null
  const building = installMode === 'build' || Boolean(extraId)
  const project = projects.find((p) => p.id === installFor)
  const state = installFor ? states[installFor] : undefined
  const navigate = useNavigate()
  const [pre, setPre] = useState<Preflight | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [starting, setStarting] = useState(false)

  const load = useCallback(() => {
    if (!installFor) return
    ;(extraId
      ? window.hub.install.extraPreflight(installFor, extraId)
      : building
        ? window.hub.install.buildPreflight(installFor)
        : window.hub.install.preflight(installFor))
      .then((p) => {
        setPre(p)
        setError(null)
      })
      .catch((e) => setError(ipcMessage(e)))
  }, [installFor, building, extraId])

  // Reload whenever the user changes a game file or an install finishes.
  useEffect(() => {
    setConsent(false)
    setPre(null)
    load()
  }, [installFor, load])
  useEffect(() => {
    if (installFor) load()
  }, [sources, states, installFor, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openInstall(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openInstall])

  if (!project) return null
  const close = () => openInstall(null)
  const isUpdate = !building && state?.status === 'update-available'
  const verb = extraId ? 'Make' : building ? 'Build' : isUpdate ? 'Update' : 'Install'
  const needsConsent = (pre?.scripts.length ?? 0) > 0
  const validating = pre?.sources.some((s) => sources[s.gameId]?.validating) ?? false
  const canStart = pre && pre.blockers.length === 0 && (!needsConsent || consent) && !starting

  const start = async () => {
    setStarting(true)
    const ok = building
      ? await projectActions.build(project, consent, () => navigate('/downloads'), extraId ?? undefined)
      : await projectActions.start(project, state, consent, () => navigate('/downloads'))
    setStarting(false)
    if (ok) close()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm" onClick={close}>
      <div
        role="dialog"
        aria-label={`${verb} ${project.name}`}
        className="flex max-h-full w-full max-w-[760px] animate-fade-up flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-4 border-b border-line/[0.06] px-6 py-5">
          <ProjectTile project={project} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold uppercase tracking-[0.24em] text-tekken-500">
              {verb}
            </div>
            <div className="truncate font-display text-[26px] font-bold uppercase leading-tight tracking-wide text-fg">
              {pre?.extra ? `${project.name}: ${pre.extra.name}` : project.name}{' '}
              {pre?.version && !pre.extra ? <span className="text-zinc-400">v{pre.version}</span> : null}
            </div>
          </div>
          <button onClick={close} className="text-zinc-500 hover:text-fg" aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && <div className="rounded-lg bg-tekken-500/10 p-3 text-[13px] text-tekken-300">{error}</div>}
          {!pre && !error && <div className="py-10 text-center text-[14px] text-zinc-500">Checking requirements…</div>}
          {pre && (
            <div className="flex flex-col gap-5">
              <Block title="What happens">
                <ul className="flex flex-col gap-1.5 text-[13.5px] text-zinc-300">
                  {pre.extra ? (
                    <>
                      <li>{pre.extra.description}</li>
                      <li>
                        Made in{' '}
                        <code className="selectable rounded bg-ink-800 px-1.5 py-0.5 text-[12.5px] text-zinc-200">{pre.installPath}</code>
                        <span className="text-zinc-500"> — runs in the background, no terminal needed; a run that stops continues where it was</span>
                      </li>
                    </>
                  ) : building ? (
                    <li>
                      Build again in{' '}
                      <code className="selectable rounded bg-ink-800 px-1.5 py-0.5 text-[12.5px] text-zinc-200">{pre.installPath}</code>
                      <span className="text-zinc-500"> — nothing is downloaded from GitHub; finished build work is reused</span>
                    </li>
                  ) : (
                  <>
                  <li>
                    Download <span className="text-zinc-100">{pre.download.file ?? '—'}</span>
                    {pre.download.size ? <span className="text-zinc-500"> · {formatBytes(pre.download.size)}</span> : null}
                    {' '}from GitHub
                  </li>
                  <li>
                    Install into <code className="selectable rounded bg-ink-800 px-1.5 py-0.5 text-[12.5px] text-zinc-200">{pre.installPath ?? 'after its dependency is installed'}</code>
                    {isUpdate && <span className="text-zinc-500"> — new files replace old ones, your saves and settings stay</span>}
                  </li>
                  </>
                  )}
                  {!building && pre.scripts.length > 0 && (
                    <li>
                      Then build it on this PC with the project's own setup — progress shows on the Downloads page
                    </li>
                  )}
                </ul>
              </Block>

              {pre.extra && pre.extra.needs.length > 0 && (
                <Block title="What it takes">
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px] text-zinc-300 marker:text-zinc-600">
                    {pre.extra.needs.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </Block>
              )}

              {pre.sources.length > 0 && (
                <Block title="Your game files" note="Selected once, reused by every project. Never uploaded or copied.">
                  <div className="divide-y divide-line/[0.04]">
                    {pre.sources.map((s) => (
                      <SourceRow key={s.gameId} {...s} config={sources[s.gameId] ?? s.config} compact />
                    ))}
                  </div>
                </Block>
              )}

              {(pre.tools.length > 0 || pre.dependencies.length > 0) && (
                <Block title="Tools & dependencies">
                  <ul className="flex flex-col gap-2">
                    {pre.dependencies.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 text-[13.5px]">
                        {d.installed ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Link2 size={16} className="text-tekken-400" />}
                        <span className="text-zinc-200">{d.name}</span>
                        <span className="ml-auto text-[12px] text-zinc-500">{d.installed ? 'installed' : 'install this first'}</span>
                      </li>
                    ))}
                    {pre.tools.map((t) => (
                      <ToolRow key={t.id} tool={t} onChanged={load} />
                    ))}
                  </ul>
                  {pre.provisions.length > 0 && (
                    <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">
                      ExpandedHub downloads{' '}
                      <span className="text-zinc-200">
                        {pre.provisions.map((p) => `${p.name} ${p.version}${p.size ? ` (${Math.round(p.size / 1048576)} MB)` : ''}`).join(', ')}
                      </span>{' '}
                      first, on the Downloads page; {pre.extra ? pre.extra.name : project.name} {pre.extra ? 'starts' : 'installs'} right after it. To use your own copy instead, browse to it above.
                    </p>
                  )}
                </Block>
              )}

              {needsConsent && (
                <Block title="Project scripts">
                  <p className="mb-3 text-[13px] leading-relaxed text-zinc-400">
                    This project {pre.extra ? 'makes it' : building ? 'builds' : 'installs'} with its own script, downloaded from{' '}
                    <span className="text-zinc-200">
                      {project.repository?.owner}/{project.repository?.name}
                    </span>
                    .{' '}
                    {pre.scripts.every((sc) => sc.kind === 'venv' || sc.progress !== 'none')
                      ? 'ExpandedHub runs it in the install folder in the background; its progress shows on the Downloads page. It may download the build tools it needs.'
                      : 'ExpandedHub runs it in the install folder; it may open its own setup window where you finish the installation.'}
                  </p>
                  <ul className="mb-3 flex flex-col gap-1.5">
                    {pre.scripts.map((s) => (
                      <li key={`${s.host ? 'host' : 'own'}-${s.step}`} className="rounded-lg bg-ink-800 px-3 py-2 text-[13px]">
                        <div className="text-zinc-300">
                          {s.label}
                          {s.optional && <span className="ml-2 text-[12px] text-zinc-500">optional — skipped if it fails</span>}
                        </div>
                        {s.kind !== 'venv' && <code className="selectable block truncate text-[12.5px] text-amber-200/90">
                          {s.command}
                          {s.args.length ? ` ${s.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}` : ''}
                        </code>}
                      </li>
                    ))}
                  </ul>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] p-3">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[#d81e34]" />
                    <span className="text-[13px] text-zinc-200">
                      <Lock size={13} className="mr-1 inline text-amber-300" />I trust this project and allow ExpandedHub to run{' '}
                      {pre.scripts.length === 1 ? 'this script' : 'these scripts'}.
                    </span>
                  </label>
                </Block>
              )}

              {(pre.blockers.length > 0 || pre.warnings.length > 0) && (
                <div className="flex flex-col gap-1.5">
                  {pre.blockers.map((b) => (
                    <Notice key={b} tone="block">
                      {b}
                    </Notice>
                  ))}
                  {pre.warnings.map((w) => (
                    <Notice key={w} tone="warn">
                      {w}
                    </Notice>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-line/[0.06] px-6 py-4">
          <div className="text-[12.5px] text-zinc-500">
            {validating ? 'Checking your files…' : pre?.blockers.length ? 'Resolve the items above to continue.' : needsConsent && !consent ? 'Allow the project script to continue.' : 'Ready.'}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant={isUpdate ? 'update' : 'primary'} disabled={!canStart} onClick={() => void start()} className="min-w-[140px]">
              {starting ? 'Starting…' : verb}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[14px] font-bold uppercase tracking-[0.16em] text-zinc-400">{title}</h3>
        {note && <span className="text-[12px] text-zinc-600">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function Notice({ tone, children }: { tone: 'block' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]',
        tone === 'block' ? 'bg-tekken-500/10 text-tekken-200' : 'bg-amber-400/[0.06] text-amber-100/90'
      )}
    >
      <AlertTriangle size={14} className={cx('mt-0.5 shrink-0', tone === 'block' ? 'text-tekken-400' : 'text-amber-300')} />
      <span>{children}</span>
    </div>
  )
}
