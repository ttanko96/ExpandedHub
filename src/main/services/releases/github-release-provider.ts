import { app } from 'electron'
import type { RepositoryRef } from '@shared/registry-schema'
import { normalizeVersion } from '@shared/status'
import type { CommitInfo, RateLimitInfo, ReleaseInfo } from '@shared/types'
import { ProviderError, type ReleaseProvider, type RepoSnapshot } from './release-provider'

const API = 'https://api.github.com'
const TIMEOUT_MS = 15_000

interface GhRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  zipball_url: string | null
  draft: boolean
  prerelease: boolean
  published_at: string | null
  created_at: string
  assets: { name: string; size: number; browser_download_url: string; content_type: string }[]
}

interface GhCommit {
  sha: string
  html_url: string
  commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null }
  author: { login: string } | null
}

/**
 * GitHub REST implementation.
 *
 * - Lists releases (one request covers stable, prerelease and tag filtering).
 * - Uses ETags: a `304 Not Modified` answer reuses the cached data and, for
 *   authenticated requests, does not count against the rate limit.
 * - Tracks `x-ratelimit-*` headers and refuses to call the API while the
 *   limit is exhausted.
 */
export class GitHubReleaseProvider implements ReleaseProvider {
  readonly id = 'github' as const
  private limit: RateLimitInfo | null = null

  constructor(private readonly token: string | null) {}

  rateLimit(): RateLimitInfo | null {
    return this.limit
  }

  /** Seed with the last known limit so a restart does not hammer an exhausted quota. */
  seedRateLimit(limit: RateLimitInfo | null): void {
    if (limit && limit.authenticated === (this.token !== null)) this.limit = limit
  }

  async fetch(repo: RepositoryRef, previous: RepoSnapshot | undefined): Promise<RepoSnapshot> {
    const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
    // A snapshot made under another pin cannot be reused: ask for the full list again.
    if (previous && (previous.pinned ?? null) !== (repo.pinTag ?? null)) previous = undefined
    // A snapshot from before older releases were kept is fetched in full once.
    const rel = await this.request<GhRelease[]>(`${base}/releases?per_page=30`, previous?.older ? previous.etags.releases : undefined)

    let release: ReleaseInfo | null
    let older: ReleaseInfo[]
    if (rel.notModified && previous) {
      release = previous.release
      older = previous.older ?? []
    } else {
      const all = pickReleases(rel.data ?? [], repo)
      release = all[0] ?? null
      older = all.slice(1, 11).map((r) => ({ ...r, notes: '' }))
    }

    const etags: RepoSnapshot['etags'] = { releases: rel.etag ?? previous?.etags.releases }
    let commit: CommitInfo | null = null
    let olderCommits: CommitInfo[] | undefined
    if (!release) {
      // No usable release: show the latest commit so the user still sees activity. The ten before it
      // come in the same request, for installing an earlier one (a snapshot without them is fetched in full once).
      const c = await this.request<GhCommit[]>(`${base}/commits?per_page=11`, previous?.olderCommits ? previous.etags.commits : undefined)
      etags.commits = c.etag ?? previous?.etags.commits
      if (c.notModified && previous) {
        commit = previous.commit
        olderCommits = previous.olderCommits ?? []
      } else {
        const list = (c.data ?? []).map(toCommit)
        commit = list[0] ?? null
        olderCommits = list.slice(1)
      }
    }
    // Stars: how many people like the repository. Optional, so a failure here never hides the release.
    let stars = previous?.stars ?? null
    try {
      const r = await this.request<{ stargazers_count?: number }>(base, previous?.etags.repo)
      etags.repo = r.etag ?? previous?.etags.repo
      if (!r.notModified && typeof r.data?.stargazers_count === 'number') stars = r.data.stargazers_count
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'rate-limit') throw err
    }
    return { release, older, commit, olderCommits, etags, pinned: repo.pinTag ?? null, stars }
  }

  /** Check a token against the API without storing it. */
  static async validateToken(token: string): Promise<{ ok: boolean; message: string; login?: string }> {
    try {
      const res = await fetchWithTimeout(`${API}/user`, { headers: headers(token) })
      if (res.status === 401) return { ok: false, message: 'GitHub rejected this token (401).' }
      if (!res.ok) return { ok: false, message: `GitHub answered ${res.status}.` }
      const user = (await res.json()) as { login?: string }
      const limit = res.headers.get('x-ratelimit-limit')
      return { ok: true, login: user.login, message: `Signed in as ${user.login}${limit ? ` · ${limit} requests/hour` : ''}` }
    } catch (err) {
      return { ok: false, message: `Could not reach GitHub: ${errorText(err)}` }
    }
  }

  private async request<T>(path: string, etag?: string): Promise<{ data: T | null; etag: string | null; notModified: boolean }> {
    if (this.limit && this.limit.remaining <= 0 && Date.parse(this.limit.resetAt) > Date.now()) {
      throw new ProviderError('rate-limit', 'GitHub API rate limit reached', this.limit.resetAt)
    }

    const h = headers(this.token)
    if (etag) h['If-None-Match'] = etag

    let res: Response
    try {
      res = await fetchWithTimeout(API + path, { headers: h })
    } catch (err) {
      throw new ProviderError('network', `Could not reach GitHub: ${errorText(err)}`)
    }
    this.readRateLimit(res)

    if (res.status === 304) return { data: null, etag: etag ?? null, notModified: true }
    if (res.ok) return { data: (await res.json()) as T, etag: res.headers.get('etag'), notModified: false }

    if (res.status === 401) throw new ProviderError('auth', 'GitHub rejected the stored token. Update or remove it in Settings → GitHub.')
    if (res.status === 404) throw new ProviderError('not-found', 'Repository not found (renamed, deleted or private).')
    if (res.status === 429 || (res.status === 403 && (this.limit?.remaining === 0 || res.headers.has('retry-after')))) {
      const retry = res.headers.get('retry-after')
      const retryAt = retry ? new Date(Date.now() + Number(retry) * 1000).toISOString() : this.limit?.resetAt
      if (retryAt && this.limit) this.limit = { ...this.limit, remaining: 0, resetAt: retryAt }
      throw new ProviderError('rate-limit', 'GitHub API rate limit reached', retryAt)
    }
    throw new ProviderError('http', `GitHub answered ${res.status} ${res.statusText}`)
  }

  private readRateLimit(res: Response): void {
    const remaining = res.headers.get('x-ratelimit-remaining')
    const limit = res.headers.get('x-ratelimit-limit')
    const reset = res.headers.get('x-ratelimit-reset')
    if (remaining === null || limit === null || reset === null) return
    this.limit = {
      remaining: Number(remaining),
      limit: Number(limit),
      resetAt: new Date(Number(reset) * 1000).toISOString(),
      authenticated: this.token !== null
    }
  }
}

function headers(token: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': `ExpandedHub/${app.getVersion()}`
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') return 'request timed out'
  if (err instanceof Error) return (err.cause as Error | undefined)?.message ?? err.message
  return String(err)
}

/** Newest published release matching the registry's prerelease and tag rules. */
export function pickRelease(list: GhRelease[], repo: RepositoryRef): ReleaseInfo | null {
  return pickReleases(list, repo)[0] ?? null
}

/** The matching releases (see `pickRelease`), newest first. */
export function pickReleases(list: GhRelease[], repo: RepositoryRef): ReleaseInfo[] {
  let tagRe: RegExp | null = null
  if (repo.tagPattern) {
    try {
      tagRe = new RegExp(repo.tagPattern)
    } catch {
      tagRe = null
    }
  }
  const candidates = list
    .filter((r) =>
      repo.pinTag
        ? r.tag_name === repo.pinTag && !r.draft
        : !r.draft && (repo.includePrereleases || !r.prerelease) && (!tagRe || tagRe.test(r.tag_name))
    )
    .sort((a, b) => Date.parse(b.published_at ?? b.created_at) - Date.parse(a.published_at ?? a.created_at))
  return candidates.map((r) => ({
    version: normalizeVersion(r.tag_name),
    tag: r.tag_name,
    name: r.name?.trim() || r.tag_name,
    publishedAt: r.published_at ?? r.created_at,
    notes: r.body ?? '',
    htmlUrl: r.html_url,
    zipballUrl: r.zipball_url ?? undefined,
    prerelease: r.prerelease,
    assets: r.assets.map((a) => ({
      name: a.name,
      size: a.size,
      downloadUrl: a.browser_download_url,
      contentType: a.content_type
    }))
  }))
}

function toCommit(c: GhCommit): CommitInfo {
  return {
    sha: c.sha,
    message: c.commit.message.split('\n')[0],
    author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    date: c.commit.committer?.date ?? c.commit.author?.date ?? '',
    htmlUrl: c.html_url
  }
}
