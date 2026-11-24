import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveDownload } from '@shared/assets'
import type { Operation, OperationFile, OperationStep, OperationStepId } from '@shared/operations'
import { isActive } from '@shared/operations'
import { JsonStore } from '../json-store'
import { log } from '../logger'
import { paths } from '../paths'
import type { InstalledService } from '../installed-service'
import type { InstallPlanner } from '../install/planner'
import { writeMarker } from '../install/detect-version'
import { findOutputs, resolveScript, runScript } from '../install/run-script'
import { envWithPath, findOnPath } from '../install/system-path'
import type { RegistryService } from '../registry-service'
import { allTools, isInstallable, type ProgressPattern, type ToolRequirement } from '@shared/registry-schema'
import { ensureVenv } from '../install/python-venv'
import type { SettingsService } from '../settings-service'
import type { ToolsService } from '../install/tools-service'
import type { UpdateService } from '../update-service'
import { findChecksum, hashFile, sha256File } from './checksum'
import { extractZip } from './extract-zip'
import { downloadToFile, fetchText, HttpError } from './http-download'

const MAX_PARALLEL = 2
const EMIT_INTERVAL_MS = 250

type AbortReason = 'pause' | 'cancel'

const STEP_LABELS: Record<OperationStepId, string> = {
  download: 'Downloading',
  verify: 'Verifying',
  extract: 'Extracting',
  prepare: 'Preparing environment',
  build: 'Building project',
  configure: 'Configuring files',
  finalize: 'Finalizing installation'
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_')

/** Pick a troubleshooting hint for an error, so failures say what to do next. */
function hintFor(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC' || /not enough free space/i.test(msg)) return 'Free up disk space or choose another download folder in Settings → Directories, then retry.'
  if (code === 'EACCES' || code === 'EPERM') return 'The download folder is not writable. Choose another folder in Settings → Directories.'
  if (err instanceof HttpError && err.status === 404) return 'The file is no longer in the release. Refresh the Mods page and try again.'
  if (err instanceof HttpError && (err.status === 403 || err.status === 429)) return 'GitHub is limiting downloads right now. Wait a few minutes, then resume.'
  if (/checksum/i.test(msg)) return 'The downloaded file was damaged. Retry downloads it again from scratch.'
  if (/net::|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|timed out/i.test(msg)) return 'Check your internet connection. Resume continues where the download stopped.'
  if (/archive|zip|central directory/i.test(msg)) return 'The archive could not be read. Retry to download it again.'
  return 'Retry the operation. If it keeps failing, open the log and report it to the project.'
}

/**
 * Queue of download operations: download (resumable) → verify checksum →
 * extract. Installation steps (prepare, build, configure, finalize) are shown
 * and filled in by the installation engine in phase 4.
 *
 * Everything runs asynchronously in the main process; the renderer only
 * receives throttled snapshots.
 */
export class OperationsService {
  private store = new JsonStore<{ operations: Operation[] }>(join(paths.userData(), 'operations.json'), () => ({ operations: [] }))
  private ops: Operation[] = []
  private controllers = new Map<string, { ctrl: AbortController; reason?: AbortReason }>()
  private listeners = new Set<(ops: Operation[]) => void>()
  private emitTimer: NodeJS.Timeout | null = null
  private lastEmit = 0

  constructor(
    private readonly registry: RegistryService,
    private readonly settings: SettingsService,
    private readonly updates: UpdateService,
    private readonly planner: InstallPlanner,
    private readonly installed: InstalledService,
    private readonly tools: ToolsService
  ) {}

  async init(): Promise<void> {
    this.ops = (await this.store.read()).operations
    // Anything that was running when the app closed can be resumed.
    for (const op of this.ops) {
      op.consentedScripts ??= []
      op.installPath ??= null
      if (op.status === 'running' || op.status === 'queued') {
        op.status = 'paused'
        op.speed = 0
        op.etaSeconds = null
        op.message = 'Interrupted when the app closed — resume to continue'
        for (const s of op.steps) if (s.state === 'active') s.state = 'pending'
      }
    }
    await this.persist()
    this.syncProjectFlags()
  }

  list(): Operation[] {
    return this.ops
  }

  onChange(l: (ops: Operation[]) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  /**
   * Start installing (or updating) a project. `allowScripts` is the user's
   * consent, given in the install dialog, to run the project's own scripts.
   */
  async start(projectId: string, allowScripts = false, version?: string): Promise<Operation> {
    const existing = this.ops.find((o) => o.projectId === projectId && isActive(o))
    if (existing) return existing

    const preflight = await this.planner.preflight(projectId, { version })
    if (preflight.blockers.length) throw new Error(preflight.blockers.join(' '))
    const scriptCommands = preflight.scripts.map((s) => s.command)
    if (scriptCommands.length && !allowScripts) {
      throw new Error(`Installing runs the project's own script (${scriptCommands.join(', ')}). Allow it in the install dialog to continue.`)
    }

    const project = (await this.registry.get()).projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Unknown project "${projectId}"`)
    if (!isInstallable(project)) throw new Error(`${project.name} cannot be installed through the hub.`)
    const state = (await this.updates.states()).find((s) => s.projectId === projectId)
    // An earlier version the user chose (Other versions), else the latest.
    const release = version ? await this.updates.release(projectId, version) : (state?.latest ?? null)
    if (!release) throw new Error(version ? `Version ${version} is not known. Refresh the Mods page first.` : 'No release is known for this project yet. Refresh the Mods page first.')

    const plan = resolveDownload(project, release, process.platform)
    if (plan.problem) throw new Error(plan.problem)

    // Missing tools the hub installs itself (Godot): their own operations, which this one waits for.
    const waitFor: string[] = []
    for (const p of preflight.provisions) {
      const tool = allTools(project.install).find((t) => t.id === p.toolId)
      if (tool) waitFor.push((await this.startTool(tool)).id)
    }
    const waitingFor = preflight.provisions.map((p) => p.name).join(', ')

    // Retrying the same version reuses the failed operation (and any partial download).
    const last = this.ops.find((o) => o.projectId === projectId)
    if (last && last.kind !== 'build' && (last.status === 'failed' || last.status === 'cancelled') && last.version === release.version) {
      last.consentedScripts = allowScripts ? scriptCommands : []
      last.installPath = preflight.installPath
      last.waitFor = waitFor
      await this.retry(last.id)
      if (waitFor.length) last.message = `Waiting for ${waitingFor}…`
      return last
    }

    let file: OperationFile
    if (plan.kind === 'asset' && plan.asset) {
      file = { name: plan.asset.name, url: plan.asset.downloadUrl, size: plan.asset.size }
    } else if (release.zipballUrl) {
      file = { name: `${project.repository.name}-${safeName(release.tag)}-source.zip`, url: release.zipballUrl, size: 0 }
    } else {
      throw new Error('This release has nothing to download')
    }
    const checksumFile = plan.checksum ? { name: plan.checksum.name, url: plan.checksum.downloadUrl, size: plan.checksum.size } : null

    const now = new Date().toISOString()
    const steps: OperationStep[] = (Object.keys(STEP_LABELS) as OperationStepId[]).map((id) => ({
      id,
      label: STEP_LABELS[id],
      state: id === 'verify' && !checksumFile ? 'skipped' : 'pending'
    }))
    const op: Operation = {
      id: randomUUID(),
      projectId,
      projectName: project.name,
      kind: state?.installed ? 'update' : 'install',
      version: release.version,
      tag: release.tag,
      status: 'queued',
      steps,
      message: waitFor.length ? `Waiting for ${waitingFor}…` : 'Waiting to start…',
      file,
      checksumFile,
      received: 0,
      total: file.size,
      speed: 0,
      etaSeconds: null,
      outputDir: null,
      installPath: preflight.installPath,
      consentedScripts: allowScripts ? scriptCommands : [],
      error: null,
      hint: null,
      warnings: [],
      waitFor,
      createdAt: now,
      updatedAt: now,
      finishedAt: null
    }
    this.ops.unshift(op)
    await this.log(op, `Queued ${op.kind} of ${project.name} ${release.tag} (${file.name})`)
    if (waitFor.length) await this.log(op, `Starts when ${preflight.provisions.map((p) => `${p.name} ${p.version}`).join(', ')} is installed`)
    await this.changed(op)
    this.pump()
    return op
  }

  /**
   * Download and unpack a tool a project needs (Godot), as its own operation on
   * the Downloads page. An operation already queued or running for it is
   * reused; a failed one for the same version is retried.
   */
  private async startTool(tool: ToolRequirement): Promise<Operation> {
    const pid = `tool:${tool.id}`
    const existing = this.ops.find((o) => o.projectId === pid && isActive(o))
    if (existing) {
      if (existing.status === 'paused') await this.resume(existing.id)
      return existing
    }
    const prov = tool.provision
    const dl = prov?.[process.platform as 'win32']
    if (!prov || !dl) throw new Error(`${tool.name} cannot be installed by the hub on this system. Install it yourself (${tool.url ?? 'see the project'}).`)
    const last = this.ops.find((o) => o.projectId === pid)
    if (last && (last.status === 'failed' || last.status === 'cancelled') && last.version === prov.version) {
      await this.retry(last.id)
      return last
    }
    const name = safeName(decodeURIComponent(new URL(dl.url).pathname.split('/').pop() || `${tool.id}.zip`))
    const now = new Date().toISOString()
    const used: OperationStepId[] = ['download', 'verify', 'extract', 'finalize']
    const op: Operation = {
      id: randomUUID(),
      projectId: pid,
      projectName: tool.name,
      kind: 'tool',
      toolId: tool.id,
      version: prov.version,
      tag: prov.version,
      status: 'queued',
      steps: (Object.keys(STEP_LABELS) as OperationStepId[]).map((id) => ({
        id,
        label: id === 'finalize' ? 'Setting up the tool' : STEP_LABELS[id],
        state: used.includes(id) ? 'pending' : 'skipped'
      })),
      message: 'Waiting to start…',
      file: { name, url: dl.url, size: dl.size },
      checksumFile: null,
      received: 0,
      total: dl.size,
      speed: 0,
      etaSeconds: null,
      outputDir: null,
      installPath: null,
      consentedScripts: [],
      error: null,
      hint: null,
      warnings: [],
      createdAt: now,
      updatedAt: now,
      finishedAt: null
    }
    this.ops.unshift(op)
    await this.log(op, `Queued download of ${tool.name} ${prov.version} (${dl.url})`)
    await this.changed(op)
    this.pump()
    return op
  }

  /** The registry's definition of a tool, from any project that can install it. */
  private async toolDef(id: string): Promise<ToolRequirement | null> {
    for (const p of (await this.registry.get()).projects) {
      const t = allTools(p.install).find((x) => x.id === id && x.provision)
      if (t) return t
    }
    return null
  }

  /**
   * Run the project's build again in its existing installation, e.g. after an
   * install that was made before the hub could build, or to rebuild with other game files.
   */
  async build(projectId: string, allowScripts = false, extraId?: string): Promise<Operation> {
    const existing = this.ops.find((o) => o.projectId === projectId && isActive(o))
    if (existing) return existing
    const preflight = await this.planner.preflight(projectId, { buildOnly: true, extra: extraId })
    if (preflight.blockers.length) throw new Error(preflight.blockers.join(' '))
    const scriptCommands = preflight.scripts.map((s) => s.command)
    if (scriptCommands.length && !allowScripts) {
      throw new Error(`${extraId ? 'Making it' : 'Building'} runs the project's own script (${scriptCommands.join(', ')}). Allow it in the dialog to continue.`)
    }
    const project = await this.planner.project(projectId)
    const extra = extraId ? this.planner.extra(project, extraId) : null
    const rec = (await this.installed.all())[projectId]!
    // Tools it needs that the hub installs itself (uv for a remaster): their own operations first.
    const waitFor: string[] = []
    for (const p of preflight.provisions) {
      const tool = this.planner.toolsFor(project, extraId).find((t) => t.id === p.toolId)
      if (tool) waitFor.push((await this.startTool(tool)).id)
    }
    const waitingFor = preflight.provisions.map((p) => p.name).join(', ')
    const now = new Date().toISOString()
    const skip: OperationStepId[] = ['download', 'verify', 'extract']
    const op: Operation = {
      id: randomUUID(),
      projectId,
      projectName: project.name,
      kind: 'build',
      ...(extra ? { extraId: extra.id, extraName: extra.name } : {}),
      waitFor,
      version: rec.version,
      tag: rec.version.startsWith('v') ? rec.version : `v${rec.version}`,
      status: 'queued',
      steps: (Object.keys(STEP_LABELS) as OperationStepId[]).map((id) => ({
        id,
        label: STEP_LABELS[id],
        state: skip.includes(id) || (extra && id === 'finalize') ? 'skipped' : 'pending',
        ...(extra && id === 'build' ? { label: `Making ${extra.name}` } : {}),
        ...(extra && id === 'configure' ? { label: 'Checking what was made' } : {})
      })),
      message: waitFor.length ? `Waiting for ${waitingFor}…` : 'Waiting to start…',
      file: { name: '', url: '', size: 0 },
      checksumFile: null,
      received: 0,
      total: 0,
      speed: 0,
      etaSeconds: null,
      outputDir: null,
      installPath: rec.installPath,
      consentedScripts: allowScripts ? scriptCommands : [],
      error: null,
      hint: null,
      warnings: [],
      createdAt: now,
      updatedAt: now,
      finishedAt: null
    }
    this.ops.unshift(op)
    await this.log(op, extra ? `Queued ${extra.name} of ${project.name} ${op.tag} in ${rec.installPath}` : `Queued build of ${project.name} ${op.tag} in ${rec.installPath}`)
    if (waitFor.length) await this.log(op, `Starts when ${preflight.provisions.map((p) => `${p.name} ${p.version}`).join(', ')} is installed`)
    await this.changed(op)
    this.pump()
    return op
  }

  async pause(id: string): Promise<void> {
    const op = this.get(id)
    const active = op.steps.find((s) => s.state === 'active')
    if (op.status === 'running' && active && active.id !== 'download') {
      throw new Error('Only the download can be paused. Cancel stops the installation.')
    }
    if (op.status === 'queued') {
      op.status = 'paused'
      op.message = 'Paused'
      await this.changed(op)
      return
    }
    const c = this.controllers.get(id)
    if (c) {
      c.reason = 'pause'
      c.ctrl.abort('pause')
    }
  }

  async resume(id: string): Promise<void> {
    const op = this.get(id)
    if (op.status !== 'paused') return
    // A paused tool it waits for (after a restart, say) resumes with it.
    for (const w of op.waitFor ?? []) {
      const dep = this.ops.find((o) => o.id === w)
      if (dep?.status === 'paused') await this.resume(dep.id)
    }
    op.status = 'queued'
    op.message = 'Waiting to resume…'
    await this.changed(op)
    this.pump()
  }

  async cancel(id: string): Promise<void> {
    const op = this.get(id)
    const c = this.controllers.get(id)
    if (c) {
      c.reason = 'cancel'
      c.ctrl.abort('cancel')
      return
    }
    if (isActive(op)) await this.finishCancelled(op)
  }

  async retry(id: string): Promise<void> {
    const op = this.get(id)
    if (op.status !== 'failed' && op.status !== 'cancelled') return
    // A tool it waits for that did not install is retried with it.
    for (const w of op.waitFor ?? []) {
      const dep = this.ops.find((o) => o.id === w)
      if (dep && (dep.status === 'failed' || dep.status === 'cancelled')) await this.retry(dep.id)
      else if (dep?.status === 'paused') await this.resume(dep.id)
    }
    // Tools the project needs that are still missing (or newly required) are downloaded first.
    let waitingFor = ''
    if (op.kind === 'install' || op.kind === 'update' || op.kind === 'build') {
      const pre = await this.planner.preflight(op.projectId, { buildOnly: op.kind === 'build', extra: op.extraId }).catch(() => null)
      const project = (await this.registry.get()).projects.find((p) => p.id === op.projectId)
      if (pre?.provisions.length && project?.install) {
        const ids = new Set(op.waitFor ?? [])
        for (const p of pre.provisions) {
          const tool = allTools(project.install).find((t) => t.id === p.toolId)
          if (tool) ids.add((await this.startTool(tool)).id)
        }
        op.waitFor = [...ids]
        waitingFor = pre.provisions.map((p) => p.name).join(', ')
      }
    }
    op.status = 'queued'
    op.error = null
    op.hint = null
    op.finishedAt = null
    op.message = waitingFor ? `Waiting for ${waitingFor}…` : 'Waiting to retry…'
    for (const s of op.steps) if (s.state !== 'skipped') s.state = 'pending'
    await this.log(op, 'Retry requested')
    await this.changed(op)
    this.pump()
  }

  /** Remove a finished operation from the list (files stay on disk). */
  async remove(id: string): Promise<void> {
    const op = this.get(id)
    if (isActive(op)) throw new Error('Cancel the operation before removing it')
    this.ops = this.ops.filter((o) => o.id !== id)
    await fs.rm(this.logFile(id), { force: true })
    await this.persist()
    this.syncProjectFlags()
    this.emit(true)
  }

  async clearFinished(): Promise<void> {
    const finished = this.ops.filter((o) => !isActive(o))
    await Promise.all(finished.map((o) => fs.rm(this.logFile(o.id), { force: true })))
    this.ops = this.ops.filter(isActive)
    await this.persist()
    this.syncProjectFlags()
    this.emit(true)
  }

  async readLog(id: string): Promise<string> {
    try {
      return await fs.readFile(this.logFile(id), 'utf8')
    } catch {
      return ''
    }
  }

  async logPath(id: string): Promise<string> {
    return this.logFile(id)
  }

  // ---------------------------------------------------------------- internals

  private get(id: string): Operation {
    const op = this.ops.find((o) => o.id === id)
    if (!op) throw new Error('Operation not found')
    return op
  }

  private pump(): void {
    let free = MAX_PARALLEL - this.ops.filter((o) => o.status === 'running').length
    const queued = this.ops.filter((o) => o.status === 'queued').reverse() // oldest first
    for (const op of queued) {
      // Waiting for a tool's operation: start once it completed, fail when it did not.
      const deps = (op.waitFor ?? []).map((id) => this.ops.find((o) => o.id === id)).filter((o): o is Operation => Boolean(o))
      const broken = deps.find((d) => d.status === 'failed' || d.status === 'cancelled')
      if (broken) {
        void this.failWaiting(op, broken)
        continue
      }
      if (deps.some((d) => d.status !== 'completed')) continue
      if (free <= 0) break
      free--
      void this.run(op)
    }
  }

  /** A tool this operation waits for did not install: it cannot start either. */
  private async failWaiting(op: Operation, dep: Operation): Promise<void> {
    if (op.status !== 'queued') return
    op.status = 'failed'
    op.error = `${dep.projectName} ${dep.version} could not be installed${dep.status === 'cancelled' ? ' (cancelled)' : dep.error ? `: ${dep.error}` : ''}`
    op.hint = 'Retry downloads the tool again, then installs this project. Or install the tool yourself and choose it in the install dialog.'
    op.message = 'Failed'
    op.finishedAt = new Date().toISOString()
    await this.log(op, `ERROR: ${op.error}`)
    await this.changed(op)
  }

  private async run(op: Operation): Promise<void> {
    const ctrlEntry: { ctrl: AbortController; reason?: AbortReason } = { ctrl: new AbortController() }
    this.controllers.set(op.id, ctrlEntry)
    const signal = ctrlEntry.ctrl.signal
    op.status = 'running'
    op.error = null
    op.hint = null
    op.warnings = []
    await this.changed(op)

    const settings = await this.settings.get()
    const dir = op.kind === 'tool'
      ? join(settings.directories.downloads, '_tools', safeName(op.toolId ?? 'tool'))
      : join(settings.directories.downloads, op.projectId)
    const archive = join(dir, op.file.name)
    const part = `${archive}.part`
    const outDir = join(dir, safeName(op.tag))
    const tmpOut = `${outDir}.extracting`
    const ua = `ExpandedHub/${app.getVersion()}`

    try {
      if (op.kind === 'build') {
        await this.install(op, null, signal)
        op.status = 'completed'
        op.finishedAt = new Date().toISOString()
        op.message = op.extraName ? `${op.extraName} made` : `Built ${op.tag}`
        return
      }
      await fs.mkdir(dir, { recursive: true })

      // 1. Download -----------------------------------------------------------
      this.setStep(op, 'download', 'active')
      const done = await fs.stat(archive).then((s) => op.file.size > 0 && s.size === op.file.size, () => false)
      if (done) {
        await this.log(op, `Using the archive already on disk: ${archive}`)
      } else {
        await this.ensureSpace(dir, op.file.size)
        op.message = op.received > 0 ? 'Resuming download…' : 'Downloading…'
        await this.changed(op)
        const meter = this.speedMeter(op)
        await downloadToFile({
          url: op.file.url,
          partPath: part,
          signal,
          userAgent: ua,
          log: (l) => void this.log(op, l),
          onProgress: (p) => {
            op.received = p.received
            op.total = p.total
            meter(p.received)
            this.emit()
          }
        })
        await fs.rm(archive, { force: true })
        await fs.rename(part, archive)
        await this.log(op, `Saved ${archive}`)
      }
      op.speed = 0
      op.etaSeconds = null
      this.setStep(op, 'download', 'done')

      // 2. Verify -------------------------------------------------------------
      if (op.kind === 'tool') {
        // A tool's zip is checked against the hash pinned in the registry.
        this.setStep(op, 'verify', 'active')
        op.message = 'Verifying checksum…'
        await this.changed(op)
        const dl = (await this.toolDef(op.toolId ?? ''))?.provision?.[process.platform as 'win32']
        const algorithm = dl?.sha512 ? 'sha512' : 'sha256'
        const expected = (dl?.sha512 ?? dl?.sha256)?.toLowerCase()
        if (!dl || !expected || dl.url !== op.file.url) {
          throw new Error(`${op.projectName} is no longer in the registry with this download. Remove this operation and install again.`)
        }
        const size = (await fs.stat(archive)).size
        const actual = await hashFile(archive, algorithm, signal, (b) => {
          op.received = b
          op.total = size
          this.emit()
        })
        if (actual !== expected) {
          await fs.rm(archive, { force: true })
          throw new Error(`Checksum mismatch: expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…`)
        }
        await this.log(op, `${algorithm.toUpperCase()} verified (${actual})`)
        this.setStep(op, 'verify', 'done')
      } else if (op.checksumFile) {
        this.setStep(op, 'verify', 'active')
        op.message = 'Verifying checksum…'
        await this.changed(op)
        const list = await fetchText(op.checksumFile.url, signal, ua)
        const expected = findChecksum(list, op.file.name)
        if (!expected) {
          await this.log(op, `${op.checksumFile.name} has no entry for ${op.file.name}; skipping verification`)
          this.setStep(op, 'verify', 'skipped')
        } else {
          const size = (await fs.stat(archive)).size
          const actual = await sha256File(archive, signal, (b) => {
            op.received = b
            op.total = size
            this.emit()
          })
          if (actual !== expected) {
            await fs.rm(archive, { force: true })
            throw new Error(`Checksum mismatch: expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…`)
          }
          await this.log(op, `SHA-256 verified (${actual})`)
          this.setStep(op, 'verify', 'done')
        }
      }

      // 3. Extract ------------------------------------------------------------
      this.setStep(op, 'extract', 'active')
      op.message = 'Extracting files…'
      op.received = 0
      await this.changed(op)
      await fs.rm(tmpOut, { recursive: true, force: true })
      const { files } = await extractZip({
        archive,
        destDir: tmpOut,
        stripRoot: true,
        signal,
        log: (l) => void this.log(op, l),
        onProgress: (d, t) => {
          op.received = d
          op.total = t
          this.emit()
        }
      })
      await fs.rm(outDir, { recursive: true, force: true })
      await fs.rename(tmpOut, outDir)
      await this.log(op, `Extracted ${files} files to ${outDir}`)
      this.setStep(op, 'extract', 'done')

      op.outputDir = outDir
      op.received = 0
      op.total = 0

      // 4. Install ------------------------------------------------------------
      if (op.kind === 'tool') {
        await this.finishTool(op, outDir)
        op.status = 'completed'
        op.finishedAt = new Date().toISOString()
        op.message = `Installed ${op.projectName} ${op.version}`
        return
      }
      await this.install(op, outDir, signal)

      op.status = 'completed'
      op.finishedAt = new Date().toISOString()
      op.message = op.kind === 'update' ? `Updated to ${op.tag}` : `Installed ${op.tag}`
    } catch (err) {
      const reason = ctrlEntry.reason
      op.speed = 0
      op.etaSeconds = null
      if (reason === 'pause') {
        op.status = 'paused'
        op.message = 'Paused'
        for (const s of op.steps) if (s.state === 'active') s.state = 'pending'
        await this.log(op, 'Paused by user')
      } else if (reason === 'cancel') {
        await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => {})
        await this.finishCancelled(op, false)
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        op.status = 'failed'
        op.error = msg
        op.hint = hintFor(err)
        op.finishedAt = new Date().toISOString()
        op.message = 'Failed'
        for (const s of op.steps) if (s.state === 'active') s.state = 'failed'
        await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => {})
        await this.log(op, `ERROR: ${msg}`)
        log('warn', `Operation failed: ${op.projectName} ${op.tag}: ${msg}`)
      }
    } finally {
      this.controllers.delete(op.id)
      await this.changed(op)
      this.pump()
    }
  }

  /**
   * A tool's unpacked zip: copied to `<installs>/_tools/<id>-<version>` and its
   * program remembered as the tool's chosen path, as if the user had browsed to it.
   */
  private async finishTool(op: Operation, extracted: string): Promise<void> {
    this.setStep(op, 'finalize', 'active')
    op.message = `Setting up ${op.projectName}…`
    await this.changed(op)
    const tool = await this.toolDef(op.toolId ?? '')
    const dl = tool?.provision?.[process.platform as 'win32']
    if (!tool || !dl) throw new Error(`${op.projectName} is no longer in the registry. Remove this operation and install again.`)
    const target = join((await this.settings.get()).directories.installs, '_tools', safeName(`${tool.id}-${op.version}`))
    await fs.rm(target, { recursive: true, force: true })
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.cp(extracted, target, { recursive: true, force: true })
    op.installPath = target
    const program = join(target, ...dl.executable.split(/[\\/]/))
    if (!(await fs.stat(program).then((st) => st.isFile(), () => false))) {
      throw new Error(`${dl.executable} was not found in the downloaded ${op.projectName}`)
    }
    await this.tools.choose(tool, program)
    this.tools.clearCache()
    await this.log(op, `${op.projectName} ${op.version} is in ${target}; using ${program}`)
    this.setStep(op, 'finalize', 'done')
  }

  /** Prepare → build (project scripts) → configure → finalize. */
  private async install(op: Operation, extracted: string | null, signal: AbortSignal): Promise<void> {
    const project = await this.planner.project(op.projectId)
    const platform = process.platform as 'win32'

    // Prepare: re-check requirements, then copy the files into place.
    this.setStep(op, 'prepare', 'active')
    op.message = 'Checking requirements…'
    await this.changed(op)
    const pre = await this.planner.preflight(op.projectId, { buildOnly: extracted === null, extra: op.extraId })
    if (pre.blockers.length) throw new Error(pre.blockers.join(' '))
    const target = pre.installPath
    if (!target) throw new Error('No install folder could be determined')
    op.installPath = target
    if (extracted) {
      op.message = `Copying files to ${target}…`
      await this.changed(op)
      await fs.mkdir(target, { recursive: true })
      // Merge over an existing install: new files replace old ones, user data (saves, settings) stays.
      await fs.cp(extracted, target, { recursive: true, force: true })
      await this.log(op, `Copied files into ${target}`)
    }
    this.setStep(op, 'prepare', 'done')

    // Build: Python environments and the project's own scripts, only with consent.
    const extra = op.extraId ? this.planner.extra(project, op.extraId) : null
    const scripts = await this.planner.scripts(project, target, extra?.id)
    if (scripts.length === 0) this.setStep(op, 'build', 'skipped')
    else {
      this.setStep(op, 'build', 'active')
      op.build = { done: 0, total: scripts.length, percent: null }
      const runSteps = (extra?.steps ?? project.install.steps).filter((s) => s.type === 'run')
      const env = runSteps.some((s) => s.type === 'run' && s.passSourcesAsEnv) ? await this.planner.sourceEnv() : {}
      const into = project.install.installInto
      const hostProject = into ? (await this.registry.get()).projects.find((p) => p.id === into.project) : undefined
      for (const [index, sc] of scripts.entries()) {
        op.build = { done: index, total: scripts.length, percent: null }
        if (!op.consentedScripts.includes(sc.command)) throw new Error(`Not allowed to run ${sc.command}: consent was not given`)
        const owner = sc.host ? hostProject : project
        if (!owner || !isInstallable(owner)) throw new Error(`${sc.label}: its project is not in the registry`)
        // An extra's step indexes the extra's steps; a host step the host's.
        const step = (extra && !sc.host ? extra.steps : owner.install.steps)[sc.step]
        // A host step runs in the host's folder, as the host's own build would.
        const cwd = sc.host && sc.base ? sc.base : target
        op.message = `${sc.label}…`
        await this.changed(op)

        if (step.type === 'pythonVenv') {
          // The Python the hub installed (or the user chose) is tried before the machine's own.
          const hubPython = (await this.tools.paths()).get('python')
          await ensureVenv({
            installDir: cwd,
            step,
            signal,
            pythons: hubPython ? [hubPython] : [],
            log: (l) => void this.log(op, l),
            status: (m) => {
              op.message = m
              this.emit()
            }
          })
          await this.log(op, `Python environment ${step.path} ready`)
          continue
        }
        if (step.type !== 'run') continue

        if (!sc.base) throw new Error(`${sc.label}: the folder it runs from is not installed`)
        let full: string
        let stepEnv: Record<string, string> = { ...env, ...step.env }
        if (step.base === 'path') {
          // A program installed on the machine (npm, node), found as a new terminal would find it,
          // or brought along by a tool the hub installed (npm beside its Node.js).
          const searchPath = await this.tools.searchPath()
          const found = await findOnPath(sc.command, searchPath)
          if (!found) throw new Error(`${sc.command} was not found on this computer. Install it (see the project's requirements), then click Retry.`)
          full = found
          stepEnv = envWithPath(searchPath, stepEnv)
        } else if (step.base === 'tool') {
          // One of the project's tools (Godot): the program the user chose, else the one on the search path.
          const id = step.command[process.platform as 'win32'] ?? ''
          const found = await this.planner.toolProgram(owner, id, sc.host ? undefined : extra?.id)
          const name = this.planner.toolsFor(owner, sc.host ? undefined : extra?.id).find((t) => t.id === id)?.name ?? id
          if (!found) throw new Error(`${name} was not found. Install it or browse to it in the install dialog, then click Retry.`)
          full = found
          stepEnv = envWithPath(await this.tools.searchPath(), stepEnv)
        } else {
          const relative = sc.kind === 'run' && step.base === 'host' ? sc.command.replace(/^<host>\//, '') : sc.command
          full = await resolveScript(sc.base, relative)
        }
        await this.log(op, `Running ${sc.command}${sc.args.length ? ` with ${sc.args.length} argument(s)` : ''} in ${cwd}`)
        const progress = typeof step.progress === 'string' ? step.progress : 'patterns'
        const events =
          progress === 'json-events'
            ? this.progressEvents(op, sc.label)
            : typeof step.progress === 'object'
              ? this.progressPatterns(op, sc.label, step.progress.patterns)
              : null
        // Game files the step reads as a folder: a zip is unpacked for it and removed after it.
        const unpacked: string[] = []
        let code: number
        let tail: string[]
        try {
          for (const f of sc.folders ?? []) {
            if (!/\.zip$/i.test(f.file)) continue
            op.message = `${sc.label}: unpacking ${basename(f.file)}…`
            await this.changed(op)
            await fs.rm(f.folder, { recursive: true, force: true })
            unpacked.push(f.folder)
            const { files } = await extractZip({ archive: f.file, destDir: f.folder, stripRoot: false, signal, log: (l) => void this.log(op, l), onProgress: () => {} })
            await this.log(op, `Unpacked ${files} files of ${f.file} into ${f.folder}`)
          }
          op.message = `${sc.label}…`
          await this.changed(op)
          ;({ code, tail } = await runScript({
            script: full,
            args: sc.args,
            cwd,
            env: stepEnv,
            signal,
            log: (l) => void this.log(op, l),
            onLine: events?.onLine
          }))
        } catch (err) {
          if (!sc.optional || signal.aborted) throw err
          code = -1
          tail = [err instanceof Error ? err.message : String(err)]
        } finally {
          for (const dir of unpacked) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
        }
        if (code !== 0) {
          const reported = events?.error()
          const why = reported ?? `${sc.command} exited with code ${code}${tail.length ? `: ${tail.slice(-3).join(' / ')}` : ''}`
          if (!sc.optional) throw new Error(why)
          // An optional part: go on without it, and say so on the operation.
          const note = step.optionalNote ?? `${sc.label} did not finish; installed without it.`
          op.warnings = [...(op.warnings ?? []), `${note} (${lastErrorLine(tail) ?? why})`]
          await this.log(op, `Optional step skipped: ${lastErrorLine(tail) ?? why}`)
          await this.changed(op)
          continue
        }
        await this.log(op, `${sc.command} finished`)
      }
      op.build = { done: scripts.length, total: scripts.length, percent: null }
      this.setStep(op, 'build', 'done')
    }

    // An extra: check its files are there; the installation itself stays as it was recorded.
    if (extra) {
      this.setStep(op, 'configure', 'active')
      op.message = 'Checking what was made…'
      await this.changed(op)
      const made = await findOutputs(target, extra.done)
      if (!made.length) throw new Error(`${extra.name} did not finish: ${extra.done.join(', ')} was not made. Retry continues where it stopped.`)
      await this.log(op, `Found ${made.slice(0, 5).join(', ')}`)
      this.setStep(op, 'configure', 'done')
      await this.log(op, `${extra.name} of ${project.name} made`)
      return
    }

    // Configure: find what to launch.
    this.setStep(op, 'configure', 'active')
    op.message = 'Locating the game…'
    await this.changed(op)
    let executable = project.install.output.executable?.[platform]
    const locate = project.install.steps.find((s) => s.type === 'locateOutput')
    if (locate && locate.type === 'locateOutput') {
      const found = await findOutputs(target, locate.patterns)
      if (found.length) {
        await this.log(op, `Found output: ${found.slice(0, 5).join(', ')}`)
        // A game played through its server (`serve`) or a tool (`launch`) has no file to launch: the output only proves the build finished.
        if (!executable && !project.install.output.serve && !project.install.output.launch) executable = found.find((f) => f.toLowerCase().endsWith('.exe')) ?? found[0]
      } else if (locate.required) {
        throw new Error(`The expected output was not found (${locate.patterns.join(', ')})`)
      } else {
        await this.log(op, 'Output not found yet — the project setup window finishes the build. It can be launched later from the project page.')
      }
    }
    this.setStep(op, 'configure', 'done')

    // Finalize: remember the installed version.
    this.setStep(op, 'finalize', 'active')
    await this.changed(op)
    const previous = (await this.installed.all())[op.projectId]
    await this.installed.set({
      projectId: op.projectId,
      version: op.version,
      installedAt: op.kind === 'build' && previous ? previous.installedAt : new Date().toISOString(),
      installPath: target,
      downloadPath: op.outputDir ? dirname(op.outputDir) : previous?.downloadPath,
      executable,
      versionSource: 'hub',
      ...(previous?.adopted && previous.installPath === target ? { adopted: true } : {})
    })
    // Remember what this build used, so the hub can tell when it should be built again.
    const used = await this.planner.builtWith(project)
    if (used) await this.installed.set({ ...(await this.installed.all())[op.projectId]!, builtWith: used })
    // An add-on that built its host (`buildHost`): the host is now built with it.
    const into = project.install.installInto
    if (into && project.install.steps.some((s) => s.type === 'buildHost')) {
      const hostRec = (await this.installed.all())[into.project]
      const host = hostRec ? await this.planner.project(into.project).catch(() => null) : null
      const hostUsed = host ? await this.planner.builtWith(host) : null
      if (hostRec && hostUsed) await this.installed.set({ ...hostRec, builtWith: hostUsed })
    }
    await writeMarker(target, { projectId: op.projectId, version: op.version, tag: op.tag, installedAt: new Date().toISOString() })
    await this.log(op, op.kind === 'build' ? `Build of ${project.name} ${op.tag} finished` : `Recorded ${project.name} ${op.tag} as installed`)
    this.setStep(op, 'finalize', 'done')
  }

  /**
   * Parser for scripts that report progress as JSON lines
   * (`{"event":"status","message":…,"detail":…}`). Headlines go to the log;
   * the fast-changing detail only to the operation's status line.
   */
  private progressEvents(op: Operation, label: string) {
    let headline = label
    let error: string | null = null
    const onLine = (line: string): boolean => {
      const t = line.trim()
      if (!t.startsWith('{')) return false
      let ev: { event?: unknown; message?: unknown; detail?: unknown }
      try {
        ev = JSON.parse(t)
      } catch {
        return false
      }
      if (typeof ev.event !== 'string') return false
      const message = typeof ev.message === 'string' ? ev.message : null
      const detail = typeof ev.detail === 'string' ? ev.detail : null
      const pct = (ev as { percent?: unknown }).percent
      if (typeof pct === 'number' && Number.isFinite(pct) && op.build) op.build.percent = Math.max(0, Math.min(100, pct))
      if (ev.event === 'error') {
        error = message ?? 'The build stopped.'
        void this.log(op, `Project reported an error: ${error}`)
        return true
      }
      if (message && message !== headline) {
        headline = message
        void this.log(op, `» ${headline}${detail ? ` — ${detail}` : ''}`)
      }
      op.message = detail ? `${headline} — ${detail}` : headline
      this.emit()
      return true
    }
    return { onLine, error: () => error }
  }

  /**
   * Status from plain output lines matched by the registry's patterns
   * (`$1`… are the groups). Unmatched lines go to the log as usual.
   */
  private progressPatterns(op: Operation, label: string, patterns: ProgressPattern[]) {
    const compiled = patterns.flatMap((p) => {
      try {
        return [{ ...p, re: new RegExp(p.match) }]
      } catch {
        return []
      }
    })
    let headline = label
    const fill = (template: string, m: RegExpMatchArray) => template.replace(/\$(\d)/g, (_x, n: string) => (m[Number(n)] ?? '').replace(/_/g, ' '))
    const onLine = (line: string): boolean => {
      for (const p of compiled) {
        const m = line.match(p.re)
        if (!m) continue
        const message = p.message ? fill(p.message, m) : null
        const pct = p.percent ? Number.parseFloat(fill(p.percent, m)) : NaN
        if (Number.isFinite(pct) && op.build) op.build.percent = Math.max(0, Math.min(100, pct))
        const detail = p.detail ? fill(p.detail, m) : null
        if (message && message !== headline) {
          headline = message
          void this.log(op, `» ${headline}`)
        }
        op.message = detail ? `${headline} — ${detail}` : headline
        this.emit()
        if (p.log) void this.log(op, `| ${line}`)
        return true
      }
      return false
    }
    return { onLine, error: () => null as string | null }
  }

  private async finishCancelled(op: Operation, emit = true): Promise<void> {
    const settings = await this.settings.get()
    const part = join(settings.directories.downloads, op.projectId, `${op.file.name}.part`)
    await fs.rm(part, { force: true }).catch(() => {})
    op.status = 'cancelled'
    op.message = 'Cancelled'
    op.received = 0
    op.finishedAt = new Date().toISOString()
    for (const s of op.steps) if (s.state === 'active') s.state = 'pending'
    await this.log(op, 'Cancelled by user; partial download removed')
    if (emit) await this.changed(op)
  }

  private async ensureSpace(dir: string, bytes: number): Promise<void> {
    if (!bytes) return
    try {
      const s = await fs.statfs(dir)
      const free = s.bavail * s.bsize
      // Archive + extracted copy, with headroom.
      if (free < bytes * 2.5) {
        throw new Error(`Not enough free space: ${(free / 1e9).toFixed(1)} GB free, about ${((bytes * 2.5) / 1e9).toFixed(1)} GB needed`)
      }
    } catch (err) {
      if (err instanceof Error && /Not enough free space/.test(err.message)) throw err
      // statfs unsupported: carry on, ENOSPC is still caught later.
    }
  }

  /** Smoothed bytes/second and ETA, sampled at most twice a second. */
  private speedMeter(op: Operation): (received: number) => void {
    let lastT = Date.now()
    let lastB = op.received
    return (received) => {
      const now = Date.now()
      const dt = (now - lastT) / 1000
      if (dt < 0.5) return
      const inst = (received - lastB) / dt
      op.speed = op.speed ? op.speed * 0.7 + inst * 0.3 : inst
      op.etaSeconds = op.total > 0 && op.speed > 0 ? Math.round((op.total - received) / op.speed) : null
      lastT = now
      lastB = received
    }
  }

  private setStep(op: Operation, id: OperationStepId, state: OperationStep['state']): void {
    const s = op.steps.find((x) => x.id === id)
    if (s) s.state = state
  }

  private logFile(id: string): string {
    return join(paths.userData(), 'logs', `${id}.log`)
  }

  private async log(op: Operation, line: string): Promise<void> {
    const text = `[${new Date().toISOString()}] ${line}\n`
    try {
      await fs.mkdir(join(paths.userData(), 'logs'), { recursive: true })
      await fs.appendFile(this.logFile(op.id), text, 'utf8')
    } catch {
      /* logging must never break an operation */
    }
  }

  private syncProjectFlags(): void {
    this.updates.busy.clear()
    this.updates.failed.clear()
    const latestPerProject = new Map<string, Operation>()
    for (const op of this.ops) if (!latestPerProject.has(op.projectId)) latestPerProject.set(op.projectId, op)
    for (const [pid, op] of latestPerProject) {
      if (op.status === 'queued' || op.status === 'running') this.updates.busy.add(pid)
      if (op.status === 'failed') this.updates.failed.add(pid)
    }
  }

  /** A status or step changed: persist, refresh project statuses, emit now. */
  private async changed(op: Operation): Promise<void> {
    op.updatedAt = new Date().toISOString()
    await this.persist()
    this.syncProjectFlags()
    void this.updates.emit()
    this.emit(true)
  }

  private async persist(): Promise<void> {
    await this.store.write({ operations: this.ops.slice(0, 100) })
  }

  private emit(now = false): void {
    const fire = () => {
      this.emitTimer = null
      this.lastEmit = Date.now()
      const snapshot = this.ops.map((o) => ({ ...o, steps: o.steps.map((s) => ({ ...s })) }))
      this.listeners.forEach((l) => l(snapshot))
    }
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      fire()
      return
    }
    if (this.emitTimer) return
    const wait = Math.max(0, EMIT_INTERVAL_MS - (Date.now() - this.lastEmit))
    this.emitTimer = setTimeout(fire, wait)
  }
}

/**
 * The message of the last `…Error: message` line of a command's output (a
 * Node.js stack trace ends with the Node version, not the error), or null.
 */
export function lastErrorLine(tail: string[]): string | null {
  for (let i = tail.length - 1; i >= 0; i--) {
    const m = /(?:^|\b)[A-Za-z]*Error(?: \[[A-Z_]+\])?: (.+)$/.exec(tail[i].trim())
    if (m) return m[1].trim()
  }
  return null
}
