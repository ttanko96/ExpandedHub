import { execFile, execFileSync, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

/**
 * Resolve a script shipped by a project and make sure it stays inside the
 * install directory (no `..`, no absolute paths from the registry).
 */
export async function resolveScript(installDir: string, relative: string): Promise<string> {
  const root = resolve(installDir)
  const full = resolve(root, relative)
  if (!full.startsWith(root + sep)) throw new Error(`Script path leaves the install folder: ${relative}`)
  const stat = await fs.stat(full).catch(() => null)
  if (!stat?.isFile()) throw new Error(`The project's script was not found: ${relative}`)
  return full
}

/** Windows paths cannot contain `"`, so wrapping in quotes is enough for cmd.exe. */
const quote = (s: string) => `"${s.replace(/"/g, '')}"`

/**
 * Run a project script and stream its output to `log`. Batch files run through
 * `cmd.exe /c`, shell scripts through `bash`; nothing else is interpreted.
 * Standard input is closed, so a `pause` in a batch file does not hang.
 */
export function runScript(opts: {
  script: string
  args: string[]
  cwd: string
  env: Record<string, string>
  signal: AbortSignal
  log: (line: string) => void
  /**
   * Called for every stdout line. Return true when the line was handled
   * (e.g. a progress event) so it is not copied into the log.
   */
  onLine?: (line: string) => boolean
}): Promise<{ code: number; tail: string[] }> {
  const ext = extname(opts.script).toLowerCase()
  let file: string
  let args: string[]
  let verbatim = false
  if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    file = process.env.ComSpec || 'cmd.exe'
    // cmd /s /c "<line>": the outer quotes are stripped, the inner ones keep paths with spaces intact.
    args = ['/d', '/s', '/c', `"${[quote(opts.script), ...opts.args.map(quote)].join(' ')}"`]
    verbatim = true
  } else if (ext === '.sh' || ext === '.command') {
    file = '/bin/bash'
    args = [opts.script, ...opts.args]
  } else {
    file = opts.script
    args = opts.args
  }

  return new Promise((res, rej) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      // Own process group on macOS/Linux so cancel can stop the whole tree.
      detached: process.platform !== 'win32'
    })
    const tail: string[] = []
    // A line can be split across chunks: keep the unfinished end for the next one.
    const pending: Record<string, string> = { '| ': '', '! ': '' }
    const handle = (prefix: string, line: string) => {
      if (!line.trim()) return
      if (prefix === '| ' && opts.onLine?.(line)) return
      opts.log(`${prefix}${line}`)
      tail.push(line)
      if (tail.length > 12) tail.shift()
    }
    const onData = (prefix: string) => (buf: Buffer) => {
      const lines = (pending[prefix] + buf.toString('utf8')).split(/\r?\n/)
      pending[prefix] = lines.pop() ?? ''
      for (const line of lines) handle(prefix, line)
    }
    const flush = () => {
      for (const prefix of Object.keys(pending)) {
        handle(prefix, pending[prefix])
        pending[prefix] = ''
      }
    }
    child.stdout.on('data', onData('| '))
    child.stderr.on('data', onData('! '))
    const onAbort = () => killTree(child.pid)
    opts.signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      opts.signal.removeEventListener('abort', onAbort)
      rej(err)
    })
    child.on('close', (code) => {
      flush()
      opts.signal.removeEventListener('abort', onAbort)
      if (opts.signal.aborted) rej(opts.signal.reason ?? new Error('Aborted'))
      else res({ code: code ?? -1, tail })
    })
  })
}

/** Stop a process and everything it started (Windows: `taskkill /T`; elsewhere its process group). */
export function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  else signalTree(pid)
}

/** The same, waiting for `taskkill` to finish: for the moment the hub quits. */
export function killTreeSync(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 })
    } catch {
      /* already gone */
    }
  } else signalTree(pid)
}

function signalTree(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

/** Minimal glob: `*` within a path segment, `**` across segments. Matches relative paths under `root`. */
export async function findOutputs(root: string, patterns: string[], maxDepth = 6): Promise<string[]> {
  const toRe = (p: string) =>
    new RegExp(
      '^' +
        p
          .split('/')
          .map((seg) => (seg === '**' ? '(?:.*)' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')))
          .join('/')
          .replace(/\(\?:\.\*\)\//g, '(?:.*/)?') +
        '$',
      'i'
    )
  const res = patterns.map(toRe)
  const found: string[] = []
  async function walk(dir: string, rel: string, depth: number) {
    if (depth > maxDepth || found.length > 50) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isFile() && res.some((re) => re.test(r))) found.push(r)
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') await walk(resolve(dir, e.name), r, depth + 1)
    }
  }
  await walk(resolve(root), '', 0)
  return found
}
