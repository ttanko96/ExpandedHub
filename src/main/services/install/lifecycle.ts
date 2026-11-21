import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import http from 'node:http'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { shell } from 'electron'
import type { DependencyStorage, ProjectStorage, ToolStorage, UninstallResult } from '@shared/install'
import { allTools, type InstallConfig } from '@shared/registry-schema'
import type { InstalledService } from '../installed-service'
import { paths } from '../paths'
import type { RegistryService } from '../registry-service'
import type { SettingsService } from '../settings-service'
import { killTree, killTreeSync } from './run-script'
import { envWithPath, findOnPath } from './system-path'
import type { ToolsService } from './tools-service'

type ServeConfig = NonNullable<InstallConfig['output']['serve']>

interface Server {
  child: ChildProcess
  exited: Promise<void>
  /** Set when Stop (or quitting) ended it, so its exit is no error. */
  stopping: boolean
  /** Its last output lines, for the error when it stops by itself. */
  tail: string[]
  code: () => number | null
}

const inside = (root: string, p: string) => {
  const r = resolve(root)
  const x = resolve(p)
  return x.startsWith(r + sep)
}

/** Launch and uninstall installed projects. */
export class LifecycleService {
  /** Game servers (`output.serve`) the hub started, by project. */
  private servers = new Map<string, Server>()
  private runningListeners = new Set<(ids: string[]) => void>()

  constructor(
    private readonly registry: RegistryService,
    private readonly settings: SettingsService,
    private readonly installed: InstalledService,
    private readonly tools: ToolsService
  ) {}

  async launch(projectId: string): Promise<void> {
    const rec = (await this.installed.all())[projectId]
    if (!rec) throw new Error('This project is not installed')
    const project = (await this.registry.get()).projects.find((p) => p.id === projectId)
    const serve = project?.install?.output.serve
    if (serve) return this.serve(projectId, rec.installPath, serve, project.name)
    const run = project?.install?.output.launch
    if (run && project.install) {
      // A game run by one of its tools (a Godot project): that program, in the install folder.
      const tool = project.install.tools.find((t) => t.id === run.tool)
      const program = tool ? await this.tools.program(tool) : null
      if (!program) throw new Error(`${tool?.name ?? run.tool} was not found. Install it, or browse to it in ${project.name}'s install dialog, then try again.`)
      const child = spawn(program, run.args, { cwd: rec.installPath, detached: true, stdio: 'ignore', windowsHide: false })
      child.on('error', () => {})
      child.unref()
      return
    }
    if (!rec.executable) throw new Error('No launchable file is known for this project yet. Open its folder instead.')
    const exe = resolve(rec.installPath, rec.executable)
    if (!inside(rec.installPath, exe)) throw new Error('Refusing to launch a file outside the install folder')
    await fs.access(exe).catch(() => {
      throw new Error(`${rec.executable} was not found. The project's setup may not have finished yet.`)
    })
    const child = spawn(exe, [], { cwd: dirname(exe), detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', () => {})
    child.unref()
  }

  /** Projects whose game server the hub is running now. */
  running(): string[] {
    return [...this.servers.keys()]
  }

  onRunning(cb: (ids: string[]) => void): () => void {
    this.runningListeners.add(cb)
    return () => this.runningListeners.delete(cb)
  }

  private emitRunning(): void {
    const ids = this.running()
    this.runningListeners.forEach((l) => l(ids))
  }

  /** Stop a game server the hub started (its whole process tree) and wait until it is gone. */
  async stop(projectId: string): Promise<void> {
    const s = this.servers.get(projectId)
    if (!s) return
    s.stopping = true
    killTree(s.child.pid)
    await Promise.race([s.exited, new Promise((r) => setTimeout(r, 8000))])
    this.servers.delete(projectId)
    this.emitRunning()
  }

  /** Stop every game server at once, synchronously: the hub is quitting. */
  stopAll(): void {
    for (const s of this.servers.values()) {
      s.stopping = true
      killTreeSync(s.child.pid)
    }
    this.servers.clear()
  }

  /**
   * A game played in the browser: the hub starts its server in the background
   * (no window; its output goes to `logs/<project>-server.log`), waits until its
   * address answers, then opens the browser. Stop, or quitting the hub, ends it.
   * Play while it runs just opens the browser again.
   */
  private async serve(projectId: string, installPath: string, serve: ServeConfig, name: string): Promise<void> {
    // Already up (ours, or one started by hand): just open the browser again.
    if (await answers(serve.url)) {
      await shell.openExternal(serve.url)
      return
    }
    // Ours but still starting: wait for it below instead of starting a second one.
    let server = this.servers.get(projectId)
    if (!server) {
      // The hub's own tools (its Node.js) come first, then what is installed on the machine.
      const searchPath = await this.tools.searchPath()
      const program = await findOnPath(serve.command, searchPath)
      if (!program) throw new Error(`${serve.command} was not found on this computer. Install what ${name} needs (see its requirements), then try again.`)
      const env = envWithPath(searchPath, serve.env)
      const logPath = join(paths.userData(), 'logs', `${projectId}-server.log`)
      await fs.mkdir(dirname(logPath), { recursive: true })
      const out = createWriteStream(logPath, { flags: 'w' })
      const isWin = process.platform === 'win32'
      // Batch files (npm.cmd) only run through cmd.exe; quoting as in run-script.
      const viaCmd = isWin && /\.(cmd|bat)$/i.test(program)
      const q = (s: string) => `"${s.replace(/"/g, '')}"`
      const child = viaCmd
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[q(program), ...serve.args.map(q)].join(' ')}"`], {
            cwd: installPath,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            windowsVerbatimArguments: true
          })
        : spawn(program, serve.args, { cwd: installPath, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: !isWin })
      const tail: string[] = []
      const keep = (buf: Buffer) => {
        out.write(buf)
        for (const line of buf.toString('utf8').split(/\r?\n/)) {
          if (!line.trim()) continue
          tail.push(line.replace(/\x1b\[[0-9;]*m/g, ''))
          if (tail.length > 8) tail.shift()
        }
      }
      child.stdout?.on('data', keep)
      child.stderr?.on('data', keep)
      let exitCode: number | null = null
      const exited = new Promise<void>((res) => {
        child.on('error', (err) => {
          tail.push(err.message)
          exitCode = -1
          res()
        })
        child.on('exit', (code) => {
          exitCode = code ?? -1
          res()
        })
      })
      server = { child, exited, stopping: false, tail, code: () => exitCode }
      const mine = server
      void exited.then(() => {
        out.end()
        if (this.servers.get(projectId) === mine) {
          this.servers.delete(projectId)
          this.emitRunning()
        }
      })
      this.servers.set(projectId, server)
      this.emitRunning()
    }

    const deadline = Date.now() + serve.timeoutSeconds * 1000
    while (Date.now() < deadline) {
      const code = server.code()
      if (code !== null) {
        if (server.stopping) return
        const last = server.tail.slice(-3).join(' / ')
        throw new Error(`${name}'s server stopped (exit code ${code})${last ? `: ${last}` : ''}`)
      }
      if (await answers(serve.url)) {
        await shell.openExternal(serve.url)
        return
      }
      await new Promise((r) => setTimeout(r, 750))
    }
    await this.stop(projectId)
    throw new Error(`${name}'s server did not answer at ${serve.url} in ${serve.timeoutSeconds} seconds. See logs/${projectId}-server.log (Settings → Advanced → Open logs folder).`)
  }

  /**
   * Remove a project's files and its installed record. Only folders under the
   * configured installs directory (or an add-on folder inside its host) are
   * deleted; anything else just forgets the record. `dependencies` names
   * projects from its `dependsOn` to uninstall as well (after it), `tools` the
   * hub-installed tools to remove; the others are kept.
   */
  async uninstall(
    projectId: string,
    opts: { files?: boolean; downloads?: boolean; dependencies?: string[]; tools?: string[] } = { files: true, downloads: false }
  ): Promise<UninstallResult> {
    const all = await this.installed.all()
    const rec = all[projectId]
    const wantFiles = opts.files !== false
    if (wantFiles && !rec) throw new Error('This project is not installed')

    // Check every dependency before anything is deleted, so a refusal leaves everything in place.
    const { projects } = await this.registry.get()
    const project = projects.find((p) => p.id === projectId)
    const deps = [...new Set(opts.dependencies ?? [])]
    if (deps.length && !wantFiles) throw new Error('A dependency can only be removed together with this project.')
    for (const dep of deps) {
      if (!project?.install?.dependsOn.includes(dep)) throw new Error(`"${dep}" is not a dependency of this project.`)
      if (!all[dep]) throw new Error(`${projects.find((p) => p.id === dep)?.name ?? dep} is not installed.`)
      const others = this.neededBy(projects, all, dep).filter((id) => id !== projectId && !deps.includes(id))
      if (others.length) {
        const names = others.map((id) => projects.find((p) => p.id === id)?.name ?? id).join(', ')
        throw new Error(`${projects.find((p) => p.id === dep)?.name ?? dep} is still needed by ${names}.`)
      }
    }
    const toolIds = [...new Set(opts.tools ?? [])]
    if (toolIds.length && !wantFiles) throw new Error('A tool can only be removed together with this project.')
    const toolsToRemove: ToolStorage[] = []
    if (toolIds.length) {
      const owned = await this.hubTools(projects, all, projectId)
      for (const id of toolIds) {
        const t = owned.find((x) => x.id === id)
        if (!t) throw new Error(`"${id}" is not a tool the hub installed for this project.`)
        const others = t.neededBy.filter((n) => !deps.includes(n.id))
        if (others.length) throw new Error(`${t.name} is still used by ${others.map((n) => n.name).join(', ')}.`)
        toolsToRemove.push(t)
      }
    }

    let removedFiles = false
    if (wantFiles && rec) {
      const dependents = projects.filter((p) => p.install?.installInto?.project === projectId && all[p.id])
      if (dependents.length) throw new Error(`Uninstall ${dependents.map((d) => d.name).join(', ')} first — it lives inside this installation.`)
      removedFiles = await this.ownsFolder(projectId, rec.installPath)
      if (removedFiles) await fs.rm(rec.installPath, { recursive: true, force: true })
      await this.installed.remove(projectId)
    }

    let removedDownloads = false
    if (opts.downloads) {
      const dir = await this.downloadsDir(projectId, rec?.downloadPath)
      removedDownloads = await fs.stat(dir).then((s) => s.isDirectory(), () => false)
      if (removedDownloads) await fs.rm(dir, { recursive: true, force: true })
    }

    const removedDependencies: string[] = []
    for (const dep of deps) {
      await this.uninstall(dep, { files: true, downloads: opts.downloads })
      removedDependencies.push(projects.find((p) => p.id === dep)?.name ?? dep)
    }

    const removedTools: string[] = []
    for (const t of toolsToRemove) {
      await fs.rm(t.install.path, { recursive: true, force: true })
      await this.tools.clear(t.id)
      if (opts.downloads) await fs.rm(t.downloads.path, { recursive: true, force: true })
      removedTools.push(t.name)
    }
    if (removedTools.length) this.tools.clearCache()
    return { removedFiles, removedDownloads, removedDependencies, removedTools }
  }

  /** Where each part of a project lives on disk and how much space it takes, for the uninstall dialog. */
  async storage(projectId: string): Promise<ProjectStorage> {
    const all = await this.installed.all()
    const rec = all[projectId]
    const { projects } = await this.registry.get()
    const project = projects.find((p) => p.id === projectId)
    const downloads = await this.downloadsDir(projectId, rec?.downloadPath)

    const dependencies: DependencyStorage[] = []
    for (const dep of project?.install?.dependsOn ?? []) {
      const depRec = all[dep]
      if (!depRec) continue
      const depDownloads = await this.downloadsDir(dep, depRec.downloadPath)
      dependencies.push({
        id: dep,
        name: projects.find((p) => p.id === dep)?.name ?? dep,
        install: { path: depRec.installPath, bytes: await folderSize(depRec.installPath), removable: await this.ownsFolder(dep, depRec.installPath) },
        downloads: { path: depDownloads, bytes: await folderSize(depDownloads) },
        neededBy: this.neededBy(projects, all, dep)
          .filter((id) => id !== projectId)
          .map((id) => projects.find((p) => p.id === id)?.name ?? id)
      })
    }

    return {
      install: rec
        ? { path: rec.installPath, bytes: await folderSize(rec.installPath), removable: await this.ownsFolder(projectId, rec.installPath) }
        : null,
      downloads: { path: downloads, bytes: await folderSize(downloads) },
      dependencies,
      tools: await this.hubTools(projects, all, projectId)
    }
  }

  /**
   * The project's tools that the hub downloaded and set up: their chosen path
   * lies in `<installs>/_tools/<id>-<version>`. Tools the user installed or
   * browsed to elsewhere are left out, so they can never be deleted.
   */
  private async hubTools(
    projects: { id: string; name: string; install?: InstallConfig }[],
    installed: Record<string, unknown>,
    projectId: string
  ): Promise<ToolStorage[]> {
    const project = projects.find((p) => p.id === projectId)
    const dirs = (await this.settings.get()).directories
    const root = resolve(dirs.installs, '_tools')
    const chosen = await this.tools.paths()
    const out: ToolStorage[] = []
    for (const t of allTools(project?.install)) {
      const path = chosen.get(t.id)
      if (!t.provision || !path || !inside(root, path)) continue
      const folder = join(root, relative(root, resolve(path)).split(sep)[0])
      if (!basename(folder).toLowerCase().startsWith(`${t.id.toLowerCase()}-`)) continue
      const downloads = join(dirs.downloads, '_tools', t.id.replace(/[^\w.-]+/g, '_'))
      out.push({
        id: t.id,
        name: t.name,
        install: { path: folder, bytes: await folderSize(folder) },
        downloads: { path: downloads, bytes: await folderSize(downloads) },
        neededBy: projects
          .filter((p) => p.id !== projectId && installed[p.id] && allTools(p.install).some((x) => x.id === t.id))
          .map((p) => ({ id: p.id, name: p.name }))
      })
    }
    return out
  }

  /** Installed projects that depend on `dep` or live inside its installation. */
  private neededBy(
    projects: { id: string; install?: InstallConfig }[],
    installed: Record<string, unknown>,
    dep: string
  ): string[] {
    return projects
      .filter((p) => installed[p.id] && (p.install?.dependsOn.includes(dep) || p.install?.installInto?.project === dep))
      .map((p) => p.id)
  }

  /** The recorded download folder when it is still there, else the one under the current downloads directory. */
  private async downloadsDir(projectId: string, recorded?: string): Promise<string> {
    const current = join((await this.settings.get()).directories.downloads, projectId)
    if (recorded && basename(resolve(recorded)).toLowerCase() === projectId) {
      const exists = await fs.stat(recorded).then((s) => s.isDirectory(), () => false)
      if (exists) return recorded
    }
    return current
  }

  /**
   * Only folders the hub created are deleted: anything under the installs
   * directory, an add-on folder inside its host, or a `<…>/<project id>` folder
   * left from an earlier installs directory. Anything else just loses its record,
   * and so does a folder the user linked (an installation they already had).
   */
  private async ownsFolder(projectId: string, folder: string): Promise<boolean> {
    const all = await this.installed.all()
    if (all[projectId]?.adopted && resolve(all[projectId]!.installPath) === resolve(folder)) return false
    const project = (await this.registry.get()).projects.find((p) => p.id === projectId)
    const installsRoot = (await this.settings.get()).directories.installs
    const host = project?.install?.installInto ? all[project.install.installInto.project] : undefined
    const full = resolve(folder)
    return (
      inside(installsRoot, full) ||
      (host ? inside(host.installPath, full) : false) ||
      (basename(full).toLowerCase() === projectId && dirname(full) !== full)
    )
  }
}

/** True when a local address answers an HTTP request at all (any status). */
function answers(url: string): Promise<boolean> {
  return new Promise((res) => {
    const req = http.get(url, { timeout: 1500 }, (r) => {
      r.resume()
      res(true)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => res(false))
  })
}

/** Total size of a folder in bytes; 0 when it does not exist. */
async function folderSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (d: string) => {
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (e) => {
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.isFile()) {
          // Read first, then add: `total += await …` would add to a stale total.
          const size = await fs.stat(p).then((s) => s.size, () => 0)
          total += size
        }
      })
    )
  }
  await walk(dir)
  return total
}
