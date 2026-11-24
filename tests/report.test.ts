import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProjectDefinition, type GameDefinition } from '../src/shared/registry-schema'
import type { Operation } from '../src/shared/operations'
import type { ProjectState } from '../src/shared/types'
import { MAX_BODY, redact, ReportService } from '../src/main/services/report-service'
import { tempDir } from './helpers'

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
    sources: [{ gameId: 'disc', required: true, purpose: 'Base game' }, { gameId: 'extra', required: false, purpose: 'Extras' }],
    steps: [{ type: 'download', from: 'asset', assetPattern: { win32: 'zip' } }, { type: 'run', label: 'Setup', command: { win32: 'Setup.cmd' } }, { type: 'finalize' }]
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
    steps: [{ type: 'download', from: 'asset', assetPattern: { win32: 'zip' } }, { type: 'finalize' }]
  }
})
const games = [{ id: 'disc', name: 'Base disc' }, { id: 'extra', name: 'Extra disc' }] as GameDefinition[]

const state = (projectId: string, version: string, extra: Partial<ProjectState> = {}): ProjectState => ({
  projectId,
  status: 'up-to-date',
  installed: { projectId, version, installedAt: '', installPath: `C:/Games/${projectId}`, versionSource: 'hub' },
  latest: null,
  latestCommit: null,
  stars: null,
  checkedAt: null,
  error: null,
  rebuild: [],
  missing: false,
  ...extra
})

function service(logLines: string[]) {
  const logs = tempDir()
  mkdirSync(logs, { recursive: true })
  writeFileSync(join(logs, 'op1.log'), logLines.join('\n'))
  const op = { id: 'op1', projectId: 'expanded', kind: 'build', tag: 'v1.5.1', version: '1.5.1', status: 'failed', error: `Setup failed in ${homedir()}\\build`, finishedAt: '2026-11-24T10:00:00.000Z' } as Operation
  return new ReportService({
    registry: { get: async () => ({ projects: [host, addon], games, issues: [] }) },
    states: async () => [state('expanded', '1.5.1', { rebuild: ['TMST was added'] }), state('tmst', '1.1.0')],
    sources: async () => [{ gameId: 'disc', path: 'C:/discs/t3.cue', size: 1, validation: { verdict: 'verified', message: '', matched: 'Tekken 3 (USA)', checkedAt: '' } }],
    operations: () => [op],
    hubVersion: '1.1.0',
    logsDir: logs,
    platform: 'win32'
  })
}

describe('drafting a problem report', () => {
  it('fills in the setup, game files, last operation and the end of its log, without the home folder', async () => {
    const r = await service(['first line', `opened ${homedir()}\\AppData\\x`, 'last line']).draft('expanded')
    expect(r.url).toBe('https://github.com/o/expanded/issues/new')
    expect(r.title).toMatch(/^Build failed: Setup failed in ~/)
    expect(r.body).toContain('**Expanded:** v1.5.1 (installed by the hub)')
    expect(r.body).toContain('**TMST** (add-on inside it): v1.1.0')
    expect(r.body).toContain('Needs Build again:** TMST was added')
    expect(r.body).toContain('Base disc: verified (Tekken 3 (USA))')
    expect(r.body).toContain('Extra disc (optional): not chosen')
    expect(r.body).toContain('**ExpandedHub:** v1.1.0')
    expect(r.body).toContain('last line')
    expect(r.body).not.toContain('C:/discs')
    expect(r.body).not.toContain(homedir())
  })

  it('keeps the end of a long log within the size GitHub takes', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i} ${'x'.repeat(300)}`)
    const r = await service(lines).draft('expanded')
    expect(r.body.length).toBeLessThanOrEqual(MAX_BODY)
    expect(r.body).toContain('line 39')
    expect(r.body).not.toContain('line 0 ')
  })

  it('replaces the user name in paths outside the home folder too', () => {
    const name = userInfo().username
    expect(redact(`D:\\Users\\${name}\\x`)).toBe('D:\\Users\\<user>\\x')
  })
})
