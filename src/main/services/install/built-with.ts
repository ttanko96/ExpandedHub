import type { SourceConfig } from '@shared/install'
import { isInstallable, type GameDefinition, type ProjectDefinition } from '@shared/registry-schema'
import type { BuiltWith, InstalledRecord } from '@shared/types'

/** Projects whose installation is built on the user's machine (and so can be built again). */
export function isBuilt(project: ProjectDefinition): boolean {
  return project.install?.steps.some((s) => s.type === 'run' || s.type === 'pythonVenv' || s.type === 'buildHost') ?? false
}

/**
 * What a build of `project` uses right now: the game files it takes (path and
 * size, so a replaced file counts) and, for a host, the add-ons inside it.
 * Null for projects that are not built.
 */
export function builtWith(
  project: ProjectDefinition,
  projects: ProjectDefinition[],
  installed: Record<string, InstalledRecord>,
  sources: SourceConfig[]
): BuiltWith | null {
  if (!isInstallable(project) || !isBuilt(project)) return null
  const configured = new Map(sources.map((s) => [s.gameId, s]))
  const files: Record<string, string> = {}
  for (const s of project.install.sources) {
    const c = configured.get(s.gameId)
    if (c) files[s.gameId] = `${c.path}|${c.size}`
  }
  const addons: Record<string, string> = {}
  for (const p of projects) {
    if (p.install?.installInto?.project === project.id && installed[p.id]) addons[p.id] = installed[p.id]!.version
  }
  return { sources: files, addons }
}

/**
 * Why the installation should be built again: what changed since its last
 * build. Empty when nothing did, or when the hub does not know what it was
 * built with (linked, or built by an older hub).
 */
export function rebuildReasons(
  then: BuiltWith | undefined,
  now: BuiltWith | null,
  projects: ProjectDefinition[],
  games: GameDefinition[]
): string[] {
  if (!then || !now) return []
  const project = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  const game = (id: string) => games.find((g) => g.id === id)?.name ?? id
  const reasons: string[] = []
  for (const [id, version] of Object.entries(now.addons)) {
    if (!(id in then.addons)) reasons.push(`${project(id)} was added`)
    else if (then.addons[id] !== version) reasons.push(`${project(id)} is a new version`)
  }
  for (const id of Object.keys(then.addons)) if (!(id in now.addons)) reasons.push(`${project(id)} was removed`)
  for (const [id, file] of Object.entries(now.sources)) {
    if (!(id in then.sources)) reasons.push(`${game(id)} was added`)
    else if (then.sources[id] !== file) reasons.push(`${game(id)} was changed`)
  }
  for (const id of Object.keys(then.sources)) if (!(id in now.sources)) reasons.push(`${game(id)} was removed`)
  return reasons
}
