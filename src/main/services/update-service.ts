import { promises as fs } from 'node:fs'
import { isTracked } from '@shared/registry-schema'
import { commitRelease, computeStatus } from '@shared/status'
import type { ProjectState, RateLimitInfo, ReleaseInfo, TokenValidation, UpdateCheckSummary } from '@shared/types'
import type { InstalledService } from './installed-service'
import { JsonStore } from './json-store'
import { log } from './logger'
import { paths } from './paths'
import type { RegistryService } from './registry-service'
import { GitHubReleaseProvider } from './releases/github-release-provider'
import { MockReleaseProvider } from './releases/mock-release-provider'
import { ProviderError, type ReleaseProvider, type RepoSnapshot } from './releases/release-provider'
import type { SettingsService } from './settings-service'
import { builtWith, rebuildReasons } from './install/built-with'
import type { SourcesService } from './install/sources-service'
import type { TokenStore } from './token-store'

interface CacheEntry {
  snapshot: RepoSnapshot | null
  /** Last successful fetch (also refreshed by 304 Not Modified answers). */
  fetchedAt: string | null
  error: string | null
}

interface ReleaseCache {
  version: 2
  source: UpdateCheckSummary['source']
  lastSuccessAt: string | null
  rateLimit: RateLimitInfo | null
  entries: Record<string, CacheEntry>
}

/** A cached result younger than this is reused by automatic (non-forced) checks. */
const CACHE_TTL_MS = 10 * 60 * 1000

const emptyCache = (source: UpdateCheckSummary['source']): ReleaseCache => ({
  version: 2,
  source,
  lastSuccessAt: null,
  rateLimit: null,
  entries: {}
})

/**
 * Checks every registry project for new releases, caches the results and
 * derives each project's status. Runs on startup, on a configurable interval,
 * and on demand. Pushes changes to the renderer through the listeners.
 */
export class UpdateService {
  private cache = new JsonStore<ReleaseCache>(paths.releaseCacheFile(), () => emptyCache('github'))
  private running: Promise<void> | null = null
  private lastError: string | null = null
  private timer: NodeJS.Timeout | null = null
  private stateListeners = new Set<(s: ProjectState[]) => void>()
  private summaryListeners = new Set<(s: UpdateCheckSummary) => void>()
  /** Projects with an active operation / last failed operation (filled by the installer in phases 3–4). */
  readonly busy = new Set<string>()
  readonly failed = new Set<string>()

  constructor(
    private readonly registry: RegistryService,
    private readonly installed: InstalledService,
    private readonly settings: SettingsService,
    private readonly tokens: TokenStore,
    private readonly sources?: Pick<SourcesService, 'list'>
  ) {}

  private async source(): Promise<UpdateCheckSummary['source']> {
    return (await this.settings.get()).advanced.demoMode ? 'mock' : 'github'
  }

  private async readCache(): Promise<ReleaseCache> {
    const c = await this.cache.read()
    // Discard caches from older app versions or from the other source.
    if (c.version !== 2 || c.source !== (await this.source())) return emptyCache(await this.source())
    return c
  }

  private async provider(cache: ReleaseCache): Promise<ReleaseProvider> {
    if ((await this.source()) === 'mock') return new MockReleaseProvider()
    const p = new GitHubReleaseProvider(await this.tokens.get())
    p.seedRateLimit(cache.rateLimit)
    return p
  }

  async start(): Promise<void> {
    await this.reschedule()
    this.settings.onChange(() => void this.reschedule())
    if ((await this.settings.get()).general.autoCheckUpdates) void this.check(false)
  }

  private async reschedule(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const s = await this.settings.get()
    if (!s.general.autoCheckUpdates) return
    this.timer = setInterval(() => void this.check(false), s.general.checkIntervalMinutes * 60 * 1000)
  }

  async check(force: boolean): Promise<UpdateCheckSummary> {
    if (!this.running) {
      this.running = this.runCheck(force)
        .catch((err) => {
          log('error', 'Update check crashed', err)
          this.lastError = `Update check failed: ${err instanceof Error ? err.message : String(err)}`
        })
        .finally(() => {
          this.running = null
          void this.emit()
        })
      void this.emitSummary()
    }
    await this.running
    return this.summary()
  }

  private async runCheck(force: boolean): Promise<void> {
    const cache = await this.readCache()
    const provider = await this.provider(cache)
    const { projects } = await this.registry.get()

    const now = Date.now()
    const due = projects.filter(isTracked).filter((p) => {
      const e = cache.entries[p.id]
      const pinChanged = (e?.snapshot?.pinned ?? null) !== (p.repository.pinTag ?? null)
      return force || pinChanged || !e?.fetchedAt || e.error || now - Date.parse(e.fetchedAt) > CACHE_TTL_MS
    })

    let failures = 0
    let stopped: ProviderError | null = null
    // Sequential on purpose: a handful of requests, and we can stop at the first rate-limit answer.
    for (const p of due) {
      const prev = cache.entries[p.id]
      if (stopped) {
        cache.entries[p.id] = { ...(prev ?? { snapshot: null, fetchedAt: null }), error: stopped.message }
        failures++
        continue
      }
      try {
        const snapshot = await provider.fetch(p.repository, prev?.snapshot ?? undefined)
        cache.entries[p.id] = { snapshot, fetchedAt: new Date().toISOString(), error: null }
      } catch (err) {
        failures++
        const message = err instanceof Error ? err.message : String(err)
        // Keep the last known data so the UI stays useful offline.
        cache.entries[p.id] = { snapshot: prev?.snapshot ?? null, fetchedAt: prev?.fetchedAt ?? null, error: message }
        if (err instanceof ProviderError && (err.kind === 'rate-limit' || err.kind === 'auth' || err.kind === 'network')) {
          stopped = err
        }
      }
    }

    cache.rateLimit = provider.rateLimit()
    if (failures === 0) {
      cache.lastSuccessAt = new Date().toISOString()
      this.lastError = null
    } else if (stopped?.kind === 'rate-limit') {
      const at = stopped.retryAt ? new Date(stopped.retryAt).toLocaleTimeString() : 'later'
      this.lastError = `GitHub rate limit reached — showing cached data until ${at}. A token in Settings → GitHub raises the limit.`
    } else if (stopped) {
      this.lastError = stopped.message
    } else {
      this.lastError = `${failures} of ${due.length} repositories could not be checked`
    }
    await this.cache.write(cache)
  }

  async summary(): Promise<UpdateCheckSummary> {
    const cache = await this.readCache()
    return {
      running: this.running !== null,
      lastSuccessAt: cache.lastSuccessAt,
      lastError: this.lastError,
      source: cache.source,
      rateLimit: cache.rateLimit,
      hasToken: (await this.tokens.get()) !== null
    }
  }

  async states(): Promise<ProjectState[]> {
    const { projects, games } = await this.registry.get()
    const cache = await this.readCache()
    const installed = await this.installed.all()
    const sources = (await this.sources?.list()) ?? []
    const missing = new Set<string>()
    for (const rec of Object.values(installed)) {
      if (!(await fs.stat(rec.installPath).then((s) => s.isDirectory(), () => false))) missing.add(rec.projectId)
    }
    return projects.map((p) => {
      const e = cache.entries[p.id]
      const rec = installed[p.id] ?? null
      // A source-build project without releases installs its latest commit.
      const fromSource = p.install?.steps.some((s) => s.type === 'download' && s.from === 'source') ?? false
      const commit = e?.snapshot?.commit ?? null
      const latest = e?.snapshot?.release ?? (fromSource && commit && p.repository ? commitRelease(commit, p.repository) : null)
      return {
        projectId: p.id,
        status: computeStatus({ installed: rec, latest, busy: this.busy.has(p.id), failed: this.failed.has(p.id) }),
        installed: rec,
        latest,
        latestCommit: e?.snapshot?.commit ?? null,
        stars: e?.snapshot?.stars ?? null,
        checkedAt: e?.fetchedAt ?? null,
        error: e?.error ?? null,
        missing: missing.has(p.id),
        rebuild: rec && !missing.has(p.id) ? rebuildReasons(rec.builtWith, builtWith(p, projects, installed, sources), projects, games) : []
      }
    })
  }

  /**
   * A project's release by version: the latest, or one of the older ones kept
   * from the last check (for installing an earlier version). Null when unknown.
   */
  async release(projectId: string, version?: string): Promise<ReleaseInfo | null> {
    const all = await this.releases(projectId)
    return version ? (all.find((r) => r.version === version) ?? null) : (all[0] ?? null)
  }

  /**
   * The latest release and the older ones kept, newest first. A project that
   * installs its latest commit (no releases) gets the commits before it instead.
   */
  async releases(projectId: string): Promise<ReleaseInfo[]> {
    const latest = (await this.states()).find((s) => s.projectId === projectId)?.latest ?? null
    if (!latest) return []
    const snapshot = (await this.readCache()).entries[projectId]?.snapshot
    const repo = (await this.registry.get()).projects.find((p) => p.id === projectId)?.repository
    const older = snapshot?.release
      ? (snapshot.older ?? [])
      : repo
        ? (snapshot?.olderCommits ?? []).map((c) => ({ ...commitRelease(c, repo), name: `Commit ${c.sha.slice(0, 7)}: ${c.message}` }))
        : []
    return [latest, ...older.filter((r) => r.version !== latest.version)]
  }

  /** Store or remove the GitHub token. A new token is validated first, then a fresh check runs. */
  async setToken(token: string | null): Promise<TokenValidation> {
    if (token === null || token.trim() === '') {
      await this.tokens.clear()
      await this.resetRateLimit()
      void this.check(true)
      return { ok: true, message: 'Token removed. Using anonymous access (60 requests/hour).' }
    }
    const result = await GitHubReleaseProvider.validateToken(token.trim())
    if (!result.ok) return result
    const persisted = await this.tokens.set(token.trim())
    await this.resetRateLimit()
    void this.check(true)
    return persisted
      ? { ...result, message: `${result.message}. Stored encrypted.` }
      : { ...result, message: `${result.message}. OS encryption is unavailable, so the token is kept for this session only.` }
  }

  private async resetRateLimit(): Promise<void> {
    const c = await this.cache.read()
    await this.cache.write({ ...c, rateLimit: null })
  }

  onStates(l: (s: ProjectState[]) => void): () => void {
    this.stateListeners.add(l)
    return () => this.stateListeners.delete(l)
  }

  onSummary(l: (s: UpdateCheckSummary) => void): () => void {
    this.summaryListeners.add(l)
    return () => this.summaryListeners.delete(l)
  }

  async emit(): Promise<void> {
    const states = await this.states()
    this.stateListeners.forEach((l) => l(states))
    await this.emitSummary()
  }

  private async emitSummary(): Promise<void> {
    const s = await this.summary()
    this.summaryListeners.forEach((l) => l(s))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
