import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { InstallStep } from '@shared/registry-schema'
import { runScript } from './run-script'

type VenvStep = Extract<InstallStep, { type: 'pythonVenv' }>

const isWin = process.platform === 'win32'

/** Exit code of a short command, -1 when it cannot start. Standard input is closed. */
function probe(file: string, args: string[], cwd: string): Promise<number> {
  return new Promise((res) => {
    const child = execFile(file, args, { cwd, windowsHide: true, timeout: 60_000 }, (err) => {
      if (!err) return res(0)
      const code = (err as NodeJS.ErrnoException & { code?: unknown }).code
      res(typeof code === 'number' ? code : -1)
    })
    child.stdin?.end()
  })
}

const supportedCode = (s: VenvStep) => {
  const v = (x: string) => `(${x.split('.').map(Number).join(', ')})`
  return `import sys; sys.exit(not ${v(s.minVersion)} <= sys.version_info[:2] <= ${v(s.maxVersion)})`
}

/** The environment's Python, inside the install folder. */
export function venvPython(installDir: string, step: VenvStep): string {
  const root = resolve(installDir)
  const dir = resolve(root, step.path)
  if (!dir.startsWith(root + sep)) throw new Error(`The Python environment's folder leaves the install folder: ${step.path}`)
  return join(dir, isWin ? 'Scripts/python.exe' : 'bin/python')
}

/**
 * Make (or repair) a project's Python environment, as its own setup script
 * would: a supported Python from python.org (`py` launcher on Windows), a venv,
 * then the project's pinned requirements with pip. An environment made with an
 * unsupported or removed Python is made again.
 */
export async function ensureVenv(opts: {
  installDir: string
  step: VenvStep
  signal: AbortSignal
  log: (line: string) => void
  status: (message: string) => void
  /** Pythons to try before the installed ones: the one the hub set up or the user chose. */
  pythons?: string[]
}): Promise<void> {
  const { installDir, step, log, status } = opts
  const python = venvPython(installDir, step)
  const dir = resolve(installDir, step.path)
  const supported = supportedCode(step)

  const exists = await fs.stat(python).then((s) => s.isFile(), () => false)
  if (exists && (await probe(python, ['-c', supported], installDir)) !== 0) {
    log(`The Python environment in ${step.path} was made with an unsupported or removed Python: making it again`)
    await fs.rm(dir, { recursive: true, force: true })
  }

  if (!(await fs.stat(python).then((s) => s.isFile(), () => false))) {
    status('Finding Python')
    const candidates: [string, string[]][] = [
      ...(opts.pythons ?? []).map((p): [string, string[]] => [p, []]),
      ...(isWin
        ? step.versions.map((v): [string, string[]] => ['py', [`-${v}`]])
        : [...step.versions.map((v): [string, string[]] => [`python${v}`, []]), ['python3', []] as [string, string[]]])
    ]
    let found: [string, string[]] | null = null
    for (const [file, pre] of candidates) {
      if ((await probe(file, [...pre, '-c', supported], installDir)) === 0) {
        found = [file, pre]
        break
      }
    }
    if (!found) {
      throw new Error(
        `This project needs Python ${step.minVersion} to ${step.maxVersion} from python.org` +
          (isWin ? ' (with the "py launcher" and "tcl/tk" options ticked)' : '') +
          '. Install it, then click Retry.'
      )
    }
    status(`Creating the Python environment (${[found[0], ...found[1]].join(' ')})`)
    log(`Creating ${step.path} with ${[found[0], ...found[1]].join(' ')}`)
    const r = await runScript({ script: found[0], args: [...found[1], '-m', 'venv', step.path], cwd: installDir, env: {}, signal: opts.signal, log })
    if (r.code !== 0) throw new Error(`Could not create the Python environment in ${step.path} (exit code ${r.code})`)
  }

  if (step.check && (await probe(python, ['-c', step.check], installDir)) === 0) {
    log('Python packages already installed')
    return
  }
  for (const req of step.requirements) {
    status(`Installing Python packages (${req})`)
    const r = await runScript({
      script: python,
      args: ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--no-input', ...step.pipArgs, '-r', req],
      cwd: installDir,
      env: {},
      signal: opts.signal,
      log
    })
    if (r.code !== 0) throw new Error(`Could not install the Python packages of ${req} (exit code ${r.code}${r.tail.length ? `: ${r.tail.slice(-2).join(' / ')}` : ''})`)
  }
  if (step.packages.length) {
    status(`Installing Python packages (${step.packages.join(', ')})`)
    const r = await runScript({
      script: python,
      args: ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--no-input', ...step.pipArgs, ...step.packages],
      cwd: installDir,
      env: {},
      signal: opts.signal,
      log
    })
    if (r.code !== 0) throw new Error(`Could not install the Python packages ${step.packages.join(', ')} (exit code ${r.code}${r.tail.length ? `: ${r.tail.slice(-2).join(' / ')}` : ''})`)
  }
}
