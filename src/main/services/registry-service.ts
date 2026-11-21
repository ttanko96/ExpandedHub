import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { GamesCatalog, ProjectDefinition } from '@shared/registry-schema'
import type { RegistryIssue, RegistrySnapshot } from '@shared/types'
import { log } from './logger'
import { paths } from './paths'

/**
 * Loads the curated project registry from `registry/`.
 *
 * - `registry/games.json`       — source games (ISOs / ROMs) projects can require
 * - `registry/projects/*.json`  — one file per supported project
 *
 * Files starting with `_` are ignored (templates, drafts). Invalid files are
 * reported as issues and skipped, never fatal.
 */
export class RegistryService {
  private snapshot: RegistrySnapshot | null = null

  async get(): Promise<RegistrySnapshot> {
    return this.snapshot ?? this.reload()
  }

  async reload(): Promise<RegistrySnapshot> {
    const root = paths.registry()
    const issues: RegistryIssue[] = []

    let games: RegistrySnapshot['games'] = []
    try {
      const parsed = GamesCatalog.safeParse(JSON.parse(await fs.readFile(join(root, 'games.json'), 'utf8')))
      if (parsed.success) games = parsed.data.games
      else issues.push({ file: 'games.json', message: formatZod(parsed.error) })
    } catch (err) {
      issues.push({ file: 'games.json', message: String(err) })
    }

    const projects: ProjectDefinition[] = []
    const projectsDir = join(root, 'projects')
    let files: string[] = []
    try {
      files = (await fs.readdir(projectsDir)).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    } catch (err) {
      issues.push({ file: 'projects/', message: String(err) })
    }

    const gameIds = new Set(games.map((g) => g.id))
    for (const file of files) {
      try {
        const parsed = ProjectDefinition.safeParse(JSON.parse(await fs.readFile(join(projectsDir, file), 'utf8')))
        if (!parsed.success) {
          issues.push({ file: `projects/${file}`, message: formatZod(parsed.error) })
          continue
        }
        const p = parsed.data
        if (projects.some((x) => x.id === p.id)) {
          issues.push({ file: `projects/${file}`, message: `Duplicate project id "${p.id}"` })
          continue
        }
        for (const s of p.install?.sources ?? []) {
          if (!gameIds.has(s.gameId)) {
            issues.push({ file: `projects/${file}`, message: `Unknown source game "${s.gameId}" (not in games.json)` })
          }
        }
        projects.push(p)
      } catch (err) {
        issues.push({ file: `projects/${file}`, message: String(err) })
      }
    }

    for (const p of projects) {
      for (const dep of p.install?.dependsOn ?? []) {
        if (!projects.some((x) => x.id === dep)) {
          issues.push({ file: `projects/${p.id}.json`, message: `Depends on unknown project "${dep}"` })
        }
      }
      for (const step of p.howToPlay) {
        if (step.project && !projects.some((x) => x.id === step.project)) {
          issues.push({ file: `projects/${p.id}.json`, message: `How to play links to unknown project "${step.project}"` })
        }
      }
    }

    projects.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    this.snapshot = { projects: projects.filter((p) => !p.hidden), games, issues }
    if (issues.length) log('warn', `Registry: ${issues.length} issue(s)`, issues)
    return this.snapshot
  }
}

function formatZod(err: { issues: { path: (string | number)[]; message: string }[] }): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}
