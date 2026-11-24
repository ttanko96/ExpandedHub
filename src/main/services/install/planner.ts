import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDownload } from '@shared/assets'
import { sourceFit } from '@shared/source-fit'
import type { ExtraStatus, Preflight, PreflightScript, ReleaseChoice, SourceConfig } from '@shared/install'
import { isInstallable, type InstallableProject, type OsPlatform, type ProjectExtra, type RunArg, type ToolRequirement } from '@shared/registry-schema'
import type { InstalledService } from '../installed-service'
import type { BuiltWith } from '@shared/types'
import { builtWith } from './built-with'
import { findOutputs } from './run-script'
import type { RegistryService } from '../registry-service'
import type { SettingsService } from '../settings-service'
import type { UpdateService } from '../update-service'
import type { SourcesService } from './sources-service'
import type { ToolsService } from './tools-service'

const platform = process.platform as OsPlatform

type SourceFolder = NonNullable<PreflightScript['folders']>[number]

/** Works out where a project installs, what will run and what is missing. */
export class InstallPlanner {
  constructor(
    private readonly registry: RegistryService,
    private readonly settings: SettingsService,
    private readonly installed: InstalledService,
    private readonly updates: UpdateService,
    private readonly sources: SourcesService,
    private readonly tools: ToolsService
  ) {}

  async project(id: string): Promise<InstallableProject> {
    const p = (await this.registry.get()).projects.find((x) => x.id === id)
    if (!p) throw new Error(`Unknown project "${id}"`)
    if (!isInstallable(p)) {
      throw new Error(p.comingSoon ? `${p.name} is not released yet.` : `${p.name} cannot be installed through the hub yet — see its repository.`)
    }
    return p
  }

  /** Install folder: the current installation's, else the default one; null when it lives inside a dependency that is not installed yet. */
  async installPath(project: InstallableProject): Promise<string | null> {
    // An existing installation (including one the user linked) is updated where it is.
    const current = (await this.installed.all())[project.id]
    if (current) return current.installPath
    const into = project.install.installInto
    if (into) {
      const host = (await this.installed.all())[into.project]
      return host ? join(host.installPath, ...into.subdir.split('/')) : null
    }
    return join((await this.settings.get()).directories.installs, project.id)
  }

  /** What a build of the project uses right now (see `builtWith`); null for projects that are not built. */
  async builtWith(project: InstallableProject): Promise<BuiltWith | null> {
    return builtWith(project, (await this.registry.get()).projects, await this.installed.all(), await this.sources.list())
  }

  /**
   * The project's releases for Other versions: newest first, which one is
   * installed, and which are already downloaded (installing them needs no download).
   */
  async versions(projectId: string): Promise<ReleaseChoice[]> {
    const project = await this.project(projectId)
    const installed = (await this.installed.all())[projectId]
    const dir = join((await this.settings.get()).directories.downloads, projectId)
    return Promise.all(
      (await this.updates.releases(projectId)).map(async (r, i) => {
        const plan = resolveDownload(project, r, platform)
        const asset = plan.asset
        const downloaded = asset ? await fs.stat(join(dir, asset.name)).then((s) => s.size === asset.size, () => false) : false
        return {
          version: r.version,
          tag: r.tag,
          name: r.name,
          publishedAt: r.publishedAt,
          prerelease: r.prerelease,
          latest: i === 0,
          installed: installed?.versionSource !== 'unknown' && installed?.version === r.version,
          downloaded,
          size: asset?.size ?? 0,
          problem: plan.problem
        }
      })
    )
  }

  /** The program one of the project's tools (or the extra's) resolves to (see `ToolsService.program`), or null. */
  async toolProgram(project: InstallableProject, id: string, extraId?: string): Promise<string | null> {
    const tool = this.toolsFor(project, extraId).find((t) => t.id === id)
    return tool ? this.tools.program(tool) : null
  }

  /** One of the project's extras; throws when it has none by that id. */
  extra(project: InstallableProject, id: string): ProjectExtra {
    const x = project.install.extras.find((e) => e.id === id)
    if (!x) throw new Error(`${project.name} has no extra "${id}"`)
    return x
  }

  /**
   * The tools a run needs: the installation's, or for an extra its own and the
   * installation's required ones (Node.js for DriftEngine's remaster, not its optional FFmpeg).
   */
  toolsFor(project: InstallableProject, extraId?: string): ToolRequirement[] {
    if (!extraId) return project.install.tools
    const own = this.extra(project, extraId).tools
    return [...project.install.tools.filter((t) => !t.optional && !own.some((o) => o.id === t.id)), ...own]
  }

  /** Which of an installed project's extras have been made (their `done` files exist). */
  async extras(projectId: string): Promise<ExtraStatus[]> {
    const project = await this.project(projectId)
    const dir = (await this.installed.all())[projectId]?.installPath
    return Promise.all(
      project.install.extras.map(async (x) => ({ id: x.id, done: dir ? (await findOutputs(dir, x.done)).length > 0 : false }))
    )
  }

  /** The host project's install folder, for add-ons. */
  async hostDir(project: InstallableProject): Promise<string | null> {
    const into = project.install.installInto
    if (!into) return null
    return (await this.installed.all())[into.project]?.installPath ?? null
  }

  /**
   * Build-phase steps for this OS, in order, with placeholders resolved (unset
   * sources dropped). Every entry needs the user's consent; `command` is its key.
   */
  async scripts(project: InstallableProject, installDir: string | null, extraId?: string): Promise<PreflightScript[]> {
    const steps = extraId ? this.extra(project, extraId).steps : project.install.steps
    const configured = new Map((await this.sources.list()).map((s) => [s.gameId, s]))
    const toolPaths = await this.tools.paths()
    const folders = sourceFolders(configured, (await this.settings.get()).directories.temp)
    const host = await this.hostDir(project)
    // Steps run by one of the project's tools (`base: "tool"`) are shown, and consented to, by the tool's
    // name: where the program is found may change (the hub may install it first), the step does not.
    const toolNames = new Map(this.toolsFor(project, extraId).map((t) => [t.id, `<${t.name}>`]))
    // An add-on's `buildHost`: the host's own build steps, run in the host's folder.
    let hostScripts: PreflightScript[] = []
    if (steps.some((s) => s.type === 'buildHost')) {
      const into = project.install.installInto
      const hostProject = into ? (await this.registry.get()).projects.find((p) => p.id === into.project) : undefined
      if (hostProject && isInstallable(hostProject)) {
        hostScripts = (await this.scripts(hostProject, host)).map((sc) => ({
          ...sc,
          label: `${hostProject.name}: ${sc.label}`,
          host: true
        }))
      }
    }
    return steps.flatMap((s, step): PreflightScript[] => {
      if (s.type === 'buildHost') return hostScripts
      if (s.type === 'pythonVenv') {
        const reqs = s.requirements.length ? `, then pip install ${s.pipArgs.join(' ')} -r ${s.requirements.join(' -r ')}` : ''
        const pkgs = s.packages.length ? `, then pip install ${s.pipArgs.join(' ')} ${s.packages.join(' ')}`.replace(/  +/g, ' ') : ''
        return [
          {
            label: `Python ${s.minVersion}–${s.maxVersion} environment in ${s.path}${reqs}${pkgs}`,
            command: venvCommand(s.path),
            args: [],
            progress: 'none',
            kind: 'venv',
            step,
            base: installDir,
            host: false
          }
        ]
      }
      if (s.type !== 'run') return []
      const command = s.command[platform]
      if (!command) return []
      if (!s.when.every((id) => (id.startsWith('tool:') ? toolPaths.has(id.slice(5)) : configured.has(id)))) return []
      const args = resolveArgs(s.args, configured, installDir ?? '<install folder>', toolPaths, folders)
      // The folders this step's arguments name and really use (a group left out needs none).
      const named = new Set([...JSON.stringify(s.args).matchAll(/\$\{sourceFolder:([a-z0-9-]+)\}/g)].map((m) => m[1]))
      const used = [...folders.values()].filter((f) => named.has(f.gameId) && args.some((a) => a.includes(f.folder)))
      return [
        {
          label: s.label,
          command: s.base === 'host' ? `<host>/${command}` : s.base === 'tool' ? (toolNames.get(command) ?? command) : command,
          args,
          ...(used.length ? { folders: used } : {}),
          ...(s.optional ? { optional: true } : {}),
          progress: typeof s.progress === 'string' ? s.progress : 'patterns',
          kind: s.base === 'path' || s.base === 'tool' ? 'program' : 'run',
          step,
          base: s.base === 'host' ? host : installDir,
          host: false
        }
      ]
    })
  }

  async preflight(projectId: string, opts: { buildOnly?: boolean; extra?: string; version?: string } = {}): Promise<Preflight> {
    const project = await this.project(projectId)
    // Making an extra is a build in the existing installation, with the extra's steps and tools.
    const extra = opts.extra ? this.extra(project, opts.extra) : null
    if (extra) opts = { ...opts, buildOnly: true }
    const settings = await this.settings.get()
    const state = (await this.updates.states()).find((s) => s.projectId === projectId)
    // A chosen earlier version (Other versions on the project page), else the latest.
    const release = opts.version ? await this.updates.release(projectId, opts.version) : (state?.latest ?? null)
    const installedAll = await this.installed.all()
    const installPath = await this.installPath(project)
    const configured = new Map((await this.sources.list()).map((s) => [s.gameId, s]))
    const games = (await this.registry.get()).games

    const blockers: string[] = []
    const warnings: string[] = []

    if (settings.advanced.demoMode) blockers.push('Installing is disabled in demo mode (Settings → Advanced, development builds only).')
    if (!project.install.supportedPlatforms.includes(platform)) blockers.push(`${project.name} does not support this operating system.`)
    const plan = resolveDownload(project, release, platform)
    if (opts.buildOnly) {
      if (!installedAll[projectId]) blockers.push(`${project.name} is not installed.`)
      if (!extra && !project.install.steps.some((s) => s.type === 'run' || s.type === 'pythonVenv' || s.type === 'buildHost')) {
        blockers.push(`${project.name} has no build step.`)
      }
    } else {
      if (!release) blockers.push(opts.version ? `Version ${opts.version} is not known. Refresh the Mods page.` : 'No release is known yet. Refresh the Mods page.')
      if (release && plan.problem) blockers.push(plan.problem)
    }

    const dependencies = await Promise.all(
      project.install.dependsOn.map(async (d) => {
        const dep = (await this.registry.get()).projects.find((p) => p.id === d)
        return { id: d, name: dep?.name ?? d, installed: Boolean(installedAll[d]) }
      })
    )
    for (const d of dependencies) if (!d.installed) blockers.push(`Install ${d.name} first.`)

    // A folder that is gone (moved, deleted, a drive not connected): building there, or updating a folder
    // the user linked, would only make a broken copy. A hub install is simply installed there again.
    const current = installedAll[projectId]
    if (current && !(await isDir(current.installPath)) && (opts.buildOnly || current.adopted)) {
      blockers.push(`${project.name}'s folder was not found: ${current.installPath}. Moved it? Use Find it on its page. Deleted it? Uninstall, then install it again.`)
    }
    const into = project.install.installInto
    const hostRec = into ? installedAll[into.project] : undefined
    if (into && hostRec && !(await isDir(hostRec.installPath))) {
      const hostName = (await this.registry.get()).projects.find((p) => p.id === into.project)?.name ?? into.project
      blockers.push(`${hostName}'s folder was not found: ${hostRec.installPath}. Find it on its page first.`)
    }

    // An extra reads what the installation made, not the game files again.
    const sources = (extra ? [] : project.install.sources).map((s) => {
      const g = games.find((x) => x.id === s.gameId)
      return {
        gameId: s.gameId,
        name: g?.name ?? s.gameId,
        platform: g?.platform ?? '',
        required: s.required,
        purpose: s.purpose,
        config: configured.get(s.gameId) ?? null,
        fit: sourceFit(g, s, configured.get(s.gameId))
      }
    })
    for (const s of sources) {
      const v = s.config?.validation?.verdict
      if (s.fit?.kind === 'wrong-revision') {
        const msg = `${s.name}: ${project.name} reads only the ${s.fit.need.join(' or ')} revision${s.fit.have ? `; yours is ${s.fit.have}` : ''}.`
        ;(s.required ? blockers : warnings).push(s.required ? msg : `${msg} Its content is left out.`)
      } else if (!s.config) {
        if (s.required) blockers.push(`Select your ${s.name} (${s.platform}) file.`)
        else warnings.push(`Optional: ${s.name} not selected — ${s.purpose ?? 'its content is left out'}.`)
      } else if (v === 'missing' || v === 'invalid') {
        ;(s.required ? blockers : warnings).push(`${s.name}: ${s.config.validation!.message}`)
      } else if (v === 'mismatch' && s.config.validation!.belongsTo) {
        // Another game's disc: the project cannot build from it.
        ;(s.required ? blockers : warnings).push(`${s.name}: ${s.config.validation!.message}.`)
      } else if (v === 'mismatch') {
        warnings.push(`${s.name}: ${s.config.validation!.message}`)
      }
    }

    const toolDefs = this.toolsFor(project, extra?.id)
    const tools = await this.tools.check(toolDefs)
    // Missing tools the hub can install itself are downloaded first instead of blocking.
    const provisions: Preflight['provisions'] = []
    for (const t of tools) {
      const def = toolDefs.find((x) => x.id === t.id)
      const dl = def?.provision?.[platform]
      // Optional ones too (FFmpeg for a game's movies): the download is listed in the install window first.
      if (t.found === false && def?.provision && dl) {
        provisions.push({ toolId: t.id, name: t.name, version: def.provision.version, size: dl.size })
        continue
      }
      if (t.found === false && !t.optional) {
        blockers.push(
          t.problem && !t.pick
            ? `${t.name}: ${t.problem}${t.url ? ` (${t.url})` : ''}. Update it, then check again.`
            : `${t.name} is not installed${t.url ? ` (${t.url})` : ''}.`
        )
      }
      if (t.found === false && t.optional) {
        warnings.push(t.pick ? `Optional: ${t.name} not chosen${t.problem ? ` (${t.problem})` : ''} — browse to it below to use it.` : `Optional tool ${t.name} was not found.`)
      }
    }

    return {
      projectId,
      version: opts.buildOnly ? (installedAll[projectId]?.version ?? null) : (release?.version ?? null),
      tag: opts.buildOnly ? null : (release?.tag ?? null),
      buildOnly: Boolean(opts.buildOnly),
      extra: extra ? { id: extra.id, name: extra.name, description: extra.description, needs: extra.needs } : null,
      installPath: opts.buildOnly ? (installedAll[projectId]?.installPath ?? installPath) : installPath,
      sources,
      tools,
      provisions,
      dependencies,
      scripts: await this.scripts(project, opts.buildOnly ? (installedAll[projectId]?.installPath ?? installPath) : installPath, extra?.id),
      download: {
        file: plan.asset?.name ?? (plan.kind === 'source' && release?.zipballUrl ? 'Source archive' : null),
        size: plan.asset?.size ?? 0,
        problem: plan.problem
      },
      blockers,
      warnings
    }
  }

  /** Environment variables handed to scripts with `passSourcesAsEnv`. */
  async sourceEnv(): Promise<Record<string, string>> {
    const env: Record<string, string> = {}
    for (const s of await this.sources.list()) env[`EXPANDEDHUB_SOURCE_${s.gameId.toUpperCase().replace(/-/g, '_')}`] = s.path
    return env
  }
}

/** Consent key of a Python environment step. */
export const venvCommand = (path: string) => `python-venv:${path}`

/** Where each configured game file is seen as a folder: a zip unpacked under `tempDir`, any other file its own folder. */
export function sourceFolders(configured: Map<string, SourceConfig>, tempDir: string): Map<string, SourceFolder> {
  const out = new Map<string, SourceFolder>()
  for (const [gameId, s] of configured) {
    out.set(gameId, { gameId, file: s.path, folder: /\.zip$/i.test(s.path) ? join(tempDir, 'source-folders', gameId) : dirname(s.path) })
  }
  return out
}

export function resolveArgs(
  args: RunArg[],
  configured: Map<string, SourceConfig>,
  installDir: string,
  tools: Map<string, string> = new Map(),
  folders: Map<string, SourceFolder> = new Map()
): string[] {
  const out: string[] = []
  const has = (id: string) => (id.startsWith('tool:') ? tools.has(id.slice(5)) : configured.has(id))
  const one = (a: string) => {
    let drop = false
    const v = a
      .replace(/\$\{installDir\}/g, installDir)
      .replace(/\$\{source:([a-z0-9-]+)\}/g, (_m, id: string) => {
        const s = configured.get(id)
        if (!s) drop = true
        return s?.path ?? ''
      })
      .replace(/\$\{sourceFolder:([a-z0-9-]+)\}/g, (_m, id: string) => {
        const f = folders.get(id)
        if (!f) drop = true
        return f?.folder ?? ''
      })
      .replace(/\$\{tool:([a-z0-9-]+)\}/g, (_m, id: string) => {
        const t = tools.get(id)
        if (!t) drop = true
        return t ?? ''
      })
    return drop ? null : v
  }
  for (const a of args) {
    if (typeof a === 'string') {
      const v = one(a)
      if (v !== null) out.push(v)
      continue
    }
    if (!a.when.every(has)) continue
    if (a.unless.length && a.unless.every(has)) continue
    const group = a.args.map(one)
    // A group is all or nothing, so a flag never loses its value.
    if (group.every((v): v is string => v !== null)) out.push(...group)
  }
  return out
}

const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false)
