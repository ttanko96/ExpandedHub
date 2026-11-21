/**
 * Recognising an installation the user already has: is this folder the
 * project, and which version is it? Used when the user browses to an existing
 * folder from the Mods page (see `AdoptService`).
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import semver from 'semver'
import type { InstallableProject, OsPlatform } from '@shared/registry-schema'
import { normalizeVersion } from '@shared/status'
import type { ReleaseInfo, VersionSource } from '@shared/types'
import { findOutputs } from './run-script'
import { findOnPath } from './system-path'

/** Written by the hub into every folder it installs, so a reinstalled hub recognises it. */
export const MARKER_FILE = '.expandedhub.json'

export interface HubMarker {
  projectId: string
  version: string
  tag?: string
  installedAt?: string
}

export interface DetectedVersion {
  version: string
  source: VersionSource
  /** For the user: where the version came from. */
  detail: string
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false)

export async function readMarker(dir: string): Promise<HubMarker | null> {
  try {
    const text = await fs.readFile(join(dir, MARKER_FILE), 'utf8')
    const m = JSON.parse(text) as Partial<HubMarker>
    return typeof m.projectId === 'string' && typeof m.version === 'string' ? (m as HubMarker) : null
  } catch {
    return null
  }
}

export async function writeMarker(dir: string, marker: HubMarker): Promise<void> {
  await fs.writeFile(join(dir, MARKER_FILE), JSON.stringify(marker, null, 2) + '\n').catch(() => {
    /* a read-only folder just is not recognised later */
  })
}

/** Files that show a folder is this project: the registry's `detect.markers`, else what the install steps run and make. */
export function folderMarkers(project: InstallableProject, platform: OsPlatform): string[] {
  const custom = project.install.detect?.markers ?? []
  if (custom.length) return custom
  const out = new Set<string>()
  const exe = project.install.output.executable?.[platform]
  if (exe) out.add(exe)
  for (const s of project.install.steps) {
    if (s.type === 'locateOutput') s.patterns.forEach((p) => out.add(p))
    if (s.type === 'run' && s.base === 'install' && s.command[platform]) out.add(s.command[platform]!)
    if (s.type === 'pythonVenv') s.requirements.forEach((r) => out.add(r))
  }
  return [...out].map((p) => p.replace(/\\/g, '/'))
}

/** Whether `dir` holds the project: its hub marker, or one of its marker files. Lists what was looked for otherwise. */
export async function checkFolder(project: InstallableProject, dir: string, platform: OsPlatform): Promise<{ ok: boolean; expected: string[] }> {
  const marker = await readMarker(dir)
  if (marker?.projectId === project.id) return { ok: true, expected: [] }
  const expected = folderMarkers(project, platform)
  if (!expected.length) return { ok: true, expected }
  for (const m of expected) {
    // Plain paths are checked directly; only globs walk the folder.
    if (!/[*?]/.test(m) ? await exists(join(dir, ...m.split('/'))) : (await findOutputs(dir, [m], 4)).length > 0) return { ok: true, expected }
  }
  return { ok: false, expected }
}

/** The launchable file, as the installer's configure step would find it. */
export async function locateExecutable(project: InstallableProject, dir: string, platform: OsPlatform): Promise<string | undefined> {
  const exe = project.install.output.executable?.[platform]
  if (exe && (await exists(join(dir, ...exe.split(/[\\/]/))))) return exe
  if (project.install.output.serve || project.install.output.launch) return undefined
  const locate = project.install.steps.find((s) => s.type === 'locateOutput')
  if (locate?.type !== 'locateOutput') return exe
  const found = await findOutputs(dir, locate.patterns)
  return found.find((f) => f.toLowerCase().endsWith('.exe')) ?? found[0] ?? exe
}

/**
 * The installed version: the hub's marker, then the registry's version files,
 * then the folder's own git checkout (its newest tag, or its commit for
 * projects without releases), else unknown.
 */
export async function detectVersion(project: InstallableProject, dir: string, latest: ReleaseInfo | null): Promise<DetectedVersion> {
  const marker = await readMarker(dir)
  if (marker?.projectId === project.id) return { version: marker.version, source: 'marker', detail: `v${marker.version}, recorded by ExpandedHub when it installed it` }

  for (const v of project.install.detect?.version ?? []) {
    const text = await fs.readFile(join(dir, ...v.file.split('/')), 'utf8').catch(() => null)
    if (text === null) continue
    let m: RegExpMatchArray | null = null
    try {
      m = text.match(new RegExp(v.pattern, 'm'))
    } catch {
      continue
    }
    if (m?.[1]) {
      const version = normalizeVersion(m[1])
      return { version, source: 'file', detail: `v${version}, read from ${v.file}` }
    }
  }

  const git = await gitVersion(project, dir, latest)
  if (git) return git
  return { version: 'unknown', source: 'unknown', detail: 'The version could not be told, so the latest release is offered as an update' }
}

// ---------------------------------------------------------------------------
// git

interface GitFacts {
  sha: string
  /** Committer time, seconds since 1970; null when unknown. */
  time: number | null
  /** Tags on HEAD or its history (the CLI), or only on HEAD itself (no git installed). */
  tags: string[]
}

async function gitVersion(project: InstallableProject, dir: string, latest: ReleaseInfo | null): Promise<DetectedVersion | null> {
  if (!(await exists(join(dir, '.git')))) return null
  const facts = (await gitCli(dir)) ?? (await gitFiles(dir))
  if (!facts) return null
  const short = facts.sha.slice(0, 7)

  // Projects without releases install their latest commit (`commitRelease`).
  const commitBased = latest?.tag.startsWith('commit-') ?? false
  if (commitBased && latest) {
    if (facts.sha.startsWith(latest.tag.slice('commit-'.length))) return { version: latest.version, source: 'git', detail: `commit ${short}, the latest one` }
    if (facts.time !== null) {
      const stamp = new Date(facts.time * 1000).toISOString().replace(/\D/g, '').slice(0, 14)
      return { version: `0.0.0-${stamp}`, source: 'git', detail: `commit ${short} of ${new Date(facts.time * 1000).toLocaleDateString()}` }
    }
    return null
  }

  const repo = project.repository
  let pattern: RegExp | null = null
  try {
    pattern = repo.tagPattern ? new RegExp(repo.tagPattern) : null
  } catch {
    pattern = null
  }
  const best = facts.tags
    .filter((t) => !pattern || pattern.test(t))
    .map((t) => ({ tag: t, v: semver.valid(normalizeVersion(t)) }))
    .filter((x): x is { tag: string; v: string } => x.v !== null && (repo.includePrereleases || !semver.prerelease(x.v)))
    .sort((a, b) => semver.rcompare(a.v, b.v))[0]
  if (!best) return null
  return { version: best.v, source: 'git', detail: `${best.tag}, the newest tag in its git checkout (commit ${short})` }
}

function run(file: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((res) => {
    execFile(file, args, { cwd, timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => res(err ? null : stdout.trim()))
  })
}

const samePath = (a: string, b: string) => {
  const n = (p: string) => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b)
}

/** Facts from the git program, when it is installed. Null when the folder is not the top of its own checkout. */
async function gitCli(dir: string): Promise<GitFacts | null> {
  const git = await findOnPath('git')
  if (!git) return null
  const top = await run(git, ['rev-parse', '--show-toplevel'], dir)
  // A folder inside another checkout (an add-on inside its host) would report the host's tags.
  if (!top || !samePath(top, dir)) return null
  const head = await run(git, ['log', '-1', '--format=%H %ct'], dir)
  if (!head) return null
  const [sha, ct] = head.split(' ')
  const tags = (await run(git, ['tag', '--merged', 'HEAD'], dir)) ?? ''
  return { sha: sha!, time: Number(ct) || null, tags: tags.split(/\r?\n/).filter(Boolean) }
}

/** Facts read from `.git` directly (no git program): HEAD's commit and the tags pointing exactly at it. */
export async function gitFiles(dir: string): Promise<GitFacts | null> {
  const gitDir = join(dir, '.git')
  const st = await fs.stat(gitDir).catch(() => null)
  if (!st?.isDirectory()) return null // worktrees and submodules (a `.git` file) need the git program
  const read = (p: string) => fs.readFile(join(gitDir, p), 'utf8').catch(() => null)
  const packed = (await read('packed-refs')) ?? ''

  const resolveRef = async (ref: string): Promise<string | null> => {
    const loose = (await read(ref))?.trim()
    if (loose && /^[0-9a-f]{40}$/.test(loose)) return loose
    const line = packed.split(/\r?\n/).find((l) => l.endsWith(` ${ref}`))
    return line?.slice(0, 40) ?? null
  }

  const head = (await read('HEAD'))?.trim()
  if (!head) return null
  const sha = head.startsWith('ref: ') ? await resolveRef(head.slice(5)) : /^[0-9a-f]{40}$/.test(head) ? head : null
  if (!sha) return null

  const object = async (id: string): Promise<string | null> => {
    const raw = await fs.readFile(join(gitDir, 'objects', id.slice(0, 2), id.slice(2))).catch(() => null)
    if (!raw) return null
    try {
      return inflateSync(raw).toString('utf8')
    } catch {
      return null
    }
  }

  // Tags at HEAD: packed ones (with their peeled `^` line for annotated tags) and loose ones.
  const tags = new Set<string>()
  const lines = packed.split(/\r?\n/)
  lines.forEach((l, i) => {
    const m = l.match(/^([0-9a-f]{40}) refs\/tags\/(.+)$/)
    if (!m) return
    const peeled = lines[i + 1]?.startsWith('^') ? lines[i + 1]!.slice(1, 41) : m[1]
    if (peeled === sha) tags.add(m[2]!)
  })
  const walk = async (rel: string): Promise<void> => {
    const entries = await fs.readdir(join(gitDir, rel), { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const ref = `${rel}/${e.name}`
      if (e.isDirectory()) await walk(ref)
      else {
        const id = (await read(ref))?.trim()
        if (!id) continue
        if (id === sha) tags.add(ref.slice('refs/tags/'.length))
        else {
          // An annotated tag: its object names the commit.
          const obj = await object(id)
          // `tag <size>\0object <sha>\n…`
          if (obj?.startsWith('tag ') && obj.includes(`\0object ${sha}\n`)) tags.add(ref.slice('refs/tags/'.length))
        }
      }
    }
  }
  await walk('refs/tags')

  const commit = await object(sha)
  const time = commit?.match(/\ncommitter .* (\d+) [+-]\d{4}\n/)?.[1]
  return { sha, time: time ? Number(time) : null, tags: [...tags] }
}
