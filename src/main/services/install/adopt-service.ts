import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { isInstallable, type InstallableProject, type OsPlatform } from '@shared/registry-schema'
import type { AdoptResult, InstalledRecord } from '@shared/types'
import type { InstalledService } from '../installed-service'
import { log } from '../logger'
import type { RegistryService } from '../registry-service'
import type { UpdateService } from '../update-service'
import { checkFolder, detectVersion, locateExecutable } from './detect-version'

const samePath = (a: string, b: string) => {
  const n = (p: string) => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b)
}

/**
 * Links installations the user already has (made by hand, by an older hub, or
 * elsewhere) to the hub: the folder is checked to be the project, its version
 * is read, and from then on the hub plays, builds and updates it in place.
 * Linked folders are never deleted by Uninstall; only the record is forgotten.
 */
export class AdoptService {
  constructor(
    private readonly registry: RegistryService,
    private readonly installed: InstalledService,
    private readonly updates: UpdateService,
    private readonly platform: OsPlatform = process.platform as OsPlatform
  ) {}

  private async project(id: string): Promise<InstallableProject> {
    const p = (await this.registry.get()).projects.find((x) => x.id === id)
    if (!p) throw new Error(`Unknown project "${id}"`)
    if (!isInstallable(p)) throw new Error(`${p.name} is not managed by the hub yet.`)
    return p
  }

  /** Where an add-on has to be: inside its host's installation. Null for other projects. */
  async expectedFolder(projectId: string): Promise<string | null> {
    const into = (await this.project(projectId)).install.installInto
    if (!into) return null
    const host = (await this.installed.all())[into.project]
    if (!host) {
      const name = (await this.registry.get()).projects.find((p) => p.id === into.project)?.name ?? into.project
      throw new Error(`Link or install ${name} first — this add-on lives inside it.`)
    }
    return join(host.installPath, ...into.subdir.split('/'))
  }

  /** Link `folder` as the installation of `projectId`. Throws with a readable reason when it is not that project. */
  async adopt(projectId: string, folder: string): Promise<AdoptResult> {
    const project = await this.project(projectId)
    const dir = resolve(folder)
    const st = await fs.stat(dir).catch(() => null)
    if (!st?.isDirectory()) throw new Error(`${dir} is not a folder.`)

    const expected = await this.expectedFolder(projectId)
    if (expected && !samePath(expected, dir)) throw new Error(`${project.name} has to be in ${expected}.`)

    const all = await this.installed.all()
    const taken = Object.values(all).find((r) => r.projectId !== projectId && samePath(r.installPath, dir))
    if (taken) {
      const name = (await this.registry.get()).projects.find((p) => p.id === taken.projectId)?.name ?? taken.projectId
      throw new Error(`This folder is already the installation of ${name}.`)
    }

    const check = await checkFolder(project, dir, this.platform)
    if (!check.ok) {
      throw new Error(`This does not look like ${project.name}: none of ${check.expected.slice(0, 4).join(', ')} is in it. Choose the folder that holds them.`)
    }

    const { record, detail } = await this.record(project, dir, all[projectId])
    await this.installed.set(record)
    log('info', `Linked existing installation of ${project.name} in ${dir}: ${detail}`)

    // Add-ons follow their host: the ones inside it are linked, ones left in its previous folder forgotten.
    const { linked: addons, unlinked } = await this.syncAddons(projectId, dir)

    await this.updates.emit()
    return { record, detail, addons, unlinked }
  }

  /**
   * Point the add-ons of host `hostId` at `hostDir`: an add-on recorded somewhere
   * else (its host's previous folder) is linked to its subfolder here when it is
   * there, and forgotten otherwise (its files are left alone). Add-ons not
   * recorded yet are linked when they are found inside.
   */
  private async syncAddons(hostId: string, hostDir: string): Promise<{ linked: string[]; unlinked: string[] }> {
    const linked: string[] = []
    const unlinked: string[] = []
    for (const p of (await this.registry.get()).projects) {
      if (!isInstallable(p) || p.install.installInto?.project !== hostId) continue
      const sub = join(hostDir, ...p.install.installInto.subdir.split('/'))
      const rec = (await this.installed.all())[p.id]
      if (rec && samePath(rec.installPath, sub)) continue
      const there = (await fs.stat(sub).then((s) => s.isDirectory(), () => false)) && (await checkFolder(p, sub, this.platform)).ok
      if (there) {
        const r = await this.record(p, sub, rec)
        await this.installed.set(r.record)
        linked.push(p.name)
        log('info', `Linked add-on ${p.name} in ${sub}: ${r.detail}${rec ? ` (was ${rec.installPath})` : ''}`)
      } else if (rec) {
        await this.installed.remove(p.id)
        unlinked.push(p.name)
        log('info', `Forgot add-on ${p.name} in ${rec.installPath}: it is not in its host's folder ${hostDir}`)
      }
    }
    return { linked, unlinked }
  }

  private async record(project: InstallableProject, dir: string, previous: InstalledRecord | undefined): Promise<{ record: InstalledRecord; detail: string }> {
    const latest = (await this.updates.states()).find((s) => s.projectId === project.id)?.latest ?? null
    const v = await detectVersion(project, dir, latest)
    return {
      detail: v.detail,
      record: {
        projectId: project.id,
        version: v.version,
        versionSource: v.source,
        installedAt: (await fs.stat(dir).then((s) => s.birthtime.toISOString(), () => null)) ?? new Date().toISOString(),
        installPath: dir,
        executable: await locateExecutable(project, dir, this.platform),
        downloadPath: previous && samePath(previous.installPath, dir) ? previous.downloadPath : undefined,
        adopted: true
      }
    }
  }

  /**
   * Read the version of linked installations again (the user may have updated
   * one by hand, e.g. `git pull`). Ones the hub has installed into since keep
   * the version it recorded. Missing folders are left alone.
   */
  async rescan(): Promise<void> {
    const all = await this.installed.all()
    let changed = false
    for (const rec of Object.values(all)) {
      if (!rec.adopted || rec.versionSource === 'hub') continue
      try {
        const project = await this.project(rec.projectId)
        if (!(await fs.stat(rec.installPath).then((s) => s.isDirectory(), () => false))) continue
        const latest = (await this.updates.states()).find((s) => s.projectId === rec.projectId)?.latest ?? null
        const v = await detectVersion(project, rec.installPath, latest)
        if (v.version !== rec.version || v.source !== rec.versionSource) {
          await this.installed.set({ ...rec, version: v.version, versionSource: v.source })
          log('info', `Linked ${project.name}: version now ${v.detail}`)
          changed = true
        }
      } catch (err) {
        log('warn', `Could not re-read the version of ${rec.projectId}`, err)
      }
    }
    // Add-ons still recorded in a host's previous folder (it was changed with an older hub) follow it now.
    for (const host of Object.values(all)) {
      try {
        if (!(await fs.stat(host.installPath).then((s) => s.isDirectory(), () => false))) continue
        const r = await this.syncAddons(host.projectId, host.installPath)
        if (r.linked.length || r.unlinked.length) changed = true
      } catch (err) {
        log('warn', `Could not check the add-ons of ${host.projectId}`, err)
      }
    }
    if (changed) await this.updates.emit()
  }
}
