import { net } from 'electron'
import { createWriteStream, promises as fs } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

/** Hosts release files may be served from (GitHub redirects downloads to its CDN). */
const ALLOWED_HOSTS = [
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]

export function isAllowedDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname)
  } catch {
    return false
  }
}

export interface DownloadProgress {
  received: number
  total: number
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * `application/octet-stream` makes the API's release-asset endpoint send the
 * file itself; the source-archive endpoints (zipball/tarball) refuse it with 415.
 */
export function acceptFor(url: string): string {
  return /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\//.test(url) ? 'application/octet-stream' : '*/*'
}

/**
 * Download `url` into `partPath`, resuming from the bytes already on disk when
 * the server supports range requests. Uses Electron's network stack, so the
 * system proxy settings apply. Abort with `signal` to pause or cancel.
 */
export async function downloadToFile(opts: {
  url: string
  partPath: string
  signal: AbortSignal
  onProgress: (p: DownloadProgress) => void
  log: (line: string) => void
  userAgent: string
}): Promise<{ total: number; resumed: boolean }> {
  if (!isAllowedDownloadUrl(opts.url)) throw new Error(`Refusing to download from an unexpected host: ${opts.url}`)

  let existing = 0
  try {
    existing = (await fs.stat(opts.partPath)).size
  } catch {
    existing = 0
  }

  const headers: Record<string, string> = { 'User-Agent': opts.userAgent, Accept: acceptFor(opts.url) }
  if (existing > 0) headers.Range = `bytes=${existing}-`

  const res = await net.fetch(opts.url, { headers, signal: opts.signal, redirect: 'follow' })
  if (res.url && !isAllowedDownloadUrl(res.url)) throw new Error(`Download was redirected to an unexpected host: ${new URL(res.url).hostname}`)

  if (res.status === 416 && existing > 0) {
    // Range not satisfiable: the part file is already complete.
    opts.log(`Server reports the file is already complete (${existing} bytes)`)
    opts.onProgress({ received: existing, total: existing })
    return { total: existing, resumed: true }
  }
  if (!res.ok || !res.body) throw new HttpError(res.status, `Server answered ${res.status} ${res.statusText}`)

  let append = false
  let total = Number(res.headers.get('content-length') ?? 0)
  if (res.status === 206) {
    append = true
    const range = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')
    total = range ? Number(range[1]) : existing + total
    opts.log(`Resuming at ${existing} of ${total} bytes`)
  } else {
    if (existing > 0) opts.log('Server does not support resuming; starting over')
    existing = 0
    opts.log(`Downloading ${total > 0 ? `${total} bytes` : '(size unknown)'} from ${new URL(res.url || opts.url).hostname}`)
  }

  let received = existing
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      opts.onProgress({ received, total })
      cb(null, chunk)
    }
  })

  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    counter,
    createWriteStream(opts.partPath, { flags: append ? 'a' : 'w' }),
    { signal: opts.signal }
  )

  if (total > 0 && received !== total) throw new Error(`Download incomplete: got ${received} of ${total} bytes`)
  return { total: received, resumed: append }
}

/** Fetch a small text file, e.g. a checksum list. */
export async function fetchText(url: string, signal: AbortSignal, userAgent: string): Promise<string> {
  if (!isAllowedDownloadUrl(url)) throw new Error(`Refusing to download from an unexpected host: ${url}`)
  const res = await net.fetch(url, { headers: { 'User-Agent': userAgent }, signal, redirect: 'follow' })
  if (!res.ok) throw new HttpError(res.status, `Server answered ${res.status} ${res.statusText}`)
  const text = await res.text()
  if (text.length > 1_000_000) throw new Error('Checksum file is unexpectedly large')
  return text
}
