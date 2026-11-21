import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import type { ToolStatus } from '@shared/install'
import type { ToolRequirement } from '@shared/registry-schema'
import { JsonStore } from '../json-store'
import { paths } from '../paths'
import { currentPath, envWithPath, findOnPath, versionAtLeast } from './system-path'

const CACHE_MS = 60_000

/**
 * Detects tools a project needs by running its `detect` command
 * (e.g. `py -3 --version`). No shell is involved: the command is split into
 * an executable and arguments. Results are cached briefly.
 *
 * Tools with `pick` in the registry (a portable PPSSPP, say) are chosen by the
 * user instead: the path is kept in `tools.json` and handed to scripts.
 */
export class ToolsService {
  private cache = new Map<string, { at: number; found: boolean; version: string | null }>()
  private store = new JsonStore<{ paths: Record<string, string> }>(join(paths.userData(), 'tools.json'), () => ({ paths: {} }))

  async check(tools: ToolRequirement[]): Promise<ToolStatus[]> {
    const relevant = tools.filter((t) => !t.platforms || t.platforms.includes(process.platform as 'win32'))
    const chosen = await this.paths()
    return Promise.all(
      relevant.map(async (t): Promise<ToolStatus> => {
        const base = { id: t.id, name: t.name, optional: t.optional, url: t.url }
        if (t.pick) {
          const path = chosen.get(t.id) ?? null
          const problem = path ? await markerProblem(t, path) : null
          if (path && !problem) return { ...base, found: true, version: null, pick: t.pick, path, problem: null }
          // Not chosen (or no longer there): a detect command may still find it.
          const r = t.detect ? await this.detect(t.detect) : null
          return { ...base, found: r?.found ? true : false, version: r?.version ?? null, pick: t.pick, path, problem }
        }
        if (!t.detect) return { ...base, found: null, version: null }
        const r = await this.detect(t.detect)
        if (r.found && t.minVersion && r.version && /^\d/.test(r.version) && !versionAtLeast(r.version, t.minVersion)) {
          return { ...base, found: false, version: r.version, problem: `Version ${r.version} found; ${t.minVersion} or newer is needed` }
        }
        return { ...base, found: r.found, version: r.version }
      })
    )
  }

  /** Tool paths the user chose, by tool id; only the ones still on disk. */
  async paths(): Promise<Map<string, string>> {
    const all = (await this.store.read()).paths ?? {}
    const out = new Map<string, string>()
    for (const [id, p] of Object.entries(all)) {
      if (await fs.stat(p).then(() => true, () => false)) out.set(id, p)
    }
    return out
  }

  /**
   * The search path as a new terminal sees it, with the folders of the tools
   * the hub installed or the user chose put first. Programs those tools bring
   * along (npm beside node.exe, ffmpeg) are then found by scripts and Play
   * like an installed program, without touching the machine's own PATH.
   */
  async searchPath(): Promise<string> {
    const dirs: string[] = []
    for (const p of (await this.paths()).values()) {
      const isFile = await fs.stat(p).then((s) => s.isFile(), () => false)
      dirs.push(isFile ? dirname(p) : p)
    }
    return [...new Set(dirs), await currentPath()].filter(Boolean).join(delimiter)
  }

  /**
   * The program to run for a tool (a run step's `base: "tool"`, `output.launch`):
   * the file the user chose, the first marker inside a chosen folder, else what
   * its `detect` command's program is on the search path. Null when none is found.
   */
  async program(tool: ToolRequirement): Promise<string | null> {
    const chosen = tool.pick ? (await this.paths()).get(tool.id) : undefined
    if (chosen && !(await markerProblem(tool, chosen))) {
      if (tool.pick?.kind === 'file') return chosen
      for (const m of tool.pick?.markers ?? []) {
        const full = join(chosen, m)
        if (await fs.stat(full).then((s) => s.isFile(), () => false)) return full
      }
    }
    const name = tool.detect?.split(/\s+/)[0]
    return name ? findOnPath(name, await this.searchPath()) : null
  }

  /**
   * Remember the path chosen for a tool after checking it holds one of the
   * tool's markers. A file chosen for a folder tool stands for its folder.
   */
  async choose(tool: ToolRequirement, chosen: string): Promise<string> {
    let path = chosen
    if (tool.pick?.kind === 'folder' && (await fs.stat(chosen).then((s) => s.isFile(), () => false))) path = dirname(chosen)
    const problem = await markerProblem(tool, path)
    if (problem) throw new Error(problem)
    await this.store.update((s) => ({ paths: { ...(s.paths ?? {}), [tool.id]: path } }))
    return path
  }

  async clear(id: string): Promise<void> {
    await this.store.update((s) => {
      const next = { ...(s.paths ?? {}) }
      delete next[id]
      return { paths: next }
    })
  }

  private async detect(command: string): Promise<{ found: boolean; version: string | null }> {
    const hit = this.cache.get(command)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit
    const [name, ...args] = command.split(/\s+/)
    // The search path as a new terminal sees it (plus the hub's own tools), so a tool installed while the hub is open is found.
    const path = await this.searchPath()
    const exe = (await findOnPath(name, path)) ?? name
    // Batch files (npm.cmd) only run through cmd.exe.
    const viaCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)
    const file = viaCmd ? process.env.ComSpec || 'cmd.exe' : exe
    const argv = viaCmd ? ['/d', '/s', '/c', `""${exe}" ${args.join(' ')}"`] : args
    const result = await new Promise<{ found: boolean; version: string | null }>((res) => {
      execFile(file, argv, { timeout: 8000, windowsHide: true, env: envWithPath(path), windowsVerbatimArguments: viaCmd }, (err, stdout, stderr) => {
        if (err) return res({ found: false, version: null })
        const line = `${stdout}\n${stderr}`.split(/\r?\n/).find((l) => l.trim()) ?? ''
        const v = /(\d+\.\d+(?:\.\d+)?)/.exec(line)
        res({ found: true, version: v ? v[1] : line.trim().slice(0, 40) || null })
      })
    })
    this.cache.set(command, { at: Date.now(), ...result })
    return result
  }

  clearCache(): void {
    this.cache.clear()
  }
}

/** Why `path` is not this tool, or null when it is (or the registry names no markers). */
export async function markerProblem(tool: ToolRequirement, path: string): Promise<string | null> {
  const markers = tool.pick?.markers ?? []
  const stat = await fs.stat(path).catch(() => null)
  if (!stat) return `${path} is not there any more`
  if (markers.length === 0) return null
  if (tool.pick?.kind === 'file') {
    return markers.some((m) => m.toLowerCase() === basename(path).toLowerCase()) ? null : `Choose ${markers.join(' or ')}`
  }
  for (const m of markers) if (await fs.stat(join(path, m)).then((s) => s.isFile(), () => false)) return null
  return `This folder has no ${markers.join(' or ')}`
}
