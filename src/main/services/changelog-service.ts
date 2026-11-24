import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { formatVersion, isNewer, versionLabel } from '@shared/status'
import type { ChangelogEntry, ChangelogRelease, InstalledRecord, ReleaseInfo } from '@shared/types'
import { JsonStore } from './json-store'
import { log } from './logger'

/** The hub's own entries use this id. */
export const HUB_ID = 'expandedhub'

interface ChangelogFile {
  /** Entries not seen yet, oldest first. */
  pending: ChangelogEntry[]
  /** The hub version that ran last; null before the first start with this feature. */
  hubVersion: string | null
}

interface Deps {
  userData: string
  /** A project's name and repository, for the entry and its "more" link. */
  project: (id: string) => Promise<{ name: string; repository?: { owner: string; name: string } } | null>
  /** The project's releases the update check kept, newest first (with notes). */
  releases: (projectId: string) => Promise<ReleaseInfo[]>
  /** ExpandedHub's running version and its releases on GitHub, newest first (may throw when offline). */
  hubVersion: string
  hubReleases: () => Promise<ReleaseInfo[]>
  hubReleasesUrl: string
  /** Whether this start follows an earlier one (not a fresh install), for the first start with this feature. */
  usedBefore: () => Promise<boolean>
}

/**
 * Remembers what changed in each update until the user has seen it: a project
 * the hub updated (every release between the old and the new version), and
 * ExpandedHub itself after it restarted on a newer version.
 */
export class ChangelogService {
  private store: JsonStore<ChangelogFile>
  private listeners = new Set<(pending: ChangelogEntry[]) => void>()

  constructor(private readonly deps: Deps) {
    this.store = new JsonStore<ChangelogFile>(join(deps.userData, 'changelog.json'), () => ({ pending: [], hubVersion: null }))
  }

  async pending(): Promise<ChangelogEntry[]> {
    return (await this.store.read()).pending
  }

  async dismiss(id: string): Promise<void> {
    await this.store.update((f) => ({ ...f, pending: f.pending.filter((e) => e.id !== id) }))
    await this.emit()
  }

  onChange(l: (pending: ChangelogEntry[]) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  /**
   * A project was installed over `previous` at `version`. A newer version than
   * before gets an entry (a fresh install or going back to an earlier one does not);
   * an entry still unseen from an earlier update of it is extended.
   */
  async projectUpdated(projectId: string, previous: InstalledRecord | undefined, version: string, tag: string): Promise<void> {
    if (!previous) return
    const unknown = previous.versionSource === 'unknown'
    if (!unknown && !isNewer(version, previous.version)) return
    const project = await this.deps.project(projectId)
    if (!project) return
    const waiting = (await this.pending()).find((e) => e.projectId === projectId)
    const fromVersion = waiting ? waiting.fromVersion : unknown ? null : previous.version
    const from = waiting ? waiting.from : unknown ? null : versionLabel(previous)

    const all = await this.deps.releases(projectId)
    const target = all.find((r) => r.version === version)
    const list = fromVersion === null ? (target ? [target] : []) : all.filter((r) => isNewer(r.version, fromVersion) && !isNewer(r.version, version))
    // The oldest release kept is in the list, so there may be more in between that were not kept.
    const oldest = all[all.length - 1]
    const gap = fromVersion !== null && oldest !== undefined && list.includes(oldest) && all.length > 1
    const repo = project.repository
    const moreUrl = repo ? (tag.startsWith('commit-') ? `https://github.com/${repo.owner}/${repo.name}/commits` : `https://github.com/${repo.owner}/${repo.name}/releases`) : null

    await this.put({
      id: waiting?.id ?? randomUUID(),
      projectId,
      name: project.name,
      from,
      fromVersion,
      to: formatVersion(version, tag),
      releases: list.map(toRelease),
      moreUrl: gap || list.length === 0 ? moreUrl : null,
      createdAt: new Date().toISOString()
    })
    log('info', `What's new: ${project.name} ${from ?? '?'} → ${formatVersion(version, tag)} (${list.length} release(s))`)
  }

  /** At start: a newer hub than last time gets an entry with its release notes. */
  async hubStarted(): Promise<void> {
    const current = this.deps.hubVersion
    const { hubVersion: last } = await this.store.read()
    if (last === current) return
    await this.store.update((f) => ({ ...f, hubVersion: current }))
    // The first start with this feature: an update only when the hub was used before (not a fresh install).
    if (last === null ? !(await this.deps.usedBefore()) : !isNewer(current, last)) return

    let list: ChangelogRelease[] = []
    let failed = false
    try {
      const all = await this.deps.hubReleases()
      list = (last === null ? all.filter((r) => r.version === current) : all.filter((r) => isNewer(r.version, last) && !isNewer(r.version, current))).map(toRelease)
    } catch (err) {
      failed = true
      log('warn', `What's new: could not read ExpandedHub's release notes`, err)
    }
    await this.put({
      id: randomUUID(),
      projectId: HUB_ID,
      name: 'ExpandedHub',
      from: last === null ? null : formatVersion(last),
      fromVersion: last,
      to: formatVersion(current),
      releases: list,
      moreUrl: failed || list.length === 0 ? this.deps.hubReleasesUrl : null,
      createdAt: new Date().toISOString()
    })
  }

  private async put(entry: ChangelogEntry): Promise<void> {
    await this.store.update((f) => ({ ...f, pending: [...f.pending.filter((e) => e.id !== entry.id && e.projectId !== entry.projectId), entry] }))
    await this.emit()
  }

  private async emit(): Promise<void> {
    const pending = await this.pending()
    this.listeners.forEach((l) => l(pending))
  }
}

function toRelease(r: ReleaseInfo): ChangelogRelease {
  // A commit "release": its message, without the hub's note about installing commits.
  const notes = r.tag.startsWith('commit-') ? r.name.replace(/^(Latest commit|Commit) [0-9a-f]+: /, '') : r.notes
  return { version: r.version, tag: r.tag, name: r.name, publishedAt: r.publishedAt, notes, htmlUrl: r.htmlUrl }
}
