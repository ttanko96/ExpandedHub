import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SourceConfig } from '@shared/install'
import { findChecksum } from '../src/main/services/downloads/checksum'
import { acceptFor } from '../src/main/services/downloads/http-download'
import { extractZip } from '../src/main/services/downloads/extract-zip'
import { resolveArgs, sourceFolders } from '../src/main/services/install/planner'
import { lastErrorLine } from '../src/main/services/downloads/operations-service'
import { findOutputs, resolveScript, runScript } from '../src/main/services/install/run-script'
import { markerProblem } from '../src/main/services/install/tools-service'
import { makeZip, tempDir } from './helpers'

const noLog = () => {}

describe('checksum lists', () => {
  const list = [
    'fc00d31f439b89ad3df32fe6d11833d417706f1f726275daafadbc00b86476be  Tekken3Recompiled-v0.1.4-Easy-Setup.zip',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA *./sub/Other.zip',
    'garbage line'
  ].join('\r\n')
  it('finds a file by name, binary-mode marker and paths included', () => {
    expect(findChecksum(list, 'Tekken3Recompiled-v0.1.4-Easy-Setup.zip')).toBe('fc00d31f439b89ad3df32fe6d11833d417706f1f726275daafadbc00b86476be')
    expect(findChecksum(list, 'Other.zip')).toBe('a'.repeat(64))
    expect(findChecksum(list, 'missing.zip')).toBeNull()
  })
})

describe('zip extraction', () => {
  const extract = (zip: Buffer, stripRoot = true) => {
    const dir = tempDir()
    const archive = join(dir, 'a.zip')
    writeFileSync(archive, zip)
    const dest = join(dir, 'out')
    return { dest, run: () => extractZip({ archive, destDir: dest, stripRoot, signal: new AbortController().signal, onProgress: noLog, log: noLog }) }
  }

  it('strips a single shared top-level folder', async () => {
    const { dest, run } = extract(makeZip([{ name: 'proj-1.0/' }, { name: 'proj-1.0/a.txt', data: 'A' }, { name: 'proj-1.0/sub/b.txt', data: 'B' }]))
    expect((await run()).files).toBe(2)
    expect(readFileSync(join(dest, 'a.txt'), 'utf8')).toBe('A')
    expect(readFileSync(join(dest, 'sub', 'b.txt'), 'utf8')).toBe('B')
  })

  it('keeps the layout when entries have different roots', async () => {
    const { dest, run } = extract(makeZip([{ name: 'a.txt', data: 'A' }, { name: 'dir/b.txt', data: 'B' }]))
    await run()
    expect(existsSync(join(dest, 'a.txt'))).toBe(true)
    expect(existsSync(join(dest, 'dir', 'b.txt'))).toBe(true)
  })

  it('refuses entries that escape the target folder (zip-slip)', async () => {
    const { run } = extract(makeZip([{ name: 'ok.txt', data: 'x' }, { name: '../evil.txt', data: 'pwned' }]), false)
    await expect(run()).rejects.toThrow()
  })

  it('skips symlinks', async () => {
    const { dest, run } = extract(makeZip([{ name: 'link', data: '/etc/passwd', mode: 0o120777 }, { name: 'real.txt', data: 'r' }]), false)
    expect((await run()).files).toBe(1)
    expect(existsSync(join(dest, 'link'))).toBe(false)
  })
})

describe('chosen tools', () => {
  it('accepts a folder holding one of the markers, and explains otherwise', async () => {
    const dir = tempDir()
    const tool = { id: 'ppsspp', name: 'PPSSPP', optional: true, pick: { kind: 'folder' as const, markers: ['PPSSPPWindows64.exe', 'PPSSPPWindows.exe'] } }
    expect(await markerProblem(tool, dir)).toMatch(/no PPSSPPWindows64\.exe/)
    writeFileSync(join(dir, 'PPSSPPWindows.exe'), '')
    expect(await markerProblem(tool, dir)).toBeNull()
    expect(await markerProblem(tool, join(dir, 'gone'))).toMatch(/not there/)
  })
})

describe('download headers', () => {
  it('asks for raw bytes only from the release-asset API, never from source archives', () => {
    expect(acceptFor('https://api.github.com/repos/o/r/releases/assets/123')).toBe('application/octet-stream')
    expect(acceptFor('https://api.github.com/repos/o/r/zipball/v0.3.0')).toBe('*/*')
    expect(acceptFor('https://github.com/o/r/releases/download/v1/x.zip')).toBe('*/*')
  })
})

describe('script arguments', () => {
  const sources = new Map<string, SourceConfig>([['tekken2-ps1', { gameId: 'tekken2-ps1', path: 'D:/Games/Tekken 2.cue', size: 1, validation: null }]])
  it('fills configured game files and drops unset ones', () => {
    expect(resolveArgs(['--disc', '${source:tekken2-ps1}', '${source:ttt-ps2}', '${installDir}/x'], sources, 'C:/inst')).toEqual([
      '--disc',
      'D:/Games/Tekken 2.cue',
      'C:/inst/x'
    ])
  })

  it('adds an argument group only when its game files are (not) configured', () => {
    const jun = [
      { when: ['tekken2-ps1', 'ttt-arcade'], unless: [], args: ['--ttt1', '${source:ttt-arcade}'] },
      { when: [], unless: ['tekken2-ps1', 'ttt-arcade'], args: ['--no-jun'] }
    ]
    expect(resolveArgs(jun, sources, 'C:/inst')).toEqual(['--no-jun'])
    const both = new Map(sources)
    both.set('ttt-arcade', { gameId: 'ttt-arcade', path: 'D:/tektagt.zip', size: 1, validation: null })
    expect(resolveArgs(jun, both, 'C:/inst')).toEqual(['--ttt1', 'D:/tektagt.zip'])
  })

  it('passes a chosen tool folder only when it and the game file are set', () => {
    const dr = [{ when: ['tekken2-ps1', 'tool:ppsspp'], unless: [], args: ['--ppsspp', '${tool:ppsspp}'] }]
    expect(resolveArgs(dr, sources, 'C:/inst')).toEqual([])
    expect(resolveArgs(dr, sources, 'C:/inst', new Map([['ppsspp', 'D:/ppsspp']]))).toEqual(['--ppsspp', 'D:/ppsspp'])
  })

  it('hands a zip over as a folder under temp, any other file as its own folder', () => {
    const both = new Map(sources)
    both.set('tekken3-arcade', { gameId: 'tekken3-arcade', path: join('D:', 'roms', 'tekken3.zip'), size: 1, validation: null })
    const folders = sourceFolders(both, join('T:', 'temp'))
    expect(folders.get('tekken3-arcade')?.folder).toBe(join('T:', 'temp', 'source-folders', 'tekken3-arcade'))
    expect(folders.get('tekken2-ps1')?.folder).toBe(dirname('D:/Games/Tekken 2.cue'))
    const args = ['scripts/arcade.mjs', '${sourceFolder:tekken3-arcade}']
    expect(resolveArgs(args, both, 'C:/inst', new Map(), folders)).toEqual(['scripts/arcade.mjs', join('T:', 'temp', 'source-folders', 'tekken3-arcade')])
    expect(resolveArgs(args, sources, 'C:/inst', new Map(), sourceFolders(sources, 'T:/temp'))).toEqual(['scripts/arcade.mjs'])
  })
})

describe('optional step errors', () => {
  it('takes the message of the last Error line, past a Node stack trace', () => {
    const tail = [
      "  throw new Error(`${given}: …`);",
      'Error: D:/dump: 2 of the board\'s chips are missing or are not the supported revision\'s',
      '    at file:///x/arcade.mjs:41:9',
      'Node.js v22.13.1'
    ]
    expect(lastErrorLine(tail)).toBe("D:/dump: 2 of the board's chips are missing or are not the supported revision's")
    expect(lastErrorLine(["TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension \".ts\""])).toBe('Unknown file extension ".ts"')
    expect(lastErrorLine(['all fine'])).toBeNull()
  })
})

describe('project scripts', () => {
  it('rejects scripts outside the install folder', async () => {
    const dir = tempDir()
    await expect(resolveScript(dir, '../outside.cmd')).rejects.toThrow(/leaves the install folder/)
    await expect(resolveScript(dir, 'missing.cmd')).rejects.toThrow(/not found/)
  })

  it('finds build outputs with simple globs', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'build-release', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'Play Tekken 3.exe'), '')
    writeFileSync(join(dir, 'build-release', 'bin', 'game.exe'), '')
    expect(await findOutputs(dir, ['Play Tekken 3.exe'])).toEqual(['Play Tekken 3.exe'])
    expect(await findOutputs(dir, ['build-release/**/*.exe'])).toEqual(['build-release/bin/game.exe'])
    expect(await findOutputs(dir, ['*.dll'])).toEqual([])
  })

  it.runIf(process.platform === 'win32')('runs a batch file with spaces, arguments and env, without hanging on pause', async () => {
    const dir = join(tempDir(), 'my install')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Setup Test.cmd'), '@echo off\r\necho arg=[%~1]\r\necho env=%EXPANDEDHUB_X%\r\npause\r\nexit /b 3\r\n')
    const lines: string[] = []
    const r = await runScript({
      script: join(dir, 'Setup Test.cmd'),
      args: ['C:/a disc/Tekken 2 (USA).cue'],
      cwd: dir,
      env: { EXPANDEDHUB_X: 'ok' },
      signal: new AbortController().signal,
      log: (l) => lines.push(l)
    })
    expect(r.code).toBe(3)
    expect(lines).toContain('| arg=[C:/a disc/Tekken 2 (USA).cue]')
    expect(lines).toContain('| env=ok')
  })

  it.runIf(process.platform === 'win32')('hands progress lines to onLine and keeps them out of the log', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'Events.cmd'), '@echo off\r\necho {"event":"status","message":"Building"}\r\necho plain\r\n')
    const lines: string[] = []
    const events: string[] = []
    const r = await runScript({
      script: join(dir, 'Events.cmd'),
      args: [],
      cwd: dir,
      env: {},
      signal: new AbortController().signal,
      log: (l) => lines.push(l),
      onLine: (l) => (l.startsWith('{') ? (events.push(JSON.parse(l).message), true) : false)
    })
    expect(r.code).toBe(0)
    expect(events).toEqual(['Building'])
    expect(lines).toEqual(['| plain'])
  })

  it.runIf(process.platform === 'win32')('cancelling stops the script', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'Slow.cmd'), '@echo off\r\nping -n 30 127.0.0.1 >nul\r\n')
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort('cancel'), 500)
    const started = Date.now()
    await expect(runScript({ script: join(dir, 'Slow.cmd'), args: [], cwd: dir, env: {}, signal: ctrl.signal, log: noLog })).rejects.toBe('cancel')
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})
