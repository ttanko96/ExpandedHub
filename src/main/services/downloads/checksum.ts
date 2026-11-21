import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** Streamed SHA-256 of a file; never loads the whole file into memory. */
export function sha256File(path: string, signal: AbortSignal, onProgress?: (bytes: number) => void): Promise<string> {
  return hashFile(path, 'sha256', signal, onProgress)
}

/** Streamed hash of a file (`sha256`, `sha512`), lowercase hex. */
export async function hashFile(path: string, algorithm: 'sha256' | 'sha512', signal: AbortSignal, onProgress?: (bytes: number) => void): Promise<string> {
  const hash = createHash(algorithm)
  let bytes = 0
  for await (const chunk of createReadStream(path, { signal })) {
    hash.update(chunk as Buffer)
    bytes += (chunk as Buffer).length
    onProgress?.(bytes)
  }
  return hash.digest('hex')
}

/**
 * Find the expected hash for `fileName` in a `sha256sum`-style list:
 * `<hex>  <name>` or `<hex> *<name>`, one per line.
 */
export function findChecksum(list: string, fileName: string): string | null {
  for (const line of list.split(/\r?\n/)) {
    const m = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line.trim())
    if (!m) continue
    const name = m[2].replace(/^\.\//, '').split(/[\\/]/).pop()
    if (name === fileName) return m[1].toLowerCase()
  }
  return null
}
