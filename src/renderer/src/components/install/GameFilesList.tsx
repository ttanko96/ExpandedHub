import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { SourceConfig } from '@shared/install'
import type { GameDefinition, ProjectDefinition } from '@shared/registry-schema'
import { sourceFit } from '@shared/source-fit'
import { cx } from '../../lib/format'
import { useHub } from '../../store/hub-store'
import { SourceRow } from './SourceRow'

/**
 * Every game the hub knows, with the file the user chose for it: the same list
 * in Settings → ISO Management and in the first-start window. Once a file is
 * chosen, the projects that use it are listed under it.
 */
export function GameFilesList() {
  const games = useHub((s) => s.games)
  const sources = useHub((s) => s.sources)
  const projects = useHub((s) => s.projects)
  return (
    <>
      {games.map((g) => (
        <SourceRow
          key={g.id}
          gameId={g.id}
          name={g.name}
          platform={g.platform}
          purpose={`${g.region ? `${g.region} · ` : ''}.${g.extensions.join(' .')}`}
          config={sources[g.id]}
          footer={<CompatibleProjects game={g} config={sources[g.id]} projects={projects} />}
        />
      ))}
    </>
  )
}

/** The projects a chosen game file works with, side by side: a tick where it works, a cross where not. */
function CompatibleProjects({ game, config, projects }: { game: GameDefinition; config: SourceConfig | undefined; projects: ProjectDefinition[] }) {
  const users = projects.flatMap((p) => {
    const req = p.install?.sources.find((s) => s.gameId === game.id)
    const fit = req && sourceFit(game, req, config)
    return req && fit ? [{ project: p, req, fit }] : []
  })
  if (users.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {users.map(({ project, req, fit }) => {
        const wrong = fit.kind === 'wrong-revision'
        const why = wrong ? `Reads only the ${fit.need.join(' or ')} revision${fit.have ? `; this file is ${fit.have}` : ''}` : req.purpose
        return (
          <span
            key={project.id}
            title={[why, req.required ? '' : 'optional'].filter(Boolean).join(' · ')}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-md border border-line/[0.08] px-2 py-1 text-[12px]',
              wrong ? 'text-zinc-500' : 'bg-ink-800 text-zinc-300'
            )}
          >
            {fit.kind === 'ok' && <CheckCircle2 size={13} className="text-emerald-400" />}
            {fit.kind === 'doubtful' && <AlertTriangle size={13} className="text-amber-300" />}
            {wrong && <XCircle size={13} className="text-zinc-500" />}
            <span className={cx(wrong && 'line-through decoration-zinc-600')}>{project.name}</span>
            {!req.required && <span className="text-[11px] text-zinc-500">optional</span>}
          </span>
        )
      })}
    </div>
  )
}
