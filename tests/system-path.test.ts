import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { envWithPath, findOnPath, versionAtLeast } from '../src/main/services/install/system-path'
import { tempDir } from './helpers'

describe('versions', () => {
  it('compares dotted versions, missing parts as 0', () => {
    expect(versionAtLeast('22.13.1', '22.12')).toBe(true)
    expect(versionAtLeast('22.12', '22.12.0')).toBe(true)
    expect(versionAtLeast('22.11.9', '22.12')).toBe(false)
    expect(versionAtLeast('24.0.0', '22.18')).toBe(true)
    expect(versionAtLeast('9.9', '10')).toBe(false)
  })
})

describe('programs on the search path', () => {
  const isWin = process.platform === 'win32'
  const setup = () => {
    const root = tempDir()
    const a = join(root, 'a')
    const b = join(root, 'b')
    mkdirSync(a)
    mkdirSync(b)
    const file = isWin ? 'tool.cmd' : 'tool'
    writeFileSync(join(b, file), '')
    return { path: [a, b].join(delimiter), expected: join(b, file) }
  }

  it('finds a program by its bare name (Windows: with PATHEXT)', async () => {
    const { path, expected } = setup()
    // Windows file names ignore case, and PATHEXT spells the extensions in capitals.
    const found = await findOnPath('tool', path)
    expect(isWin ? found?.toLowerCase() : found).toBe(isWin ? expected.toLowerCase() : expected)
    expect(await findOnPath('missing', path)).toBeNull()
  })

  it('refuses names with folders in them', async () => {
    const { path } = setup()
    expect(await findOnPath('../b/tool', path)).toBeNull()
    expect(await findOnPath('b/tool', path)).toBeNull()
    expect(await findOnPath('', path)).toBeNull()
  })

  it('keeps one PATH key whatever its case, and adds extra variables', () => {
    const env = envWithPath('X', { NODE_OPTIONS: '--experimental-strip-types' })
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toHaveLength(1)
    expect(env[isWin ? 'Path' : 'PATH']).toBe('X')
    expect(env.NODE_OPTIONS).toBe('--experimental-strip-types')
  })
})
