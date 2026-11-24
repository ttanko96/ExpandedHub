import { describe, expect, it } from 'vitest'
import { ProjectDefinition, type GameDefinition } from '../src/shared/registry-schema'
import type { InstalledRecord } from '../src/shared/types'
import type { SourceConfig } from '../src/shared/install'
import { builtWith, rebuildReasons } from '../src/main/services/install/built-with'

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
    sources: [
      { gameId: 'disc', required: true, purpose: 'Base game' },
      { gameId: 'extra', required: false, purpose: 'Extras' }
    ],
    steps: [
      { type: 'download', from: 'asset', assetPattern: { win32: 'zip' } },
      { type: 'run', label: 'Setup', command: { win32: 'Setup.cmd' } },
      { type: 'finalize' }
    ]
  }
})

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
    steps: [{ type: 'download', from: 'asset', assetPattern: { win32: 'zip' } }, { type: 'buildHost' }, { type: 'finalize' }]
  }
})

const plain = ProjectDefinition.parse({
  schemaVersion: 1,
  id: 'plain',
  name: 'Plain',
  description: 'x',
  developer: { name: 'd' },
  repository: { owner: 'o', name: 'plain' },
  install: { strategy: 'script', supportedPlatforms: ['win32'], steps: [{ type: 'download', from: 'asset', assetPattern: { win32: 'zip' } }, { type: 'finalize' }] }
})

const projects = [host, addon, plain]
const games = [{ id: 'disc', name: 'Base disc' }, { id: 'extra', name: 'Extra disc' }] as GameDefinition[]
const rec = (projectId: string, version = '1.0.0'): InstalledRecord => ({ projectId, version, installedAt: '', installPath: `C:/${projectId}` })
const src = (gameId: string, path: string, size = 10): SourceConfig => ({ gameId, path, size, validation: null })

describe('telling when a build is out of date', () => {
  it('records the game files and add-ons a build uses, only for built projects', () => {
    const used = builtWith(host, projects, { expanded: rec('expanded'), tmst: rec('tmst', '1.1.0') }, [src('disc', 'C:/t3.cue'), src('other', 'C:/x.zip')])
    expect(used).toEqual({ sources: { disc: 'C:/t3.cue|10' }, addons: { tmst: '1.1.0' } })
    expect(builtWith(plain, projects, {}, [])).toBeNull()
  })

  it('names what changed since the last build', () => {
    const then = { sources: { disc: 'C:/t3.cue|10', extra: 'C:/e.iso|5' }, addons: { tmst: '1.0.0' } }
    expect(rebuildReasons(then, then, projects, games)).toEqual([])
    expect(rebuildReasons(then, { sources: { disc: 'C:/t3.cue|10', extra: 'C:/e.iso|5' }, addons: {} }, projects, games)).toEqual(['TMST was removed'])
    expect(rebuildReasons({ ...then, addons: {} }, then, projects, games)).toEqual(['TMST was added'])
    expect(rebuildReasons(then, { ...then, addons: { tmst: '1.1.0' } }, projects, games)).toEqual(['TMST is a new version'])
    expect(rebuildReasons(then, { sources: { disc: 'C:/t3b.cue|10' }, addons: { tmst: '1.0.0' } }, projects, games)).toEqual([
      'Base disc was changed',
      'Extra disc was removed'
    ])
  })

  it('says nothing when the last build is not known', () => {
    expect(rebuildReasons(undefined, { sources: {}, addons: { tmst: '1.0.0' } }, projects, games)).toEqual([])
  })
})
