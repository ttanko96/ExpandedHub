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
}

export type VersionSource = 'hub' | 'marker' | 'file' | 'git' | 'unknown'

/** What linking an existing installation found. */
export interface AdoptResult {
  record: InstalledRecord
  /** How the version was found, for the user. */
  detail: string
  /** Add-ons found inside it and linked too (names). */
  addons: string[]
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
