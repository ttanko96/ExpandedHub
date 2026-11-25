import type { GameDefinition, ProjectDefinition } from './registry-schema'

export interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
  contentType?: string
}

export interface ReleaseInfo {
  /** Normalized version, e.g. `1.5.1`. */
  version: string
  tag: string
  name: string
  publishedAt: string
  notes: string
  htmlUrl: string
  zipballUrl?: string
  prerelease: boolean
  assets: ReleaseAsset[]
}

export interface CommitInfo {
  sha: string
  message: string
  author: string
  date: string
  htmlUrl: string
}

export interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt: string
  authenticated: boolean
}

export interface InstalledRecord {
  projectId: string
  version: string
  /** The release tag it was installed from (`commit-1403737` for a commit), when the hub installed it. */
  tag?: string
  installedAt: string
  installPath: string
  /** Launchable file, relative to installPath, when known. */
  executable?: string
  /** Folder holding the downloaded package, so it can be cleaned up even after the downloads directory changes. */
  downloadPath?: string
  /**
   * The user pointed the hub at an installation they already had (Browse… on the
   * Mods page). The hub plays, builds and updates it in place, but never deletes it.
   */
  adopted?: boolean
  /**
   * Where `version` comes from: `hub` (installed or updated by the hub), `marker`
   * (the hub's `.expandedhub.json` in the folder), `file` (a version file the
   * registry names), `git` (the checkout's tags or commit), `unknown` (could not
   * be told; any release counts as an update).
   */
  versionSource?: VersionSource
  /** What its last build used, recorded by the hub; absent when not known (linked, or an older hub). */
  builtWith?: BuiltWith
}

/** The inputs of a build, to tell when it should be built again. */
export interface BuiltWith {
  /** Game files it took: gameId → `path|size`. */
  sources: Record<string, string>
  /** Add-ons inside it: projectId → version. */
  addons: Record<string, string>
}

export type VersionSource = 'hub' | 'marker' | 'file' | 'git' | 'unknown'

/** One release in a What's new window. */
export interface ChangelogRelease {
  version: string
  tag: string
  name: string
  publishedAt: string
  /** The release notes (Markdown); for a commit, its message. */
  notes: string
  htmlUrl: string
}

/**
 * What changed in an update, shown once in the What's new window: a project the
 * hub updated, or ExpandedHub itself after it restarted on a newer version.
 */
export interface ChangelogEntry {
  id: string
  /** The project, or `expandedhub` for the hub itself. */
  projectId: string
  name: string
  /** The version it came from, as shown (`v1.5.0`, `commit 93e79b7`); null when not known. */
  from: string | null
  /** The raw version it came from, for joining a later update into this entry. */
  fromVersion: string | null
  to: string
  /** The releases after `from` up to `to`, newest first. */
  releases: ChangelogRelease[]
  /** Not every release in between is listed (only the latest few are kept): the rest are on this page. */
  moreUrl: string | null
  createdAt: string
}

/** A drafted GitHub issue for a project, shown to the user before it is opened on GitHub. */
export interface IssueReport {
  /** Suggested title; empty when there is nothing to suggest. */
  title: string
  /** Markdown body: a place for the user's words, then what the hub knows about the setup. */
  body: string
  /** The repository's new-issue page. */
  url: string
}

/** What linking an existing installation found. */
export interface AdoptResult {
  record: InstalledRecord
  /** How the version was found, for the user. */
  detail: string
  /** Add-ons found inside it and linked too (names). */
  addons: string[]
  /** Add-ons that were linked inside its previous folder and are not in this one (names): forgotten, never deleted. */
  unlinked: string[]
}

/** Lifecycle status shown on every project. */
export type ProjectStatus =
  | 'not-installed' // no release info available yet (offline, no releases…)
  | 'install-available'
  | 'update-available'
  | 'installing'
  | 'failed'
  | 'up-to-date'

export interface ProjectState {
  projectId: string
  status: ProjectStatus
  installed: InstalledRecord | null
  latest: ReleaseInfo | null
  /** Latest commit, only known when the repository has no matching release. */
  latestCommit: CommitInfo | null
  /** GitHub stars of the repository (how many people like it); null until known. */
  stars: number | null
  /** ISO timestamp of the last successful release fetch for this project. */
  checkedAt: string | null
  error: string | null
  /** What changed since its last build (add-ons, game files): Build again brings it in. Empty when nothing did. */
  rebuild: string[]
  /** It is installed, but its folder is not there (moved, deleted, or on a drive that is not connected). */
  missing: boolean
}

export interface RegistryIssue {
  file: string
  message: string
}

export interface RegistrySnapshot {
  projects: ProjectDefinition[]
  games: GameDefinition[]
  issues: RegistryIssue[]
}

export interface UpdateCheckSummary {
  running: boolean
  lastSuccessAt: string | null
  lastError: string | null
  /** Where release data comes from right now. */
  source: 'mock' | 'github'
  rateLimit: RateLimitInfo | null
  /** Whether a GitHub token is stored (the token itself never leaves the main process). */
  hasToken: boolean
}

export interface TokenValidation {
  ok: boolean
  message: string
  login?: string
}

export interface AppSettings {
  general: {
    theme: 'dark' | 'light'
    launchOnStartup: boolean
    autoCheckUpdates: boolean
    /** Minutes between background update checks. */
    checkIntervalMinutes: number
  }
  directories: {
    downloads: string
    installs: string
    temp: string
    buildEnv: string
  }
  advanced: {
    debug: boolean
    /** Use bundled demo release data instead of the GitHub API (offline UI work). */
    demoMode: boolean
  }
  onboarding: {
    /** The first-start window for choosing game files was shown (and closed). */
    gameFilesPrompted: boolean
  }
  dojo: {
    /** Show fighter portraits from the player's own Tekken 3 Expanded installation. */
    portraits: boolean
  }
}

/** The Dojo's fighter portraits available now (see `@shared/dojo-portraits`). */
export interface DojoPortraits {
  /** The switch in Settings → Dojo. */
  enabled: boolean
  /** The installation they come from; null when none has them. */
  source: 'tekken3-expanded' | null
  /** Fighter id → `expandedhub-media://portrait/...` URL. */
  portraits: Record<string, string>
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  electron: string
  userDataPath: string
}

/** The hub's own GitHub repository, where new ExpandedHub versions are released. */
export const HUB_REPOSITORY = { owner: 'ttanko96', name: 'ExpandedHub' } as const

/** State of the hub's self-update (shown in the top bar). */
export interface HubUpdateState {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'installing' | 'error'
  currentVersion: string
  latest: { version: string; tag: string; htmlUrl: string; publishedAt: string } | null
  /** False when the update can only be opened on GitHub (dev build, zip copy, no installer in the release). */
  canInstall: boolean
  /** 0..1 while downloading; null when the size is unknown. */
  progress: number | null
  error: string | null
  checkedAt: string | null
}
