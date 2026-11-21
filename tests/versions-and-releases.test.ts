import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' }, net: {} }))

import { resolveDownload } from '@shared/assets'
import { ProjectDefinition, type RepositoryRef } from '@shared/registry-schema'
import { computeStatus, isNewer, normalizeVersion } from '@shared/status'
import type { ReleaseInfo } from '@shared/types'
import { pickRelease } from '../src/main/services/releases/github-release-provider'

describe('version handling', () => {
  it('normalizes common tag shapes', () => {
    expect(normalizeVersion('v1.5.1')).toBe('1.5.1')
    expect(normalizeVersion('release-2.0')).toBe('2.0.0')
    expect(normalizeVersion('v0.1.2-easy-setup')).toBe('0.1.2-easy-setup')
  })

  it('compares versions numerically, not as text', () => {
    expect(isNewer('v1.10.0', 'v1.9.3')).toBe(true)
    expect(isNewer('1.5.1', '1.5.1')).toBe(false)
    expect(isNewer('1.5.0', '1.5.1')).toBe(false)
    expect(isNewer('v1.0.0', 'v1.0.0-beta')).toBe(true)
  })

  it('derives the project status', () => {
    const latest = { version: '1.5.1' } as ReleaseInfo
    const installed = (version: string) => ({ projectId: 'x', version, installedAt: '', installPath: '' })
    expect(computeStatus({ installed: null, latest: null, busy: false, failed: false })).toBe('not-installed')
    expect(computeStatus({ installed: null, latest, busy: false, failed: false })).toBe('install-available')
    expect(computeStatus({ installed: installed('1.5.0'), latest, busy: false, failed: false })).toBe('update-available')
    expect(computeStatus({ installed: installed('1.5.1'), latest, busy: false, failed: false })).toBe('up-to-date')
    expect(computeStatus({ installed: installed('1.5.1'), latest, busy: true, failed: false })).toBe('installing')
    expect(computeStatus({ installed: null, latest, busy: false, failed: true })).toBe('failed')
  })
})

describe('release selection', () => {
  const rel = (tag: string, published: string, extra: Partial<{ prerelease: boolean; draft: boolean }> = {}) => ({
    tag_name: tag,
    name: null,
    body: null,
    html_url: `https://github.com/o/r/releases/tag/${tag}`,
    zipball_url: null,
    draft: false,
    prerelease: false,
    published_at: published,
    created_at: published,
    assets: [],
    ...extra
  })
  const repo = (o: Partial<RepositoryRef> = {}): RepositoryRef => ({ provider: 'github', owner: 'o', name: 'r', includePrereleases: false, ...o })
  const list = [
    rel('v0.2.0-beta', '2026-11-10T00:00:00Z', { prerelease: true }),
    rel('v0.1.0', '2026-11-01T00:00:00Z'),
    rel('v0.3.0', '2026-11-12T00:00:00Z', { draft: true }),
    rel('tools-7', '2026-11-11T00:00:00Z')
  ]

  it('skips drafts and prereleases by default', () => {
    expect(pickRelease(list, repo())?.tag).toBe('tools-7')
  })
  it('includes prereleases when the registry asks for them', () => {
    expect(pickRelease(list, repo({ includePrereleases: true }))?.tag).toBe('tools-7')
    expect(pickRelease(list, repo({ includePrereleases: true, tagPattern: '^v' }))?.tag).toBe('v0.2.0-beta')
  })
  it('applies the tag pattern', () => {
    expect(pickRelease(list, repo({ tagPattern: '^v\\d' }))?.tag).toBe('v0.1.0')
  })
  it('takes exactly the pinned tag, even when newer releases exist', () => {
    expect(pickRelease(list, repo({ pinTag: 'v0.1.0' }))?.tag).toBe('v0.1.0')
    expect(pickRelease(list, repo({ pinTag: 'v9' }))).toBeNull()
  })
  it('returns null when nothing matches', () => {
    expect(pickRelease([rel('v1', '2026-01-01T00:00:00Z', { prerelease: true })], repo())).toBeNull()
  })
})

describe('download resolution', () => {
  const project = ProjectDefinition.parse({
    schemaVersion: 1,
    id: 'demo',
    name: 'Demo',
    description: 'Demo project',
    developer: { name: 'dev' },
    repository: { owner: 'o', name: 'r' },
    install: {
      strategy: 'release-asset',
      supportedPlatforms: ['win32', 'linux'],
      steps: [
        { type: 'download', from: 'asset', assetPattern: { win32: '-windows\\.zip$', linux: '-linux\\.zip$' }, checksumAsset: '^SHA256SUMS\\.txt$' },
        { type: 'finalize' }
      ]
    }
  })
  const release = {
    version: '1.0.0',
    tag: 'v1.0.0',
    assets: [
      { name: 'Demo-1.0.0-Windows.zip', size: 10, downloadUrl: 'https://github.com/w' },
      { name: 'Demo-1.0.0-Linux.zip', size: 11, downloadUrl: 'https://github.com/l' },
      { name: 'SHA256SUMS.txt', size: 1, downloadUrl: 'https://github.com/s' }
    ]
  } as ReleaseInfo

  it('picks the asset for the current OS, case-insensitively, with its checksum file', () => {
    const plan = resolveDownload(project, release, 'win32')
    expect(plan.asset?.name).toBe('Demo-1.0.0-Windows.zip')
    expect(plan.checksum?.name).toBe('SHA256SUMS.txt')
    expect(plan.problem).toBeNull()
  })
  it('explains when there is no package for this OS', () => {
    expect(resolveDownload(project, release, 'darwin').problem).toMatch(/darwin/)
  })
  it('falls back to the source archive for a release without any package', () => {
    const old = { ...release, assets: [], zipballUrl: 'https://api.github.com/z' } as ReleaseInfo
    expect(resolveDownload(project, old, 'win32')).toMatchObject({ kind: 'source', problem: null })
  })
  it('explains when there is no release', () => {
    expect(resolveDownload(project, null, 'win32').problem).toMatch(/No release/)
  })
})

describe('latest commit as a release', () => {
  const commit = { sha: '14037374030ba95e389f62d0924befe370286f18', message: 'Fix', author: 'n0madic', date: '2026-11-14T14:17:15Z', htmlUrl: 'https://github.com/x' }
  it('downloads exactly that commit and orders by commit time', async () => {
    const { commitRelease, isNewer } = await import('@shared/status')
    const r = commitRelease(commit, { owner: 'n0madic', name: 'Tekken3Remake' })
    expect(r.zipballUrl).toBe('https://api.github.com/repos/n0madic/Tekken3Remake/zipball/14037374030ba95e389f62d0924befe370286f18')
    expect(r.version).toBe('0.0.0-20261114141715')
    expect(r.tag).toBe('commit-1403737')
    const later = commitRelease({ ...commit, sha: 'abcdef0', date: '2026-11-20T09:00:00Z' }, { owner: 'n0madic', name: 'Tekken3Remake' })
    expect(isNewer(later.version, r.version)).toBe(true)
    expect(isNewer(r.version, r.version)).toBe(false)
  })
})
