import { ArrowLeft, Bug, CheckCircle2, FolderSearch, MessageSquarePlus, Sparkles, Star, ExternalLink, FileArchive, FolderOpen, GitCommit, Github, Hammer, Link2, Lock, Play, Square, Trash2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ExtraStatus, ProjectStorage, Screenshot, ToolStatus } from '@shared/install'
import { ScreenshotCarousel } from '../components/ui/ScreenshotCarousel'
import { isActive } from '@shared/operations'
import { ToolRow } from '../components/install/ToolRow'
import { Trailer } from '../components/ui/Trailer'
import { UninstallDialog } from '../components/install/UninstallDialog'
import { SourceRow } from '../components/install/SourceRow'
import { resolveDownload } from '@shared/assets'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { isInstallable, type InstallStep, type InstallStrategy } from '@shared/registry-schema'
import { projectActions } from '../components/mods/actions'
import { VersionLine } from '../components/mods/VersionLine'
import { Button } from '../components/ui/Button'
import { Label } from '../components/ui/Label'
import { ProjectTile } from '../components/ui/ProjectTile'
import { SimpleMarkdown } from '../components/ui/SimpleMarkdown'
import { ListingBadge, StatusBadge } from '../components/ui/StatusBadge'
import { cx, formatBytes, relativeTime, shortDate } from '../lib/format'
import { STATUS_META } from '../lib/status-meta'
import { versionLabel } from '@shared/status'
import { useHub } from '../store/hub-store'

const STRATEGY_TEXT: Record<InstallStrategy, string> = {
  'release-asset': 'Ready-to-use release package',
  'source-build': 'Built from source on your machine',
  script: "Runs the project's own setup script"
}

function stepText(step: InstallStep): string {
  switch (step.type) {
    case 'download':
      return step.from === 'source' ? 'Download release source code' : 'Download release package'
    case 'extract':
      return 'Extract files'
    case 'checkTools':
      return 'Check required tools'
    case 'checkSources':
      return 'Check your game files'
    case 'run':
      return step.label
    case 'locateOutput':
      return 'Locate build output'
    case 'buildHost':
      return 'Build the host game again with it'
    case 'pythonVenv':
      return `Prepare a Python ${step.minVersion}–${step.maxVersion} environment`
    case 'finalize':
      return 'Finalize installation'
  }
}

export function ModDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { projects, states, games, appInfo, sources, operations, running: runningIds } = useHub()
  const project = projects.find((p) => p.id === id)
  const state = id ? states[id] : undefined
  const running = id ? runningIds.includes(id) : false
  const [storage, setStorage] = useState<ProjectStorage | null>(null)
  const [removing, setRemoving] = useState(false)
  const loadStorage = useCallback(() => {
    if (id) window.hub.install.storage(id).then(setStorage, () => setStorage(null))
  }, [id])
  // Sizes change after installs, builds and uninstalls.
  useEffect(loadStorage, [loadStorage, state?.installed?.installedAt, state?.status])
  // Tool status (found, or the folder the user chose) comes with the install checks.
  const [toolStatus, setToolStatus] = useState<ToolStatus[] | null>(null)
  const loadTools = useCallback(() => {
    if (!id) return
    window.hub.install.preflight(id).then((p) => setToolStatus(p.tools), () => setToolStatus(null))
  }, [id])
  useEffect(loadTools, [loadTools, states])
  // Which extras (DriftEngine's remaster) have been made; checked again when an operation of this project ends.
  const [extras, setExtras] = useState<ExtraStatus[]>([])
  const busyOp = operations.find((o) => o.projectId === id && isActive(o))
  const opsDone = operations.filter((o) => o.projectId === id && !isActive(o)).length
  const hasExtras = (extrasOf(projects, id)?.length ?? 0) > 0
  useEffect(() => {
    if (!id || !hasExtras || !states[id]?.installed) return setExtras([])
    window.hub.install.extras(id).then(setExtras, () => setExtras([]))
  }, [id, hasExtras, states, opsDone])

  // Screenshots the installation ships (TMST's `screenshots` folder), read again after each install or update.
  const [shots, setShots] = useState<Screenshot[]>([])
  const hasShots = Boolean(projects.find((p) => p.id === id)?.install?.screenshots)
  const installedAt = id ? states[id]?.installed?.installedAt : undefined
  const installedVersion = id ? states[id]?.installed?.version : undefined
  useEffect(() => {
    if (!id || !hasShots || !installedAt) return setShots([])
    window.hub.install.screenshots(id).then(setShots, () => setShots([]))
  }, [id, hasShots, installedAt, installedVersion, opsDone])

  if (!project) {
    return (
      <div className="px-8 py-16 text-center text-zinc-500">
        Project not found. <Link to="/mods" className="text-tekken-400 hover:underline">Back to mods</Link>
      </div>
    )
  }

  const status = state?.status ?? 'not-installed'
  const plan = resolveDownload(project, state?.latest ?? null, appInfo?.platform ?? 'win32')
  const meta = STATUS_META[status]
  const gameName = (gid: string) => games.find((g) => g.id === gid)
  const installable = isInstallable(project)
  const install = project.install
  const hasBuild = install?.steps.some((st) => st.type === 'run' || st.type === 'pythonVenv' || st.type === 'buildHost') ?? false
  const deps = (install?.dependsOn ?? []).map((d) => ({ id: d, project: projects.find((p) => p.id === d), state: states[d] }))

  return (
    <div className="animate-fade-up">
      {/* Hero */}
      <section
        className="relative overflow-hidden border-b border-line/[0.06]"
        style={{
          background: `radial-gradient(60% 140% at 0% 0%, ${project.artwork.accent}26 0%, transparent 60%), linear-gradient(180deg, var(--color-ink-850), var(--color-ink-900))`
        }}
      >
        <div className="mx-auto max-w-[1280px] px-8 pb-8 pt-6">
          <button
            onClick={() => navigate('/mods')}
            className="mb-6 inline-flex items-center gap-2 font-display text-[14px] font-bold uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-200"
          >
            <ArrowLeft size={16} /> Mods
          </button>
          <div className="flex items-start gap-7">
            <ProjectTile project={project} size="lg" />
            <div className="min-w-0 flex-1">
              {project.comingSoon ? (
                <ListingBadge kind="coming-soon" accent={project.artwork.accent} />
              ) : installable ? (
                <StatusBadge status={status} />
              ) : (
                <ListingBadge kind="manual" />
              )}
              <h1 className="mt-3 font-display text-[44px] font-bold uppercase italic leading-none tracking-[0.02em] text-fg">
                {project.name}
              </h1>
              {project.tagline && <p className="mt-2 text-[16px] text-zinc-400">{project.tagline}</p>}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {project.labels.map((l) => (
                  <Label key={l.text} kind={l.kind} text={l.text} hint={l.hint} />
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-3">
              <VersionLine state={state} />
              <div className="flex gap-2">
                {project.repository && (
                  <Button variant="secondary" icon={<Github size={16} />} onClick={() => void projectActions.openRepo(project)}>
                    Repository
                  </Button>
                )}
                {installable && !project.install?.installInto && (state?.installed?.executable || (state?.installed && (project.install?.output.serve || project.install?.output.launch))) &&
                  (running ? (
                    <>
                      <Button variant="secondary" icon={<ExternalLink size={16} />} title="Open the running game in the browser again" onClick={() => void projectActions.launch(project)}>
                        Open
                      </Button>
                      <Button
                        variant="secondary"
                        icon={<Square size={14} />}
                        title="The game's server is running. Stop it (closing the hub stops it too)."
                        onClick={() => void projectActions.stop(project)}
                      >
                        Stop
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" icon={<Play size={16} />} onClick={() => void projectActions.launch(project)}>
                      Play
                    </Button>
                  ))}
                {installable && meta.action && (
                  <Button
                    variant={status === 'update-available' ? 'update' : 'primary'}
                    className="min-w-[140px]"
                    onClick={() => projectActions.primary(project)}
                  >
                    {meta.action}
                  </Button>
                )}
              </div>
              {installable && !state?.installed && (
                <Button size="sm" variant="ghost" icon={<FolderSearch size={14} />} onClick={() => void projectActions.adopt(project)}
                  title="Already have it on your PC? Choose its folder: the hub works from there and tells you when an update is out.">
                  {project.install?.installInto ? 'Already installed? Find it' : 'Already installed? Browse…'}
                </Button>
              )}
              {state?.installed && (
                <div className="flex gap-2">
                  {installable && hasBuild && (
                    <Button size="sm" variant="secondary" icon={<Hammer size={14} />} onClick={() => projectActions.openBuild(project)}>
                      Build again
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setRemoving(true)} className="hover:text-tekken-400">
                    Uninstall
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1280px] grid-cols-[1fr_380px] gap-6 px-8 py-8">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="About">
            <p className="selectable text-[15px] leading-relaxed text-zinc-300">{project.description}</p>
            {project.trailer && <Trailer trailer={project.trailer} accent={project.artwork.accent} className="mt-5 max-w-[560px]" />}
          </Panel>

          {shots.length > 0 && (
            <Panel
              title={install?.screenshots?.title ?? 'Photo Gallery'}
              action={<span className="text-[13px] text-zinc-500">{shots.length} {shots.length === 1 ? 'picture' : 'pictures'}</span>}
            >
              <ScreenshotCarousel shots={shots} accent={project.artwork.accent} />
            </Panel>
          )}

          {installable && state?.installed && (install?.extras.length ?? 0) > 0 && (
            <Panel title="Extras">
              <div className="flex flex-col gap-3">
                {install!.extras.map((x) => {
                  const done = extras.find((e) => e.id === x.id)?.done ?? false
                  const making = busyOp?.extraId === x.id
                  return (
                    <div key={x.id} className="rounded-xl border border-line/[0.06] bg-ink-800/60 p-4">
                      <div className="flex items-start gap-3">
                        <Sparkles size={18} className={cx('mt-0.5 shrink-0', done ? 'text-emerald-400' : 'text-amber-300')} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="font-display text-[17px] font-bold uppercase tracking-wide text-fg">{x.name}</span>
                            <span className={cx('text-[12px] font-medium', done ? 'text-emerald-400' : making ? 'text-amber-300' : 'text-zinc-500')}>
                              {making ? 'being made…' : done ? 'made' : 'not made yet'}
                            </span>
                          </div>
                          <p className="selectable mt-1 text-[13.5px] leading-relaxed text-zinc-400">{x.description}</p>
                          {done && x.doneNote && <p className="mt-2 text-[13px] text-emerald-300/90">{x.doneNote}</p>}
                          {x.needs.length > 0 && !done && (
                            <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-5 text-[12.5px] text-zinc-500 marker:text-zinc-700">
                              {x.needs.map((n) => (
                                <li key={n}>{n}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant={done ? 'secondary' : 'primary'}
                          disabled={Boolean(busyOp)}
                          title={busyOp ? 'Another operation of this project is running (see the Downloads page).' : undefined}
                          onClick={() => projectActions.openExtra(project, x.id)}
                        >
                          {making ? 'Running…' : done ? 'Make again' : 'Make it'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}

          <Panel
            title={state?.latest ? `Latest release · ${state.latest.name}` : 'Latest release'}
            action={
              state?.latest && (
                <button
                  onClick={() => void projectActions.openRelease(project, state)}
                  className="inline-flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-fg"
                >
                  View on GitHub <ExternalLink size={13} />
                </button>
              )
            }
          >
            {state?.latest ? (
              <>
                <div className="mb-3 flex items-center gap-2 text-[13px] text-zinc-500">
                  {state.latest.prerelease && <Label kind="platform" text="Pre-release" />}
                  Published {shortDate(state.latest.publishedAt)} · tag {state.latest.tag}
                </div>
                <div className="max-h-[420px] overflow-y-auto pr-2">
                  <SimpleMarkdown source={state.latest.notes || 'No release notes.'} />
                </div>
                {state.latest.assets.length > 0 && (
                  <div className="mt-5 border-t border-line/[0.05] pt-4">
                    <div className="mb-2 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-zinc-500">Files</div>
                    <ul className="flex flex-col gap-1">
                      {state.latest.assets.map((a) => {
                        const mine = plan.asset?.name === a.name
                        return (
                          <li
                            key={a.name}
                            className={cx(
                              'flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px]',
                              mine ? 'bg-emerald-500/10 text-emerald-200' : 'text-zinc-400'
                            )}
                          >
                            <FileArchive size={15} className={mine ? 'text-emerald-400' : 'text-zinc-600'} />
                            <span className="selectable min-w-0 flex-1 truncate">{a.name}</span>
                            {mine && <span className="font-display text-[12px] font-bold uppercase tracking-wider">For your system</span>}
                            {plan.checksum?.name === a.name && <span className="text-[12px] text-zinc-500">checksums</span>}
                            <span className="w-16 text-right text-[12px] text-zinc-500">{formatBytes(a.size)}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                {plan.problem && <div className="mt-3 text-[13px] text-amber-300">{plan.problem}</div>}
              </>
            ) : state?.latestCommit ? (
              <div className="text-[14px] text-zinc-400">
                This repository has no releases yet. Latest commit:
                <button
                  onClick={() => void window.hub.app.openExternal(state.latestCommit!.htmlUrl)}
                  className="mt-3 flex w-full items-center gap-3 rounded-lg bg-ink-800 px-3 py-2.5 text-left hover:bg-ink-700"
                >
                  <GitCommit size={16} className="shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{state.latestCommit.message}</span>
                  <span className="shrink-0 text-[12px] text-zinc-500">
                    {state.latestCommit.author} · {relativeTime(state.latestCommit.date)} · {state.latestCommit.sha.slice(0, 7)}
                  </span>
                </button>
              </div>
            ) : (
              <div className="text-[14px] text-zinc-500">
                {state?.error ?? 'No release information yet. Try refreshing on the Mods page.'}
              </div>
            )}
          </Panel>

          {project.howToPlay.length > 0 ? (
          <Panel title="How to play">
            <ol className="flex flex-col">
              {project.howToPlay.map((s, i) => {
                const linked = s.project && s.project !== project.id ? projects.find((p) => p.id === s.project) : undefined
                return (
                  <li key={i} className="flex gap-3.5 border-b border-line/[0.04] py-3 last:border-none">
                    <span
                      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full font-display text-[14px] font-bold text-fg"
                      style={{ background: `${project.artwork.accent}33`, boxShadow: `inset 0 0 0 1px ${project.artwork.accent}66` }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-[15px] font-semibold text-zinc-100">{s.title}</span>
                        {linked && (
                          <Link
                            to={`/mods/${linked.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-line/[0.1] px-2 py-0.5 text-[12px] text-zinc-300 hover:border-line/25 hover:text-fg"
                          >
                            Open {linked.name} →
                          </Link>
                        )}
                      </div>
                      {s.detail && <p className="mt-1 text-[13.5px] leading-snug text-zinc-400">{s.detail}</p>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Panel>
          ) : install ? (
          <Panel title="Installation procedure" action={<span className="text-[13px] text-zinc-500">{STRATEGY_TEXT[install.strategy]}</span>}>
            <ol className="flex flex-col">
              {install.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-3 border-b border-line/[0.04] py-2.5 last:border-none">
                  <span className="flex size-6 items-center justify-center rounded-full bg-ink-700 font-display text-[13px] font-bold text-zinc-400">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-[14px] text-zinc-300">{stepText(s)}</span>
                  {(s.type === 'run' || s.type === 'pythonVenv' || s.type === 'buildHost') && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-amber-300/80" title="Repository scripts never run without your explicit consent">
                      <Lock size={12} /> asks first
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
          ) : (
            <Panel title="Installation">
              <p className="text-[14px] leading-relaxed text-zinc-400">
                {project.comingSoon
                  ? 'Not released yet.'
                  : "ExpandedHub can't install this project yet: it is built on your machine from your own game files. Follow the build steps in the project's README."}
              </p>
              {project.repository && (
                <Button className="mt-4" size="sm" variant="secondary" icon={<Github size={14} />} onClick={() => void projectActions.openRepo(project)}>
                  Open README on GitHub
                </Button>
              )}
            </Panel>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          {state?.installed && (
            <Panel title="Installation">
              <div className="text-[13.5px] text-zinc-300">
                {versionLabel(state.installed)} · {state.installed.adopted ? 'linked' : 'installed'} {shortDate(state.installed.installedAt)}
              </div>
              {state.installed.adopted && (
                <div className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug text-zinc-500">
                  <Link2 size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Your own installation: the hub plays and updates it in this folder, and Uninstall never deletes it.
                    {state.installed.versionSource === 'unknown' && ' Its version could not be told, so the latest release is offered as an update.'}
                    {state.installed.versionSource === 'git' && ' Version read from its git checkout; Check for updates reads it again.'}
                  </span>
                </div>
              )}
              <code className="selectable mt-1 block truncate text-[12px] text-zinc-500" title={state.installed.installPath}>
                {state.installed.installPath}
              </code>
              {project.install?.installInto ? (
                <div className="mt-2 text-[12.5px] text-zinc-500">
                  Part of{' '}
                  <Link to={`/mods/${project.install.installInto.project}`} className="text-zinc-300 hover:underline">
                    {projects.find((p) => p.id === project.install!.installInto!.project)?.name ?? project.install.installInto.project}
                  </Link>
                  : play it from there. Its folder follows that installation's: to use another one, choose Change folder on{' '}
                  {projects.find((p) => p.id === project.install!.installInto!.project)?.name ?? project.install.installInto.project}, and{' '}
                  {project.name} is found in its {project.install.installInto.subdir} folder.
                </div>
              ) : (
                !state.installed.executable && !project.install?.output.serve && !project.install?.output.launch && (
                  <div className="mt-2 text-[12.5px] text-zinc-500">Launched through the project's own setup window.</div>
                )
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void window.hub.app.openPath(state.installed!.installPath).catch(() => {})}>
                  Open folder
                </Button>
                {state.installed.adopted && !project.install?.installInto && (
                  <Button size="sm" variant="secondary" icon={<FolderSearch size={14} />} onClick={() => void projectActions.adopt(project)} title="Point the hub at another folder, or read this one's version again">
                    Change folder
                  </Button>
                )}
                {state.installed.adopted && project.install?.installInto && (
                  <Button size="sm" variant="secondary" icon={<FolderSearch size={14} />} onClick={() => void projectActions.adopt(project)}
                    title={`Look for it again in ${projects.find((p) => p.id === project.install!.installInto!.project)?.name ?? 'its host'}'s ${project.install.installInto.subdir} folder and read its version`}>
                    Find it again
                  </Button>
                )}
              </div>
            </Panel>
          )}

          {project.repository && (
            <Panel title="Like this project?">
              <div className="flex items-center gap-3">
                <Star size={26} className="fill-amber-400/80 text-amber-400" />
                <div>
                  <div className="font-display text-[26px] font-bold leading-none text-fg">
                    {state?.stars != null ? state.stars.toLocaleString() : '—'}
                  </div>
                  <div className="mt-1 text-[12.5px] text-zinc-500">
                    {state?.stars != null ? 'people starred it on GitHub' : 'Stars show up after the next update check'}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[13.5px] leading-snug text-zinc-400">
                Give it a star on GitHub so others see it is liked, or tell its developer what you think.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Star size={14} />} onClick={() => void projectActions.openRepo(project)}>
                  Star on GitHub
                </Button>
                <Button size="sm" variant="secondary" icon={<MessageSquarePlus size={14} />} onClick={() => void projectActions.giveFeedback(project)}>
                  Give feedback
                </Button>
              </div>
            </Panel>
          )}

          {project.repository && (
            <Panel title="Encountered an issue?">
              <p className="text-[13.5px] leading-snug text-zinc-400">
                Something not working with {project.name}? Check the known issues or open a ticket for its developer on GitHub.
              </p>
              <Button className="mt-4" size="sm" variant="secondary" icon={<Bug size={14} />} onClick={() => void projectActions.openIssues(project)}>
                Raise a ticket on GitHub
              </Button>
            </Panel>
          )}

          {install && (
          <Panel title="Your game files">
            {install.sources.length === 0 ? (
              <div className="text-[14px] text-zinc-500">No game files needed.</div>
            ) : (
              <div className="-my-2 divide-y divide-line/[0.04]">
                {install.sources.map((s) => {
                  const g = gameName(s.gameId)
                  return (
                    <SourceRow
                      key={s.gameId}
                      gameId={s.gameId}
                      name={g?.name ?? s.gameId}
                      platform={g?.platform ?? ''}
                      required={s.required}
                      purpose={s.purpose}
                      config={sources[s.gameId]}
                      compact
                    />
                  )
                })}
              </div>
            )}
            <div className="mt-4 rounded-lg bg-ink-800 p-3 text-[12.5px] leading-snug text-zinc-500">
              ExpandedHub never downloads games, BIOS files or game assets. You select your own legally obtained files once;
              every project reuses them.
            </div>
          </Panel>
          )}

          {!state?.installed && storage && storage.downloads.bytes > 0 && (
            <Panel title="Downloaded package">
              <div className="text-[13.5px] text-zinc-300">{formatBytes(storage.downloads.bytes)} kept for reinstalling</div>
              <code className="selectable mt-1 block truncate text-[12px] text-zinc-500" title={storage.downloads.path}>
                {storage.downloads.path}
              </code>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setRemoving(true)} className="mt-3 hover:text-tekken-400">
                Delete download
              </Button>
            </Panel>
          )}

          {((install?.tools.length ?? 0) > 0 || deps.length > 0) && (
            <Panel title="Tools & dependencies">
              <ul className="flex flex-col gap-2.5">
                {deps.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 text-[14px]">
                    {d.state?.installed ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : (
                      <Link2 size={16} className="text-amber-300" />
                    )}
                    <Link to={`/mods/${d.id}`} className="text-zinc-200 hover:text-fg hover:underline">
                      {d.project?.name ?? d.id}
                    </Link>
                    <span className="ml-auto text-[12px] text-zinc-500">{d.state?.installed ? 'installed' : 'required first'}</span>
                  </li>
                ))}
                {toolStatus
                  ? toolStatus.map((t) => <ToolRow key={t.id} tool={t} onChanged={loadTools} />)
                  : (install?.tools ?? []).map((t) => (
                      <li key={t.id} className="flex items-center gap-3 text-[14px]">
                        <Wrench size={16} className={t.optional ? 'text-zinc-600' : 'text-amber-300'} />
                        <span className="text-zinc-200">{t.name}</span>
                        <span className="ml-auto text-[12px] text-zinc-500">{t.optional ? 'optional' : 'required'}</span>
                      </li>
                    ))}
              </ul>
            </Panel>
          )}

          <Panel title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
              <Dt>Developer</Dt>
              <Dd>{project.developer.name}</Dd>
              <Dt>Repository</Dt>
              <Dd>
                {project.repository ? `${project.repository.owner}/${project.repository.name}` : '—'}
              </Dd>
              <Dt>Latest</Dt>
              <Dd>{state?.latest ? `v${state.latest.version}` : '—'}</Dd>
              <Dt>Last update</Dt>
              <Dd>{shortDate(state?.latest?.publishedAt)}</Dd>
              <Dt>Installed</Dt>
              <Dd>{state?.installed ? `${versionLabel(state.installed)} · ${shortDate(state.installed.installedAt)}` : '—'}</Dd>
              <Dt>Checked</Dt>
              <Dd>{relativeTime(state?.checkedAt)}</Dd>
              <Dt>Platforms</Dt>
              <Dd>{install ? install.supportedPlatforms.map((p) => ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[p]).join(', ') : '—'}</Dd>
            </dl>
          </Panel>
        </aside>
      </div>
      {removing && storage && (
        <UninstallDialog
          project={project}
          storage={storage}
          onClose={() => setRemoving(false)}
          onDone={() => {
            setRemoving(false)
            loadStorage()
          }}
        />
      )}
    </div>
  )
}

function extrasOf(projects: { id: string; install?: { extras: unknown[] } }[], id: string | undefined) {
  return projects.find((p) => p.id === id)?.install?.extras
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line/[0.06] bg-ink-850 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-display text-[15px] font-bold uppercase tracking-[0.16em] text-zinc-300">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

const Dt = ({ children }: { children: ReactNode }) => <dt className="text-zinc-500">{children}</dt>
const Dd = ({ children }: { children: ReactNode }) => <dd className="selectable truncate text-zinc-200">{children}</dd>
