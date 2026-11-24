import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' }, net: {} }))

import { GitHubReleaseProvider } from '../src/main/services/releases/github-release-provider'

const repo = { provider: 'github', owner: 'o', name: 'r', includePrereleases: false } as never

const rel = (tag: string, day: number) => ({
  tag_name: tag,
  name: tag,
  body: `notes of ${tag}`,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  zipball_url: null,
  draft: false,
  prerelease: false,
  published_at: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`,
  created_at: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`,
  assets: []
})
const commit = (sha: string, day: number) => ({
  sha: sha.repeat(40).slice(0, 40),
  html_url: `https://github.com/o/r/commit/${sha}`,
  author: { login: 'dev' },
  commit: { message: `change ${sha}\n\nbody`, committer: { date: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z` } }
})

/** Answers GitHub API paths with the given releases and commits; records the ETag each request sent. */
function stubGitHub(releases: unknown[], commits: unknown[]) {
  const calls: { url: string; etag: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, etag: (init.headers as Record<string, string>)['If-None-Match'] ?? null })
      if (url.endsWith('/releases?per_page=30')) return new Response(JSON.stringify(releases), { status: 200, headers: { etag: '"r"' } })
      if (url.endsWith('/commits?per_page=11')) return new Response(JSON.stringify(commits), { status: 200, headers: { etag: '"c"' } })
      if (url.endsWith('/repos/o/r')) return new Response('{}', { status: 200 })
      return new Response('', { status: 404 })
    })
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('earlier versions kept by the update check', () => {
  it('keeps the releases before the latest, with their notes', async () => {
    stubGitHub([rel('v1.0.0', 1), rel('v1.2.0', 3), rel('v1.1.0', 2)], [])
    const snap = await new GitHubReleaseProvider(null).fetch(repo, undefined)
    expect(snap.release?.tag).toBe('v1.2.0')
    expect(snap.older?.map((r) => r.tag)).toEqual(['v1.1.0', 'v1.0.0'])
    expect(snap.older?.map((r) => r.notes)).toEqual(['notes of v1.1.0', 'notes of v1.0.0'])
  })

  it('keeps the commits before the latest for a project without releases, in the same request', async () => {
    const calls = stubGitHub([], [commit('c', 3), commit('b', 2), commit('a', 1)])
    const snap = await new GitHubReleaseProvider(null).fetch(repo, undefined)
    expect(snap.commit?.message).toBe('change c')
    expect(snap.olderCommits?.map((c) => c.message)).toEqual(['change b', 'change a'])
    expect(calls.filter((c) => c.url.includes('/commits')).length).toBe(1)
  })

  it('fetches in full once when the cached snapshot is from before older versions were kept', async () => {
    const calls = stubGitHub([], [commit('c', 3)])
    const old = { release: null, commit: null, etags: { releases: '"r0"', commits: '"c0"' }, pinned: null, stars: null }
    await new GitHubReleaseProvider(null).fetch(repo, old)
    expect(calls.find((c) => c.url.includes('/releases'))?.etag).toBeNull()
    expect(calls.find((c) => c.url.includes('/commits'))?.etag).toBeNull()
  })
})
