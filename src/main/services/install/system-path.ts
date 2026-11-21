import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { delimiter, join } from 'node:path'

const isWin = process.platform === 'win32'

/** One `Path` value from the registry (`reg query`), `%VARS%` expanded; empty when it cannot be read. */
function regPath(key: string): Promise<string> {
  return new Promise((res) => {
    execFile('reg', ['query', key, '/v', 'Path'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return res('')
      const m = /^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(.*)$/im.exec(stdout)
      res((m?.[1] ?? '').trim().replace(/%([^%]+)%/g, (all, name: string) => process.env[name] ?? all))
    })
  })
}

/**
 * The search path as a newly opened terminal would see it. On Windows the
 * machine's and the user's `Path` are read again from the registry, so a tool
 * installed while the hub is open (Node.js, say) is found on Retry without
 * restarting the hub. Elsewhere it is the hub's own PATH.
 */
export async function currentPath(): Promise<string> {
  const own = process.env.PATH ?? process.env.Path ?? ''
  if (!isWin) return own
  const [machine, user] = await Promise.all([
    regPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    regPath('HKCU\\Environment')
  ])
  const seen = new Set<string>()
  const dirs: string[] = []
  for (const d of [machine, user, own].join(delimiter).split(delimiter)) {
    const key = d.trim().toLowerCase().replace(/[\\/]+$/, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    dirs.push(d.trim())
  }
  return dirs.join(delimiter)
}

/** The hub's environment with `PATH` replaced (one key, whatever case Windows gave it) and `extra` added. */
export function envWithPath(path: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k.toUpperCase() !== 'PATH') env[k] = v
  env[isWin ? 'Path' : 'PATH'] = path
  return { ...env, ...extra }
}

/**
 * Full path of a program found on `path` (e.g. `npm` → `C:\Program Files\nodejs\npm.cmd`),
 * or null. Only bare program names are looked up: anything with a folder in it is refused.
 */
export async function findOnPath(name: string, path?: string): Promise<string | null> {
  if (!name || /[\\/]/.test(name) || name.includes('..')) return null
  const dirs = (path ?? (await currentPath())).split(delimiter).filter(Boolean)
  const exts = isWin
    ? /\.[a-z0-9]+$/i.test(name)
      ? ['']
      : (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = join(dir.replace(/^"|"$/g, ''), name + ext)
      if (await fs.stat(full).then((s) => s.isFile(), () => false)) return full
    }
  }
  return null
}

/** True when `a` (e.g. `22.13.1`) is at least `b` (e.g. `22.18`). Missing parts count as 0. */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}
