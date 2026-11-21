import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from './helpers'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => userData.dir, getVersion: () => '0.0.0-test' }, shell: {}, net: {} }))

import { ensureVenv } from '../src/main/services/install/python-venv'
import { ToolsService } from '../src/main/services/install/tools-service'

describe("the hub's own tools on the search path", () => {
  it('puts the folders of chosen tools first: a file stands for its folder', async () => {
    userData.dir = tempDir()
    const nodeDir = join(userData.dir, '_tools', 'node-22.23.5')
    const ppsspp = join(userData.dir, 'PPSSPP')
    mkdirSync(nodeDir, { recursive: true })
    mkdirSync(ppsspp, { recursive: true })
    writeFileSync(join(nodeDir, 'node.exe'), '')
    writeFileSync(
      join(userData.dir, 'tools.json'),
      JSON.stringify({ paths: { node: join(nodeDir, 'node.exe'), ppsspp, gone: join(userData.dir, 'missing.exe') } })
    )
    const dirs = (await new ToolsService().searchPath()).split(delimiter)
    expect(dirs.slice(0, 2)).toEqual([nodeDir, ppsspp])
    expect(dirs).not.toContain(userData.dir)
  })
})

/** A Python on this machine to stand in for the hub's, or null. */
function somePython(): string | null {
  for (const [cmd, args] of [
    ['py', ['-3', '-c', 'import sys; print(sys.executable)']],
    ['python', ['-c', 'import sys; print(sys.executable)']]
  ] as const) {
    try {
      const out = execFileSync(cmd, [...args], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).trim()
      if (out && existsSync(out)) return out
    } catch {
      /* try the next one */
    }
  }
  return null
}

const python = somePython()

describe('Python environments', () => {
  it.skipIf(!python)("are made with the hub's Python when no installed one matches", async () => {
    const dir = tempDir()
    const step = {
      type: 'pythonVenv' as const,
      path: '.setup/venv',
      // No `py -9.9` exists: only the Python handed over can make the environment.
      versions: ['9.9'],
      minVersion: '3.0',
      maxVersion: '9.9',
      requirements: [],
      pipArgs: [],
      packages: []
    }
    const lines: string[] = []
    await ensureVenv({ installDir: dir, step, signal: new AbortController().signal, log: (l) => lines.push(l), status: () => {}, pythons: [python!] })
    expect(lines.join('\n')).toContain(python!)
    const made = join(dir, '.setup', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    expect(existsSync(made)).toBe(true)
    expect(dirname(dirname(made))).toBe(join(dir, '.setup', 'venv'))
  }, 120_000)
})
