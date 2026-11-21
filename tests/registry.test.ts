import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allTools, GamesCatalog, ProjectDefinition } from '@shared/registry-schema'

const dir = join(__dirname, '..', 'registry')
const games = GamesCatalog.parse(JSON.parse(readFileSync(join(dir, 'games.json'), 'utf8'))).games.map((g) => g.id)
const files = readdirSync(join(dir, 'projects')).filter((f) => f.endsWith('.json') && !f.startsWith('_'))

describe('registry', () => {
  it.each(files)('%s matches the schema and only names known games', (file) => {
    const parsed = ProjectDefinition.safeParse(JSON.parse(readFileSync(join(dir, 'projects', file), 'utf8')))
    expect(parsed.success ? null : parsed.error.issues).toBeNull()
    const p = parsed.data!
    const used = [
      ...(p.install?.sources.map((s) => s.gameId) ?? []),
      ...(p.install?.steps.flatMap((s) => (s.type === 'run' ? [...s.when, ...s.args.flatMap((a) => (typeof a === 'string' ? [] : [...a.when, ...a.unless]))] : [])) ?? [])
    ]
    const tools = new Set((p.install?.tools ?? []).filter((t) => t.pick).map((t) => `tool:${t.id}`))
    expect(used.filter((g) => !games.includes(g) && !tools.has(g))).toEqual([])
    for (const s of p.install?.steps ?? []) {
      if (s.type === 'run' && typeof s.progress === 'object') for (const pat of s.progress.patterns) expect(() => new RegExp(pat.match)).not.toThrow()
    }
  })
})

describe('tool-run projects', () => {
  const base = JSON.parse(readFileSync(join(dir, 'projects', 'tekken3-remake.json'), 'utf8'))
  it('runs Godot as one of its tools and launches with it', () => {
    const p = ProjectDefinition.parse(base)
    expect(p.install?.output.launch).toEqual({ tool: 'godot', args: ['--path', 'remake'] })
    expect(p.install?.steps.some((s) => s.type === 'run' && s.base === 'tool' && s.command.win32 === 'godot')).toBe(true)
  })
  it('refuses a tool step or launcher naming a tool the project does not list', () => {
    const noTools = { ...base, install: { ...base.install, tools: [] } }
    const r = ProjectDefinition.safeParse(noTools)
    expect(r.success).toBe(false)
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('install.output.launch.tool')
    expect(paths.some((x) => /^install\.steps\.\d+\.command\.win32$/.test(x))).toBe(true)
  })
})

describe('tools the hub installs', () => {
  const base = JSON.parse(readFileSync(join(dir, 'projects', 'tekken3-remake.json'), 'utf8'))
  const godot = () => JSON.parse(JSON.stringify(base.install.tools[0]))
  const withTool = (t: unknown) => ({ ...base, install: { ...base.install, tools: [t, ...base.install.tools.slice(1)] } })
  it('pins Godot 4.7 by SHA-512', () => {
    const p = ProjectDefinition.parse(base)
    expect(p.install?.tools[0].provision?.win32?.sha512).toMatch(/^[0-9a-f]{128}$/)
  })
  it('needs a hash, a pick, an https address and a path inside the zip', () => {
    const noHash = godot()
    delete noHash.provision.win32.sha512
    const noPick = godot()
    delete noPick.pick
    const http = godot()
    http.provision.win32.url = 'http://example.com/godot.zip'
    const escape = godot()
    escape.provision.win32.executable = '../evil.exe'
    for (const t of [noHash, noPick, http, escape]) expect(ProjectDefinition.safeParse(withTool(t)).success).toBe(false)
  })
})

describe('how to play', () => {
  const ids = files.map((f) => f.replace(/\.json$/, ''))
  it.each(files)('%s has steps that only link to known projects', (file) => {
    const p = ProjectDefinition.parse(JSON.parse(readFileSync(join(dir, 'projects', file), 'utf8')))
    expect(p.howToPlay.length).toBeGreaterThan(0)
    for (const s of p.howToPlay) if (s.project) expect(ids).toContain(s.project)
  })
})

describe('extras', () => {
  const base = JSON.parse(readFileSync(join(dir, 'projects', 'driftengine-tekken3.json'), 'utf8'))
  const remaster = () => JSON.parse(JSON.stringify(base.install.extras[0]))
  const withExtra = (x: unknown) => ({ ...base, install: { ...base.install, extras: [x] } })
  it("lets DriftEngine make its remaster from the hub, with uv pinned by SHA-256", () => {
    const p = ProjectDefinition.parse(base)
    const x = p.install!.extras.find((e) => e.id === 'remaster')!
    expect(x.steps).toEqual([expect.objectContaining({ type: 'run', base: 'path', args: ['scripts/remaster.mjs'] })])
    expect(x.done).toEqual(['public/assets/remaster/manifest.json'])
    expect(x.tools[0].provision?.win32?.sha256).toMatch(/^[0-9a-f]{64}$/)
    for (const s of x.steps) if (s.type === 'run' && typeof s.progress === 'object') for (const pat of s.progress.patterns) expect(() => new RegExp(pat.match)).not.toThrow()
  })
  it('lists the extras\' tools with the installation\'s, each once', () => {
    const p = ProjectDefinition.parse(base)
    expect(allTools(p.install).map((t) => t.id)).toEqual(['node', 'ffmpeg', 'uv'])
  })
  it('refuses steps other than run and pythonVenv, a duplicate id, and a tool step naming an unknown tool', () => {
    const download = remaster()
    download.steps = [{ type: 'download', from: 'source' }]
    expect(ProjectDefinition.safeParse(withExtra(download)).success).toBe(false)
    expect(ProjectDefinition.safeParse({ ...base, install: { ...base.install, extras: [remaster(), remaster()] } }).success).toBe(false)
    const unknownTool = remaster()
    unknownTool.steps[0] = { ...unknownTool.steps[0], base: 'tool', command: { win32: 'nope' } }
    const r = ProjectDefinition.safeParse(withExtra(unknownTool))
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toContain('install.extras.0.steps.0.command.win32')
  })
})
