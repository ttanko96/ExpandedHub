import { describe, expect, it } from 'vitest'
import type { InstalledRecord, ReleaseInfo } from '../src/shared/types'
import { ChangelogService, HUB_ID } from '../src/main/services/changelog-service'
import { tempDir } from './helpers'

const rel = (version: string, tag = `v${version}`, notes = `notes of ${version}`): ReleaseInfo => ({
  version,
  tag,
  name: tag,
  publishedAt: '2026-11-01T00:00:00Z',
  notes,
  htmlUrl: `https://github.com/o/r/releases/tag/${tag}`,
  prerelease: false,
  assets: []
})
const rec = (version: string, versionSource: InstalledRecord['versionSource'] = 'hub'): InstalledRecord => ({
  projectId: 'p',
  version,
  installedAt: '',
  installPath: 'C:/p',
  versionSource
})

function service(opts: { releases?: ReleaseInfo[]; hubVersion?: string; hubReleases?: () => Promise<ReleaseInfo[]>; usedBefore?: boolean; dir?: string } = {}) {
  return new ChangelogService({
    userData: opts.dir ?? tempDir(),
    project: async (id) => (id === 'p' ? { name: 'Project', repository: { owner: 'o', name: 'r' } } : null),
    releases: async () => opts.releases ?? [rel('1.3.0'), rel('1.2.0'), rel('1.1.0'), rel('1.0.0')],
    hubVersion: opts.hubVersion ?? '1.1.0',
    hubReleases: opts.hubReleases ?? (async () => [rel('1.2.0'), rel('1.1.0'), rel('1.0.0')]),
    hubReleasesUrl: 'https://github.com/o/hub/releases',
    usedBefore: async () => opts.usedBefore ?? true
  })
}

describe("What's new after a project update", () => {
  it('lists every release after the old version up to the new one', async () => {
    const s = service()
    await s.projectUpdated('p', rec('1.0.0'), '1.2.0', 'v1.2.0')
    const [e] = await s.pending()
    expect(e).toMatchObject({ projectId: 'p', name: 'Project', from: 'v1.0.0', to: 'v1.2.0', moreUrl: null })
    expect(e!.releases.map((r) => r.tag)).toEqual(['v1.2.0', 'v1.1.0'])
    expect(e!.releases[0]!.notes).toBe('notes of 1.2.0')
  })

  it('says nothing for a fresh install or going back to an earlier version', async () => {
    const s = service()
    await s.projectUpdated('p', undefined, '1.3.0', 'v1.3.0')
    await s.projectUpdated('p', rec('1.3.0'), '1.1.0', 'v1.1.0')
    expect(await s.pending()).toEqual([])
  })

  it('shows just the new release when the old version was not known', async () => {
    const s = service()
    await s.projectUpdated('p', rec('0.0.0', 'unknown'), '1.3.0', 'v1.3.0')
    const [e] = await s.pending()
    expect(e).toMatchObject({ from: null, to: 'v1.3.0' })
    expect(e!.releases.map((r) => r.tag)).toEqual(['v1.3.0'])
  })

  it('links to GitHub when releases in between were not kept', async () => {
    const s = service({ releases: [rel('1.3.0'), rel('1.2.0')] })
    await s.projectUpdated('p', rec('1.0.0'), '1.3.0', 'v1.3.0')
    expect((await s.pending())[0]).toMatchObject({ moreUrl: 'https://github.com/o/r/releases' })
  })

  it('joins a second update into the entry not seen yet, from the first old version', async () => {
    const s = service()
    await s.projectUpdated('p', rec('1.0.0'), '1.1.0', 'v1.1.0')
    await s.projectUpdated('p', rec('1.1.0'), '1.3.0', 'v1.3.0')
    const all = await s.pending()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ from: 'v1.0.0', to: 'v1.3.0' })
    expect(all[0]!.releases.map((r) => r.tag)).toEqual(['v1.3.0', 'v1.2.0', 'v1.1.0'])
  })

  it('shows commit messages for a project without releases', async () => {
    const commit = (stamp: string, sha: string, msg: string) => ({ ...rel(`0.0.0-${stamp}`, `commit-${sha}`, 'The hub installs its latest commit…'), name: `Commit ${sha}: ${msg}` })
    const s = service({ releases: [commit('20261114000000', 'ccc', 'Third'), commit('20261113000000', 'bbb', 'Second'), commit('20261112000000', 'aaa', 'First')] })
    await s.projectUpdated('p', rec('0.0.0-20261112000000'), '0.0.0-20261114000000', 'commit-ccc')
    const [e] = await s.pending()
    expect(e).toMatchObject({ to: 'commit ccc' })
    expect(e!.releases.map((r) => r.notes)).toEqual(['Third', 'Second'])
  })

  it('is forgotten once seen', async () => {
    const s = service()
    await s.projectUpdated('p', rec('1.0.0'), '1.1.0', 'v1.1.0')
    await s.dismiss((await s.pending())[0]!.id)
    expect(await s.pending()).toEqual([])
  })
})

describe("What's new after ExpandedHub updated itself", () => {
  it('shows the releases since the version that ran last, once', async () => {
    const dir = tempDir()
    await service({ dir, hubVersion: '1.0.0', usedBefore: false }).hubStarted()
    expect(await service({ dir, hubVersion: '1.0.0' }).pending()).toEqual([])
    const s = service({ dir, hubVersion: '1.2.0' })
    await s.hubStarted()
    const [e] = await s.pending()
    expect(e).toMatchObject({ projectId: HUB_ID, name: 'ExpandedHub', from: 'v1.0.0', to: 'v1.2.0' })
    expect(e!.releases.map((r) => r.tag)).toEqual(['v1.2.0', 'v1.1.0'])
    await s.dismiss(e!.id)
    await service({ dir, hubVersion: '1.2.0' }).hubStarted()
    expect(await service({ dir, hubVersion: '1.2.0' }).pending()).toEqual([])
  })

  it('on the first start with it: the current notes after an update, nothing on a fresh install', async () => {
    const updated = service({ hubVersion: '1.1.0', usedBefore: true })
    await updated.hubStarted()
    expect((await updated.pending())[0]).toMatchObject({ from: null, to: 'v1.1.0' })
    const fresh = service({ hubVersion: '1.1.0', usedBefore: false })
    await fresh.hubStarted()
    expect(await fresh.pending()).toEqual([])
  })

  it('links to the release page when GitHub cannot be reached', async () => {
    const dir = tempDir()
    await service({ dir, hubVersion: '1.0.0', usedBefore: false }).hubStarted()
    const s = service({ dir, hubVersion: '1.1.0', hubReleases: async () => Promise.reject(new Error('offline')) })
    await s.hubStarted()
    expect((await s.pending())[0]).toMatchObject({ releases: [], moreUrl: 'https://github.com/o/hub/releases' })
  })
})
