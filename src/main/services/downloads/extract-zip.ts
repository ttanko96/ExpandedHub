import { createWriteStream, promises as fs } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

const open = (path: string) =>
  new Promise<ZipFile>((res, rej) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (err, zip) =>
      err || !zip ? rej(err ?? new Error('Could not open archive')) : res(zip)
    )
  )

function readEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((res, rej) => {
    const entries: Entry[] = []
    zip.on('entry', (e: Entry) => {
      entries.push(e)
      zip.readEntry()
    })
    zip.once('end', () => res(entries))
    zip.once('error', rej)
    zip.readEntry()
  })
}

const openStream = (zip: ZipFile, entry: Entry) =>
  new Promise<NodeJS.ReadableStream>((res, rej) =>
    zip.openReadStream(entry, (err, stream) => (err || !stream ? rej(err ?? new Error('Unreadable entry')) : res(stream)))
  )

/** Unix mode bits live in the upper 16 bits of the external attributes. */
const isSymlink = (e: Entry) => ((e.externalFileAttributes >>> 16) & 0o170000) === 0o120000

/**
 * Extract a zip archive into `destDir`.
 *
 * - Rejects entries that would escape `destDir` (zip-slip) and skips symlinks.
 * - With `stripRoot`, removes a single top-level folder shared by every entry
 *   (GitHub source archives and many release zips have one).
 * - Fully asynchronous and streamed, so the main process stays responsive.
 */
export async function extractZip(opts: {
  archive: string
  destDir: string
  stripRoot: boolean
  signal: AbortSignal
  onProgress: (done: number, total: number) => void
  log: (line: string) => void
}): Promise<{ files: number }> {
  const zip = await open(opts.archive)
  try {
    const entries = await readEntries(zip)
    const total = entries.reduce((n, e) => n + e.uncompressedSize, 0)

    let prefix = ''
    if (opts.stripRoot) {
      const roots = new Set(entries.map((e) => e.fileName.split('/')[0]))
      const allNested = entries.every((e) => e.fileName.includes('/'))
      if (roots.size === 1 && allNested) prefix = `${[...roots][0]}/`
    }
    if (prefix) opts.log(`Stripping top-level folder "${prefix.slice(0, -1)}"`)

    const root = resolve(opts.destDir)
    await fs.mkdir(root, { recursive: true })
    let done = 0
    let files = 0

    for (const entry of entries) {
      if (opts.signal.aborted) throw opts.signal.reason ?? new Error('Aborted')
      const name = entry.fileName.slice(prefix.length)
      if (!name) continue
      if (isSymlink(entry)) {
        opts.log(`Skipped symlink ${entry.fileName}`)
        continue
      }
      const target = resolve(root, name)
      if (target !== root && !target.startsWith(root + sep)) {
        throw new Error(`Archive entry escapes the target folder: ${entry.fileName}`)
      }
      if (name.endsWith('/')) {
        await fs.mkdir(target, { recursive: true })
        continue
      }
      await fs.mkdir(dirname(target), { recursive: true })
      const counter = new Transform({
        transform(chunk: Buffer, _e, cb) {
          done += chunk.length
          opts.onProgress(done, total)
          cb(null, chunk)
        }
      })
      await pipeline(await openStream(zip, entry), counter, createWriteStream(target), { signal: opts.signal })
      const mode = (entry.externalFileAttributes >>> 16) & 0o777
      if (mode & 0o111 && process.platform !== 'win32') await fs.chmod(target, mode)
      files++
    }
    return { files }
  } finally {
    zip.close()
  }
}
