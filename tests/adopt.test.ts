import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => userData.dir, getVersion: () => '0.0.0-test' }, shell: {} }))

import { ProjectDefinition, type InstallableProject } from '../src/shared/registry-schema'
import { computeStatus, versionLabel } from '../src/shared/status'
import type { InstalledRecord, ReleaseInfo } from '../src/shared/types'
import { AdoptService } from '../src/main/services/install/adopt-service'
import { checkFolder, detectVersion, gitFiles, MARKER_FILE } from '../src/main/services/install/detect-version'
import { LifecycleService } from '../src/main/services/install/lifecycle'
import { tempDir } from './helpers'

userData.dir = tempDir()

const host = ProjectDefinition.parse({
  schemaVersion: 1,
  id: 'expanded',
  name: 'Expanded',
  description: 'x',
  developer: { name: 'd' },
  repository: { owner: 'o', name: 'expanded' },
  install: {
    strategy: 'script',
    supportedPlatforms: ['win32'],
    steps: [
      { type: 'download', from: 'asset', assetPattern: { win32: 'zip' } },
      { type: 'run', label: 'Setup', command: { win32: 'Setup.cmd' } },
      { type: 'locateOutput', patterns: ['build/*.exe'] },
      { type: 'finalize' }
    ],
    output: { executable: { win32: 'Game.exe' } }
  }
}) as InstallableProject

const addon = ProjectDefinition.parse({
  schemaVersion: 1,
  id: 'tmst',
  name: 'TMST',
  description: 'x',
  developer: { name: 'd' },
  repository: { owner: 'o', name: 'tmst' },
  install: {
    strategy: 'script',
    supportedPlatforms: ['win32'],
    dependsOn: ['expanded'],
    installInto: { project: 'expanded', subdir: 'addons/tmst' },
    detect: { markers: ['addon.cmake'], version: [{ file: 'addon.cmake', pattern: 'set\\(TMST_VERSION "([^"]+)"\\)' }] },
    steps: [{ type: 'download', from: 'asset', assetPattern: { win32: 'zip' } }, { type: 'finalize' }]
  }
}) as InstallableProject

const release = (version: string, tag = `v${version}`): ReleaseInfo => ({
  version,
  tag,
  name: tag,
  publishedAt: '2026-11-01T00:00:00Z',
  notes: '',
  htmlUrl: 'https://github.com/o/x',
  prerelease: false,
  assets: []
})

function hostFolder(): string {
  const dir = join(tempDir(), 'my-expanded')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Setup.cmd'), '@echo off')
  writeFileSync(join(dir, 'Game.exe'), 'MZ')
  return dir
}

/** A `.git` folder without the git program: HEAD on main, an annotated loose tag and a packed tag. */
function fakeGit(dir: string, opts: { annotated?: string; packed?: string; time?: number } = {}): string {
  const sha = 'a'.repeat(40)
  const git = join(dir, '.git')
  mkdirSync(join(git, 'refs', 'heads'), { recursive: true })
  mkdirSync(join(git, 'refs', 'tags'), { recursive: true })
  writeFileSync(join(git, 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(git, 'refs', 'heads', 'main'), sha + '\n')
  const obj = (id: string, body: string) => {
    mkdirSync(join(git, 'objects', id.slice(0, 2)), { recursive: true })
    writeFileSync(join(git, 'objects', id.slice(0, 2), id.slice(2)), deflateSync(Buffer.from(body)))
  }
  obj(sha, `commit 100\0tree ${'b'.repeat(40)}\nauthor A <a@b> ${opts.time ?? 1794700000} +0100\ncommitter A <a@b> ${opts.time ?? 1794700000} +0100\n\nmsg\n`)
  if (opts.annotated) {
    const tagId = 'c'.repeat(40)
    writeFileSync(join(git, 'refs', 'tags', opts.annotated), tagId + '\n')
    obj(tagId, `tag 80\0object ${sha}\ntype commit\ntag ${opts.annotated}\n`)
  }
  if (opts.packed) writeFileSync(join(git, 'packed-refs'), `# pack-refs\n${'d'.repeat(40)} refs/tags/${opts.packed}\n^${sha}\n`)
  return sha
}

describe('recognising an existing installation', () => {
  it('accepts a folder with the project files and refuses another one', async () => {
    expect((await checkFolder(host, hostFolder(), 'win32')).ok).toBe(true)
    const other = tempDir()
    const r = await checkFolder(host, other, 'win32')
    expect(r.ok).toBe(false)
    expect(r.expected).toEqual(expect.arrayContaining(['Game.exe', 'Setup.cmd', 'build/*.exe']))
  })

  it('reads the hub marker first, then registry version files', async () => {
    const dir = hostFolder()
    writeFileSync(join(dir, MARKER_FILE), JSON.stringify({ projectId: 'expanded', version: '1.4.0' }))
    expect(await detectVersion(host, dir, release('1.5.1'))).toMatchObject({ version: '1.4.0', source: 'marker' })

    const a = tempDir()
    writeFileSync(join(a, 'addon.cmake'), 'project(x)\nset(TMST_VERSION "1.0.0")\n')
    expect(await detectVersion(addon, a, release('1.1.0'))).toMatchObject({ version: '1.0.0', source: 'file' })
  })

  it('reads tags from .git without the git program, annotated and packed', async () => {
    const dir = hostFolder()
    fakeGit(dir, { annotated: 'v1.5.0', packed: 'v1.4.1' })
    const facts = await gitFiles(dir)
    expect(facts?.tags.sort()).toEqual(['v1.4.1', 'v1.5.0'])
    expect(facts?.time).toBe(1794700000)
  })

  it('dates a checkout of a project without releases by its commit', async () => {
    const dir = hostFolder()
    const sha = fakeGit(dir, { time: Date.parse('2026-11-14T22:40:24Z') / 1000 })
    const facts = await gitFiles(dir)
    expect(facts?.sha).toBe(sha)
    // Same commit as the latest: exactly the latest version.
    expect(await detectVersion(host, dir, release('0.0.0-20261114224024', `commit-${sha.slice(0, 7)}`))).toMatchObject({ version: '0.0.0-20261114224024' })
  })

  it('treats an unknown version as outdated', async () => {
    const dir = hostFolder()
    const v = await detectVersion(host, dir, release('1.5.1'))
    expect(v.source).toBe('unknown')
    const rec: InstalledRecord = { projectId: 'expanded', version: v.version, versionSource: v.source, installedAt: '', installPath: dir }
    expect(versionLabel(rec)).toBe('unknown version')
    expect(computeStatus({ installed: rec, latest: release('1.5.1'), busy: false, failed: false })).toBe('update-available')
    expect(computeStatus({ installed: { ...rec, version: '1.5.1', versionSource: 'git' }, latest: release('1.5.1'), busy: false, failed: false })).toBe('up-to-date')
    expect(computeStatus({ installed: { ...rec, version: '1.5.0', versionSource: 'git' }, latest: release('1.5.1'), busy: false, failed: false })).toBe('update-available')
  })
})

function services() {
  const records: Record<string, InstalledRecord> = {}
  const registry = { get: async () => ({ projects: [host, addon], games: [], issues: [] }) }
  const installed = {
    all: async () => ({ ...records }),
    set: async (r: InstalledRecord) => void (records[r.projectId] = r),
    remove: async (id: string) => void delete records[id]
  }
  const updates = {
    states: async () => [
      { projectId: 'expanded', latest: release('1.5.1') },
      { projectId: 'tmst', latest: release('1.1.0') }
    ],
    emit: async () => {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adopt = new AdoptService(registry as any, installed as any, updates as any, 'win32')
  return { adopt, records, registry, installed }
}

describe('linking an existing installation', () => {
  it('links the folder, finds the launcher and links add-ons inside it', async () => {
    const { adopt, records } = services()
    const dir = hostFolder()
    mkdirSync(join(dir, 'addons', 'tmst'), { recursive: true })
    writeFileSync(join(dir, 'addons', 'tmst', 'addon.cmake'), 'set(TMST_VERSION "1.0.0")')

    const r = await adopt.adopt('expanded', dir)
    expect(r.record).toMatchObject({ installPath: dir, executable: 'Game.exe', adopted: true, versionSource: 'unknown' })
    expect(r.addons).toEqual(['TMST'])
    expect(records.tmst).toMatchObject({ version: '1.0.0', versionSource: 'file', adopted: true })
  })

  it('moves add-ons with their host when its folder is changed, and forgets ones not in the new folder', async () => {
    const { adopt, records } = services()
    const first = hostFolder()
    mkdirSync(join(first, 'addons', 'tmst'), { recursive: true })
    writeFileSync(join(first, 'addons', 'tmst', 'addon.cmake'), 'set(TMST_VERSION "1.0.0")')
    await adopt.adopt('expanded', first)
    expect(records.tmst?.installPath).toBe(join(first, 'addons', 'tmst'))

    const second = hostFolder()
    mkdirSync(join(second, 'addons', 'tmst'), { recursive: true })
    writeFileSync(join(second, 'addons', 'tmst', 'addon.cmake'), 'set(TMST_VERSION "1.1.0")')
    const r = await adopt.adopt('expanded', second)
    expect(r.addons).toEqual(['TMST'])
    expect(records.tmst).toMatchObject({ installPath: join(second, 'addons', 'tmst'), version: '1.1.0' })

    const third = hostFolder()
    const r3 = await adopt.adopt('expanded', third)
    expect(r3.unlinked).toEqual(['TMST'])
    expect(records.tmst).toBeUndefined()
    expect(existsSync(join(second, 'addons', 'tmst', 'addon.cmake'))).toBe(true)
  })

  it('rescan moves an add-on still recorded in its host\'s previous folder', async () => {
    const { adopt, records } = services()
    const old = hostFolder()
    const now = hostFolder()
    mkdirSync(join(now, 'addons', 'tmst'), { recursive: true })
    writeFileSync(join(now, 'addons', 'tmst', 'addon.cmake'), 'set(TMST_VERSION "1.1.0")')
    await adopt.adopt('expanded', now)
    // As an older hub left it: TMST still in the host's previous folder.
    records.tmst = { ...records.tmst!, installPath: join(old, 'addons', 'tmst') }
    await adopt.rescan()
    expect(records.tmst?.installPath).toBe(join(now, 'addons', 'tmst'))
  })

  it('refuses a folder that is not the project, and an add-on outside its host', async () => {
    const { adopt } = services()
    await expect(adopt.adopt('expanded', tempDir())).rejects.toThrow(/does not look like Expanded/)
    await expect(adopt.adopt('tmst', tempDir())).rejects.toThrow(/Link or install Expanded first/)
    await adopt.adopt('expanded', hostFolder())
    await expect(adopt.adopt('tmst', tempDir())).rejects.toThrow(/has to be in/)
  })

  it('re-reads the version of a linked folder, but not after the hub installed into it', async () => {
    const { adopt, records } = services()
    const dir = hostFolder()
    await adopt.adopt('expanded', dir)
    writeFileSync(join(dir, MARKER_FILE), JSON.stringify({ projectId: 'expanded', version: '1.5.1' }))
    await adopt.rescan()
    expect(records.expanded).toMatchObject({ version: '1.5.1', versionSource: 'marker' })
    records.expanded = { ...records.expanded!, version: '1.6.0', versionSource: 'hub' }
    await adopt.rescan()
    expect(records.expanded.version).toBe('1.6.0')
  })

  it('uninstall forgets a linked folder without deleting it, even when it is named like the project', async () => {
    const { adopt, records, registry, installed } = services()
    const dir = join(tempDir(), 'expanded')
    mkdirSync(dir)
    writeFileSync(join(dir, 'Game.exe'), 'MZ')
    await adopt.adopt('expanded', dir)
    const settings = { get: async () => ({ directories: { installs: join(tempDir(), 'installs'), downloads: tempDir() } }) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lifecycle = new LifecycleService(registry as any, settings as any, installed as any, { paths: async () => new Map() } as any)
    const r = await lifecycle.uninstall('expanded', { files: true })
    expect(r.removedFiles).toBe(false)
    expect(existsSync(join(dir, 'Game.exe'))).toBe(true)
    expect(records.expanded).toBeUndefined()
  })
})
