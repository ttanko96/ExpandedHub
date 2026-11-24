import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' }, net: {} }))

import { GitHubReleaseProvider } from '../src/main/services/releases/github-release-provider'

const repo = { provider: 'github', owner: 'o', name: 'r', includePrereleases: false } as never

/** Answers GitHub API paths: releases are empty, the repo itself as given. */
function stubGitHub(repoAnswer: () => Response) {
  const calls: { url: string; etag: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const etag = (init.headers as Record<string, string>)['If-None-Match'] ?? null
      calls.push({ url, etag })
      if (url.endsWith('/releases?per_page=30')) return new Response('[]', { status: 200 })
      if (url.endsWith('/commits?per_page=11')) return new Response('[]', { status: 200 })
      if (url.endsWith('/repos/o/r')) return repoAnswer()
      return new Response('', { status: 404 })
    })
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('GitHub stars', () => {
  it('reads the star count with the repository', async () => {
    stubGitHub(() => new Response(JSON.stringify({ stargazers_count: 1234 }), { status: 200, headers: { etag: '"a"' } }))
    const snap = await new GitHubReleaseProvider(null).fetch(repo, undefined)
    expect(snap.stars).toBe(1234)
    expect(snap.etags.repo).toBe('"a"')
  })

  it('keeps the last count when GitHub says nothing changed', async () => {
    const calls = stubGitHub(() => new Response(null, { status: 304 }))
    const previous = { release: null, commit: null, etags: { repo: '"a"' }, pinned: null, stars: 99 }
    const snap = await new GitHubReleaseProvider(null).fetch(repo, previous)
    expect(snap.stars).toBe(99)
    expect(calls.find((c) => c.url.endsWith('/repos/o/r'))?.etag).toBe('"a"')
  })

  it('a failed star lookup does not fail the release check', async () => {
    stubGitHub(() => new Response('', { status: 500, statusText: 'Server Error' }))
    const snap = await new GitHubReleaseProvider(null).fetch(repo, undefined)
    expect(snap.stars).toBeNull()
  })
})

