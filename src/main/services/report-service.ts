import { promises as fs } from 'node:fs'
import { homedir, release, userInfo } from 'node:os'
import { join } from 'node:path'
import type { SourceConfig } from '@shared/install'
import type { Operation } from '@shared/operations'
import { isInstallable } from '@shared/registry-schema'
import { versionLabel } from '@shared/status'
import type { IssueReport, ProjectState } from '@shared/types'
import type { RegistryService } from './registry-service'

/** Log lines put in a report: the end of the project's last operation log. */
const LOG_LINES = 40
/** GitHub refuses longer new-issue links; the body is kept under this (before encoding). */
export const MAX_BODY = 5000

interface Deps {
  registry: Pick<RegistryService, 'get'>
  states: () => Promise<ProjectState[]>
  sources: () => Promise<SourceConfig[]>
  operations: () => Operation[]
  hubVersion: string
  logsDir: string
  platform?: NodeJS.Platform
}

/**
 * Drafts a GitHub issue for a project: what the hub knows about the user's
 * setup (versions, game files by verdict, the last operation and its log).
 * It is shown to the user before anything is sent, and carries no file paths
 * outside the game folders and no user name (both are replaced).
 */
export class ReportService {
  constructor(private readonly deps: Deps) {}

  async draft(projectId: string): Promise<IssueReport> {
    const { projects, games } = await this.deps.registry.get()
    const project = projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Unknown project "${projectId}"`)
    if (!project.repository) throw new Error(`${project.name} has no GitHub repository to report to.`)
    const states = await this.deps.states()
    const state = states.find((s) => s.projectId === projectId)
    const install = isInstallable(project) ? project.install : null

    const setup: string[] = []
    const rec = state?.installed
    setup.push(`- **${project.name}:** ${rec ? `${versionLabel(rec)} (${rec.adopted ? 'linked folder' : 'installed by the hub'})` : 'not installed'}`)
    if (state?.latest) setup.push(`- **Latest release:** ${state.latest.tag}`)
    const host = install?.installInto ? projects.find((p) => p.id === install.installInto!.project) : undefined
    if (host) {
      const h = states.find((s) => s.projectId === host.id)?.installed
      setup.push(`- **${host.name}:** ${h ? versionLabel(h) : 'not installed'}`)
    }
    const addons = projects.filter((p) => p.install?.installInto?.project === projectId)
    for (const a of addons) {
      const r = states.find((s) => s.projectId === a.id)?.installed
      if (r) setup.push(`- **${a.name}** (add-on inside it): ${versionLabel(r)}`)
    }
    if (state?.missing) setup.push('- Its folder is **missing** (moved or deleted)')
    if (state?.rebuild.length) setup.push(`- **Needs Build again:** ${state.rebuild.join('; ')}`)
    setup.push(`- **ExpandedHub:** v${this.deps.hubVersion}`)
    setup.push(`- **System:** ${osName(this.deps.platform ?? process.platform)} ${release()} (${process.arch})`)

    // Game files: which ones, and whether they matched a known good dump. No paths.
    const configured = new Map((await this.deps.sources()).map((s) => [s.gameId, s]))
    const files = (install?.sources ?? []).map((s) => {
      const g = games.find((x) => x.id === s.gameId)
      const c = configured.get(s.gameId)
      const v = c?.validation
      const what = !c ? 'not chosen' : !v ? 'not checked yet' : v.verdict === 'verified' ? `verified (${v.matched ?? 'known dump'})` : `${v.verdict}: ${v.message}`
      return `- ${g?.name ?? s.gameId}${s.required ? '' : ' (optional)'}: ${what}`
    })

    // Its last operation (newest first in the list), and the end of its log.
    const op = this.deps.operations().find((o) => o.projectId === projectId)
    const opLines: string[] = []
    let log = ''
    if (op) {
      opLines.push(`- **Last ${op.kind}${op.extraName ? ` (${op.extraName})` : ''}:** ${op.tag || op.version} — ${op.status}${op.finishedAt ? `, ${op.finishedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}`)
      if (op.error) opLines.push(`- **Error:** ${op.error}`)
      for (const w of op.warnings ?? []) opLines.push(`- **Warning:** ${w}`)
      const text = await fs.readFile(join(this.deps.logsDir, `${op.id}.log`), 'utf8').catch(() => '')
      log = text.trimEnd().split(/\r?\n/).slice(-LOG_LINES).join('\n')
    }

    const head = [
      '### What happened',
      '<!-- What did you do, what did you expect, and what happened instead? Screenshots help. -->',
      '',
      '',
      '### Setup (filled in by ExpandedHub)',
      ...setup,
      ...(files.length ? ['', '**Game files**', ...files] : []),
      ...(opLines.length ? ['', ...opLines] : [])
    ].join('\n')
    let body = redact(head)
    if (log) {
      const wrap = (l: string) => `\n\n<details><summary>Hub log (last lines)</summary>\n\n\`\`\`\n${l}\n\`\`\`\n</details>`
      let lines = redact(log).split('\n')
      // Keep the end of the log, as much as fits.
      while (lines.length && body.length + wrap(lines.join('\n')).length > MAX_BODY) lines = lines.slice(1)
      if (lines.length) body += wrap(lines.join('\n'))
    }
    const title = op?.status === 'failed' && op.error ? `${op.extraName ?? capitalize(op.kind)} failed: ${redact(op.error).slice(0, 80)}` : ''
    const url = `https://github.com/${project.repository.owner}/${project.repository.name}/issues/new`
    return { title, body: body.slice(0, MAX_BODY), url }
  }
}

/** The user's home folder and name, which logs and errors can carry, replaced. */
export function redact(text: string): string {
  let out = text
  const home = homedir()
  if (home) out = out.split(home).join('~').split(home.replace(/\\/g, '/')).join('~')
  const name = safeUserName()
  if (name && name.length > 2) out = out.replace(new RegExp(`(?<=[\\\\/])${escapeRe(name)}(?=[\\\\/])`, 'gi'), '<user>')
  return out
}

function safeUserName(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const osName = (p: NodeJS.Platform) => (p === 'win32' ? 'Windows' : p === 'darwin' ? 'macOS' : p === 'linux' ? 'Linux' : p)
