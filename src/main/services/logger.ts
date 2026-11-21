import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

const MAX_BYTES = 1_000_000
let debug = false

const file = () => join(paths.userData(), 'logs', 'main.log')

/** Rotating application log (`<userData>/logs/main.log`, one backup). Never throws. */
export function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, detail?: unknown): void {
  if (level === 'debug' && !debug) return
  const extra = detail instanceof Error ? `\n${detail.stack ?? detail.message}` : detail !== undefined ? ` ${safeJson(detail)}` : ''
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${extra}\n`
  if (level === 'error') console.error(line.trimEnd())
  else if (debug) console.log(line.trimEnd())
  try {
    mkdirSync(join(paths.userData(), 'logs'), { recursive: true })
    try {
      if (statSync(file()).size > MAX_BYTES) renameSync(file(), `${file()}.1`)
    } catch {
      /* no log yet */
    }
    appendFileSync(file(), line, 'utf8')
  } catch {
    /* logging must never crash the app */
  }
}

export function setDebug(on: boolean): void {
  debug = on
}

export const logFile = file

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
