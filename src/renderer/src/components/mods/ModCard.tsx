import { Bug, CheckCircle2, ExternalLink, FolderSearch, Github, Hammer, Link2, Square, Star, Tag } from 'lucide-react'
import { isActive } from '@shared/operations'
import { useHub } from '../../store/hub-store'
import { percent, ProgressBar, transferLine } from '../downloads/progress'
import { useNavigate } from 'react-router-dom'
import { hostProjectId, isInstallable, type ProjectDefinition } from '@shared/registry-schema'
import type { ProjectState } from '@shared/types'
import { cx, formatCount, relativeTime, shortDate } from '../../lib/format'
import { STATUS_META } from '../../lib/status-meta'
import { Button, IconButton } from '../ui/Button'
import { Label } from '../ui/Label'
import { ProjectTile } from '../ui/ProjectTile'
import { ListingBadge, StatusBadge } from '../ui/StatusBadge'
import { Trailer } from '../ui/Trailer'
import { projectActions } from './actions'
import { VersionLine } from './VersionLine'

export function ModCard({
  project,
  state,
  index,
  addon = false
}: {
  project: ProjectDefinition
  state?: ProjectState
  index: number
  /** Rendered nested under its host project. */
  addon?: boolean
}) {
  if (project.comingSoon) return <ComingSoonCard project={project} index={index} />
  return <ReleasedCard project={project} state={state} index={index} addon={addon} />
}

function ReleasedCard({ project, state, index, addon }: { project: ProjectDefinition; state?: ProjectState; index: number; addon: boolean }) {
  const navigate = useNavigate()
  const installable = isInstallable(project)
  // Add-ons are played through their host: no Play here, just a tick once installed.
  const hostId = hostProjectId(project)
  const host = useHub((s) => (hostId ? s.projects.find((p) => p.id === hostId) : undefined))
  const status = state?.status ?? 'not-installed'
  const meta = STATUS_META[status]
  const hasUpdate = status === 'update-available'
  const op = useHub((s) => s.operations.find((o) => o.projectId === project.id))
  const running = useHub((s) => s.running.includes(project.id))
  const activeOp = op && isActive(op) ? op : null

  return (
    <article
      onClick={() => navigate(`/mods/${project.id}`)}
      style={{ animationDelay: `${index * 50}ms` }}
      className={cx(
        'group relative grid cursor-pointer grid-cols-[auto_1fr_auto] gap-6 overflow-hidden rounded-2xl border p-5 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px',
        addon && 'p-4',
        hasUpdate ? 'update-card' : 'animate-fade-up border-line/[0.06] bg-ink-850 hover:border-line/[0.12] hover:bg-ink-800'
      )}
    >
      {/* accent line on the left edge */}
      <span
        className={cx(
          'absolute inset-y-5 left-0 w-[3px] rounded-r-full transition-opacity',
          hasUpdate ? 'opacity-100 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'opacity-0 group-hover:opacity-100'
        )}
        style={{ background: hasUpdate ? '#34d399' : project.artwork.accent }}
      />

      <ProjectTile project={project} size={addon ? 'sm' : 'md'} />

      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <h2 className="truncate font-display text-[24px] font-bold uppercase leading-none tracking-[0.03em] text-fg">
            {project.name}
          </h2>
          {hasUpdate && <Label kind="update" text="Update" />}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[13px] text-zinc-500">
          <span>
            by <span className="text-zinc-300">{project.developer.name}</span>
          </span>
          {project.repository && <span className="text-ink-500">•</span>}
          {project.repository && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void projectActions.openRepo(project)
            }}
            className="inline-flex items-center gap-1 hover:text-zinc-200"
          >
            <Github size={13} />
            {project.repository.owner}/{project.repository.name}
          </button>
          )}
          {project.repository && <span className="text-ink-500">•</span>}
          {project.repository && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void projectActions.openIssues(project)
              }}
              className="inline-flex items-center gap-1 hover:text-zinc-200"
              title="Report a problem or see known issues on GitHub"
            >
              <Bug size={13} />
              Issues
            </button>
          )}
          {project.repository && state?.stars != null && (
            <>
              <span className="text-ink-500">•</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void projectActions.openRepo(project)
                }}
                className="inline-flex items-center gap-1 hover:text-amber-200"
                title={`${state.stars.toLocaleString()} people starred it on GitHub. Like it? Star it there.`}
              >
                <Star size={13} className="fill-amber-400/80 text-amber-400" />
                <span className="text-zinc-300">{formatCount(state.stars)}</span>
              </button>
            </>
          )}
        </div>
        <p className="mt-3 line-clamp-2 max-w-3xl text-[14px] leading-relaxed text-zinc-400">{project.description}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {project.labels.map((l) => (
            <Label key={l.text} kind={l.kind} text={l.text} hint={l.hint} />
          ))}
        </div>
      </div>

      <div className="flex w-[260px] flex-col items-end justify-between gap-4 border-l border-line/[0.05] pl-6">
        <div className="flex flex-col items-end gap-2">
          {installable ? <StatusBadge status={status} /> : <ListingBadge kind="manual" />}
          <VersionLine state={state} />
          <div className="flex items-center gap-1.5 text-[12px] text-zinc-500">
            <Tag size={12} />
            {state?.latest
              ? `Released ${shortDate(state.latest.publishedAt)}`
              : state?.latestCommit
                ? `Last commit ${relativeTime(state.latestCommit.date)}`
                : 'No release yet'}
          </div>
          {state?.installed?.adopted && (
            <div className="flex items-center gap-1.5 text-[12px] text-zinc-500" title={`Your own installation in ${state.installed.installPath}. The hub updates it in place and never deletes it.`}>
              <Link2 size={12} />
              Linked folder
            </div>
          )}
          {!activeOp && installable && state?.installed && (state.rebuild?.length ?? 0) > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                projectActions.openBuild(project)
              }}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-300 transition-colors hover:text-amber-200"
              title={`${state.rebuild.join('. ')}. Build again to bring the changes into the game.`}
            >
              <Hammer size={12} />
              Build again needed
            </button>
          )}
          {state?.error && (
            <div className="max-w-full truncate text-[12px] text-tekken-400" title={state.error}>
              {state.checkedAt ? `Check failed · data from ${relativeTime(state.checkedAt)}` : 'Check failed'}
            </div>
          )}
        </div>
        {activeOp ? (
          <div className="w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-right text-[12px] leading-snug">
              <div className="truncate text-zinc-300">{activeOp.message}</div>
              <div className="truncate text-zinc-500">{[percent(activeOp) !== null ? `${percent(activeOp)}%` : '', transferLine(activeOp)].filter(Boolean).join(' · ') ||' '}</div>
            </div>
            <ProgressBar op={activeOp} thin />
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => navigate('/downloads')}>
              View in Downloads
            </Button>
          </div>
        ) : (
        <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <IconButton label="Open release page" onClick={() => void projectActions.openRelease(project, state)}>
            <ExternalLink size={16} />
          </IconButton>
          {!installable ? (
            <Button variant="secondary" className="min-w-[132px]" icon={<Github size={15} />} onClick={() => void projectActions.openRepo(project)}>
              GitHub
            </Button>
          ) : meta.action ? (
            <Button
              variant={hasUpdate ? 'update' : 'primary'}
              className="min-w-[132px]"
              onClick={() => projectActions.primary(project)}
            >
              {meta.action}
            </Button>
          ) : hostId && state?.installed ? (
            <span
              className="inline-flex h-10 min-w-[132px] items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 font-display text-[14px] font-bold uppercase tracking-[0.1em] text-emerald-300"
              title={`Installed. Play it from ${host?.name ?? 'its host game'}.`}
            >
              <CheckCircle2 size={16} />
              Installed
            </span>
          ) : (state?.installed?.executable || (state?.installed && (project.install?.output.serve || project.install?.output.launch))) ? null : (
            <Button variant="secondary" className="min-w-[132px]" onClick={() => navigate(`/mods/${project.id}`)}>
              Manage
            </Button>
          )}
          {installable && !hostId && !meta.action && (state?.installed?.executable || (state?.installed && (project.install?.output.serve || project.install?.output.launch))) &&
            (running ? (
              <Button
                variant="secondary"
                className="min-w-[132px]"
                icon={<Square size={14} />}
                title="The game's server is running. Stop it (closing the hub stops it too)."
                onClick={() => void projectActions.stop(project)}
              >
                Stop
              </Button>
            ) : (
              <Button variant="primary" className="min-w-[132px]" onClick={() => void projectActions.launch(project)}>
                Play
              </Button>
            ))}
        </div>
        {installable && !state?.installed && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void projectActions.adopt(project)
            }}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500 transition-colors hover:text-zinc-200"
            title={
              hostId
                ? `Look for it inside ${host?.name ?? 'its host game'}'s installation`
                : 'Already have it on your PC? Choose its folder: the hub works from there and tells you when an update is out.'
            }
          >
            <FolderSearch size={13} />
            {hostId ? 'Already installed? Find it' : 'Already installed? Browse…'}
          </button>
        )}
        </div>
        )}
      </div>
    </article>
  )
}

/** Announced project: no repository, no release checks, nothing to install yet. */
function ComingSoonCard({ project, index }: { project: ProjectDefinition; index: number }) {
  const accent = project.artwork.accent
  return (
    <article
      style={{
        animationDelay: `${index * 50}ms`,
        borderColor: `${accent}40`,
        background: `radial-gradient(70% 160% at 0% 0%, ${accent}1a 0%, transparent 55%), var(--color-ink-850)`
      }}
      className="relative grid animate-fade-up grid-cols-[auto_1fr_auto] items-center gap-6 overflow-hidden rounded-2xl border p-5"
    >
      <span className="absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ background: accent }} />
      <ProjectTile project={project} />
      <div className="min-w-0">
        <h2
          className="truncate font-display text-[24px] font-bold uppercase leading-none tracking-[0.03em]"
          style={{ color: accent }}
        >
          {project.name}
        </h2>
        <div className="mt-1.5 text-[13px] text-zinc-500">
          by <span className="text-zinc-300">{project.developer.name}</span>
        </div>
        {project.description && (
          <p className="mt-3 line-clamp-2 max-w-3xl text-[14px] leading-relaxed text-zinc-400">{project.description}</p>
        )}
        {project.labels.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {project.labels.map((l) => (
              <Label key={l.text} kind={l.kind} text={l.text} hint={l.hint} />
            ))}
          </div>
        )}
      </div>
      <div className="flex w-[260px] flex-col items-end gap-3 border-l border-line/[0.05] pl-6">
        {project.trailer && <Trailer trailer={project.trailer} accent={accent} />}
        <ListingBadge kind="coming-soon" accent={accent} />
      </div>
    </article>
  )
}
