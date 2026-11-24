import type { RepositoryRef } from '@shared/registry-schema'
import type { CommitInfo, RateLimitInfo, ReleaseInfo, UpdateCheckSummary } from '@shared/types'

/** What a provider knows about a repository. Cached between checks. */
export interface RepoSnapshot {
  release: ReleaseInfo | null
  /** Earlier matching releases, newest first: for installing an older version, and for What's new after an update. */
  older?: ReleaseInfo[]
  /** Only fetched when the repository has no matching release. */
  commit: CommitInfo | null
  /** The commits before `commit`, newest first: a project without releases installs one of these as an earlier version. */
  olderCommits?: CommitInfo[]
  /** Conditional-request validators, so unchanged repositories cost no rate limit. */
  etags: { releases?: string; commits?: string; repo?: string }
  /** The repository's GitHub star count: how many people like it. Null when unknown. */
  stars?: number | null
  /** The registry's `pinTag` this snapshot was made with; a different pin needs a fresh fetch. */
  pinned?: string | null
}

export type ProviderErrorKind = 'rate-limit' | 'auth' | 'not-found' | 'network' | 'http'

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    /** For rate limits: when requests are allowed again. */
    readonly retryAt?: string
  ) {
    super(message)
  }
}

/**
 * Source of release information for a repository. The mock provider and the
 * GitHub provider implement the same interface, so nothing else changes when
 * switching between them.
 */
export interface ReleaseProvider {
  readonly id: UpdateCheckSummary['source']
  /**
   * Fetch the latest matching release (and the latest commit when there is no
   * release). `previous` lets the provider make conditional requests and reuse
   * unchanged data. Throws `ProviderError`.
   */
  fetch(repo: RepositoryRef, previous: RepoSnapshot | undefined): Promise<RepoSnapshot>
  rateLimit(): RateLimitInfo | null
}
