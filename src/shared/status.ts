import semver from 'semver'
import type { CommitInfo, InstalledRecord, ProjectStatus, ReleaseInfo } from './types'

/** Turn tags like `v1.5.1`, `release-1.5`, `1.5.1-beta` into comparable semver strings. */
export function normalizeVersion(tag: string): string {
  const cleaned = tag.trim().replace(/^[^0-9]*/, '')
  const parsed = semver.valid(cleaned) ?? semver.coerce(cleaned, { includePrerelease: true })?.version
  return parsed ?? cleaned
}

/** Returns true when `latest` is strictly newer than `installed`. Falls back to string inequality for non-semver tags. */
export function isNewer(latest: string, installed: string): boolean {
  const a = semver.valid(normalizeVersion(latest))
  const b = semver.valid(normalizeVersion(installed))
  if (a && b) return semver.gt(a, b)
  return normalizeVersion(latest) !== normalizeVersion(installed)
}

/**
 * The latest commit as an installable "release", for source-build projects
 * that publish none: the source archive of exactly that commit. Its version
 * is `0.0.0-<commit time as yyyymmddhhmmss>`, so a newer commit is an update.
 */
export function commitRelease(commit: CommitInfo, repo: { owner: string; name: string }): ReleaseInfo {
  const stamp = commit.date.replace(/\D/g, '').slice(0, 14).padEnd(14, '0')
  const short = commit.sha.slice(0, 7)
  return {
    version: `0.0.0-${stamp}`,
    tag: `commit-${short}`,
    name: `Latest commit ${short}: ${commit.message}`,
    publishedAt: commit.date,
    notes: `${commit.message}\n\nThis project has no releases yet; the hub installs its latest commit (${commit.sha}) by ${commit.author}.`,
    htmlUrl: commit.htmlUrl,
    zipballUrl: `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/zipball/${commit.sha}`,
    prerelease: false,
    assets: []
  }
}

/** `v1.5.1`, or `unknown version` for a linked installation whose version could not be told. */
export function versionLabel(rec: Pick<InstalledRecord, 'version' | 'versionSource'>): string {
  if (rec.versionSource === 'unknown') return 'unknown version'
  return rec.version.startsWith('v') ? rec.version : `v${rec.version}`
}

export function computeStatus(opts: {
  installed: InstalledRecord | null
  latest: ReleaseInfo | null
  busy: boolean
  failed: boolean
}): ProjectStatus {
  if (opts.busy) return 'installing'
  if (opts.failed) return 'failed'
  if (!opts.installed) return opts.latest ? 'install-available' : 'not-installed'
  // A linked installation whose version could not be told: offer the latest release.
  if (opts.installed.versionSource === 'unknown') return opts.latest ? 'update-available' : 'up-to-date'
  if (opts.latest && isNewer(opts.latest.version, opts.installed.version)) return 'update-available'
  return 'up-to-date'
}
