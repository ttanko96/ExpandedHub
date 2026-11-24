import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: {} }))

import { LifecycleService } from '../src/main/services/install/lifecycle'
import { tempDir } from './helpers'

type Rec = { installPath: string; downloadPath?: string }

/** Expanded (host), TMST (add-on inside it, depends on it) and an unrelated project. */
function setup(extra: { otherNeedsHost?: boolean } = {}) {
  const root = tempDir()
  const installs = join(root, 'installs')
  const downloads = join(root, 'downloads')
  const host = join(installs, 'expanded')
  const addon = join(host, 'addons', 'tmst')
  for (const d of [addon, join(installs, 'other'), join(downloads, 'expanded'), join(downloads, 'tmst')]) mkdirSync(d, { recursive: true })
  writeFileSync(join(addon, 'a.txt'), 'x')
  writeFileSync(join(downloads, 'expanded', 'pkg.zip'), 'zip')

  const records: Record<string, Rec> = {
    expanded: { installPath: host },
    tmst: { installPath: addon },
    other: { installPath: join(installs, 'other') }
  }
  const projects = [
    { id: 'expanded', name: 'Expanded', install: { dependsOn: [], tools: [] } },
    { id: 'tmst', name: 'TMST', install: { dependsOn: ['expanded'], tools: [], installInto: { project: 'expanded', subdir: 'addons/tmst' } } },
    { id: 'other', name: 'Other', install: { dependsOn: extra.otherNeedsHost ? ['expanded'] : [], tools: [] } }
  ]
  const registry = { get: async () => ({ projects }) }
  const settings = { get: async () => ({ directories: { installs, downloads } }) }
  const installed = {
    all: async () => ({ ...records }),
    remove: async (id: string) => void delete records[id]
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lifecycle = new LifecycleService(registry as any, settings as any, installed as any, { paths: async () => new Map() } as any)
  return { lifecycle, records, host, addon, downloads }
}

describe('uninstall with dependencies', () => {
  it('lists installed dependencies and keeps them by default', async () => {
    const { lifecycle, records, host, addon } = setup()
    const storage = await lifecycle.storage('tmst')
    expect(storage.dependencies.map((d) => [d.id, d.neededBy])).toEqual([['expanded', []]])

    const r = await lifecycle.uninstall('tmst', { files: true })
    expect(r.removedDependencies).toEqual([])
    expect(existsSync(addon)).toBe(false)
    expect(existsSync(host)).toBe(true)
    expect(records.expanded).toBeDefined()
  })

  it('removes a chosen dependency after the project, with its downloads when asked', async () => {
    const { lifecycle, records, host, downloads } = setup()
    const r = await lifecycle.uninstall('tmst', { files: true, downloads: true, dependencies: ['expanded'] })
    expect(r.removedDependencies).toEqual(['Expanded'])
    expect(existsSync(host)).toBe(false)
    expect(existsSync(join(downloads, 'expanded'))).toBe(false)
    expect(records.expanded).toBeUndefined()
    expect(records.tmst).toBeUndefined()
  })

  it('refuses a dependency another installed project still needs, before deleting anything', async () => {
    const { lifecycle, records, addon } = setup({ otherNeedsHost: true })
    expect((await lifecycle.storage('tmst')).dependencies[0].neededBy).toEqual(['Other'])
    await expect(lifecycle.uninstall('tmst', { files: true, dependencies: ['expanded'] })).rejects.toThrow(/still needed by Other/)
    expect(existsSync(addon)).toBe(true)
    expect(records.tmst).toBeDefined()
  })

  it('refuses ids that are not dependencies, and dependencies without the project files', async () => {
    const { lifecycle } = setup()
    await expect(lifecycle.uninstall('tmst', { files: true, dependencies: ['other'] })).rejects.toThrow(/not a dependency/)
    await expect(lifecycle.uninstall('tmst', { files: false, downloads: true, dependencies: ['expanded'] })).rejects.toThrow(/together/)
  })
})

/** A Remake-like project with a hub-installed Godot, a user-installed Python, and maybe a second user of Godot. */
function setupTools(extra: { otherUsesGodot?: boolean; otherInstalled?: boolean } = {}) {
  const root = tempDir()
  const installs = join(root, 'installs')
  const downloads = join(root, 'downloads')
  const godotDir = join(installs, '_tools', 'godot-4.7-stable')
  const godotExe = join(godotDir, 'Godot.exe')
  const userPython = join(root, 'Python', 'python.exe')
  for (const d of [godotDir, dirname(userPython), join(installs, 'remake'), join(installs, 'other'), join(downloads, '_tools', 'godot')]) {
    mkdirSync(d, { recursive: true })
  }
  writeFileSync(godotExe, 'exe')
  writeFileSync(userPython, 'exe')
  writeFileSync(join(downloads, '_tools', 'godot', 'godot.zip'), 'zip')

  const godot = { id: 'godot', name: 'Godot', provision: { version: '4.7-stable' } }
  const python = { id: 'python', name: 'Python', provision: { version: '3.12' } }
  const records: Record<string, Rec> = { remake: { installPath: join(installs, 'remake') } }
  if (extra.otherInstalled !== false) records.other = { installPath: join(installs, 'other') }
  const projects = [
    { id: 'remake', name: 'Remake', install: { dependsOn: [], tools: [godot, python] } },
    { id: 'other', name: 'Other', install: { dependsOn: [], tools: extra.otherUsesGodot ? [godot] : [] } }
  ]
  const chosen = new Map([
    ['godot', godotExe],
    ['python', userPython]
  ])
  const tools = {
    paths: async () => new Map(chosen),
    clear: vi.fn(async (id: string) => void chosen.delete(id)),
    clearCache: vi.fn()
  }
  const lifecycle = new LifecycleService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { get: async () => ({ projects }) } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { get: async () => ({ directories: { installs, downloads } }) } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { all: async () => ({ ...records }), remove: async (id: string) => void delete records[id] } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools as any
  )
  return { lifecycle, tools, chosen, godotDir, userPython, downloads }
}

describe('uninstall with hub-installed tools', () => {
  it('lists only the tools the hub installed, and keeps them by default', async () => {
    const { lifecycle, godotDir } = setupTools()
    const storage = await lifecycle.storage('remake')
    expect(storage.tools.map((t) => [t.id, t.install.path])).toEqual([['godot', godotDir]])

    const r = await lifecycle.uninstall('remake', { files: true })
    expect(r.removedTools).toEqual([])
    expect(existsSync(godotDir)).toBe(true)
  })

  it('removes a chosen tool, forgets its path, and deletes its download when asked', async () => {
    const { lifecycle, tools, chosen, godotDir, userPython, downloads } = setupTools()
    const r = await lifecycle.uninstall('remake', { files: true, downloads: true, tools: ['godot'] })
    expect(r.removedTools).toEqual(['Godot'])
    expect(existsSync(godotDir)).toBe(false)
    expect(existsSync(join(downloads, '_tools', 'godot'))).toBe(false)
    expect(chosen.has('godot')).toBe(false)
    expect(tools.clearCache).toHaveBeenCalled()
    expect(existsSync(userPython)).toBe(true)
  })

  it('never removes a tool the user installed', async () => {
    const { lifecycle, userPython } = setupTools()
    await expect(lifecycle.uninstall('remake', { files: true, tools: ['python'] })).rejects.toThrow(/not a tool the hub installed/)
    expect(existsSync(userPython)).toBe(true)
  })

  it('refuses a tool another installed project still uses, before deleting anything', async () => {
    const { lifecycle, godotDir } = setupTools({ otherUsesGodot: true })
    expect((await lifecycle.storage('remake')).tools[0].neededBy).toEqual([{ id: 'other', name: 'Other' }])
    await expect(lifecycle.uninstall('remake', { files: true, tools: ['godot'] })).rejects.toThrow(/still used by Other/)
    expect(existsSync(godotDir)).toBe(true)
  })

  it('does not count projects that are not installed as users', async () => {
    const { lifecycle } = setupTools({ otherUsesGodot: true, otherInstalled: false })
    expect((await lifecycle.storage('remake')).tools[0].neededBy).toEqual([])
  })
})

describe('an installation whose folder is gone', () => {
  it('is not launched, and Uninstall still forgets it', async () => {
    const { lifecycle, records } = setup()
    records.other = { installPath: join(tempDir(), 'moved-away') }
    await expect(lifecycle.launch('other')).rejects.toThrow(/folder was not found/)
    await lifecycle.uninstall('other', { files: true })
    expect(records.other).toBeUndefined()
  })
})
