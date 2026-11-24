import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import type { SourceConfig, SourceValidation } from '@shared/install'
import type { GameDefinition } from '@shared/registry-schema'
import { JsonStore } from '../json-store'
import { paths } from '../paths'
import { readDiscSerial } from './disc-id'
import type { RegistryService } from '../registry-service'

/**
 * Central store of the user's own game files (disc images, ROM sets), reused
 * by every project. ExpandedHub never downloads or ships these files; it only
 * remembers where they are and checks them against known good hashes.
 *
 * Validation strategy, chosen by file type:
 * - `.zip` (MAME ROM sets): SHA-1 of every member; any known hash matches.
 *   Member names differ between MAME versions, contents do not.
 * - `.cue`: SHA-1 of the first `.bin` it references (Redump track 1).
 * - anything else: SHA-1 of the whole file.
 */
export class SourcesService {
  private store = new JsonStore<{ sources: Record<string, SourceConfig> }>(join(paths.userData(), 'sources.json'), () => ({ sources: {} }))
  private validating = new Set<string>()
  private listeners = new Set<(s: SourceConfig[]) => void>()

  constructor(private readonly registry: RegistryService) {}

  async list(): Promise<SourceConfig[]> {
    return Object.values((await this.store.read()).sources).map((s) => ({ ...s, validating: this.validating.has(s.gameId) }))
  }

  async get(gameId: string): Promise<SourceConfig | null> {
    return (await this.store.read()).sources[gameId] ?? null
  }

  isValidating(gameId: string): boolean {
    return this.validating.has(gameId)
  }

  onChange(l: (s: SourceConfig[]) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  /** Assign a file to a game and validate it. */
  async assign(gameId: string, path: string): Promise<SourceConfig> {
    const game = await this.game(gameId)
    if (!isAbsolute(path)) throw new Error('Choose a file from the file picker')
    const ext = extname(path).slice(1).toLowerCase()
    if (!game.extensions.includes(ext)) {
      throw new Error(`${game.name} expects a .${game.extensions.join(', .')} file, not .${ext || '(none)'}`)
    }
    const stat = await fs.stat(path)
    if (!stat.isFile()) throw new Error('That is not a file')
    const config: SourceConfig = { gameId, path, size: stat.size, validation: null }
    this.validating.delete(gameId)
    await this.save(config)
    void this.validate(gameId)
    return config
  }

  async remove(gameId: string): Promise<void> {
    await this.store.update((s) => {
      const { [gameId]: _gone, ...rest } = s.sources
      return { sources: rest }
    })
    await this.emit()
  }

  /** (Re)check a configured file. Runs in the background; listeners get the result. */
  async validate(gameId: string): Promise<SourceValidation | null> {
    const config = await this.get(gameId)
    if (!config || this.validating.has(gameId)) return config?.validation ?? null
    this.validating.add(gameId)
    await this.emit()
    let validation: SourceValidation
    try {
      validation = await this.check(await this.game(gameId), config.path)
    } catch (err) {
      validation = { verdict: 'invalid', message: `Could not read the file: ${err instanceof Error ? err.message : String(err)}`, checkedAt: now() }
    } finally {
      this.validating.delete(gameId)
    }
    const latest = await this.get(gameId)
    if (latest && latest.path === config.path) await this.save({ ...latest, validation })
    else await this.emit()
    return validation
  }

  private async check(game: GameDefinition, path: string): Promise<SourceValidation> {
    try {
      await fs.access(path)
    } catch {
      return { verdict: 'missing', message: 'The file is no longer at this location', checkedAt: now() }
    }
    const known = new Map(game.knownHashes.filter((h) => h.algorithm === 'sha1').map((h) => [h.value.toLowerCase(), h.label ?? h.value]))
    const ext = extname(path).slice(1).toLowerCase()

    if (ext === 'zip') {
      const hashes = await zipMemberSha1s(path)
      if (hashes.length === 0) return { verdict: 'invalid', message: 'The zip archive is empty', checkedAt: now() }
      if (known.size === 0) return { verdict: 'unverified', message: `ROM set with ${hashes.length} files (no reference hashes for this game)`, checkedAt: now() }
      const hit = hashes.find((h) => known.has(h))
      if (hit) return { verdict: 'verified', message: `Matches ${known.get(hit)}`, matched: known.get(hit), checkedAt: now() }
      // Another game's known set (another revision of the same board): say where it belongs.
      const other = (await this.registry.get()).games.find(
        (g) => g.id !== game.id && g.knownHashes.some((h) => h.algorithm === 'sha1' && hashes.includes(h.value.toLowerCase()))
      )
      return {
        verdict: 'mismatch',
        message: other
          ? `This is the ${other.name} set (${other.region ?? other.platform}): select it under ${other.name} instead`
          : 'No supported program ROM found in this set — it may be another revision',
        checkedAt: now()
      }
    }

    let target = path
    if (ext === 'cue') {
      const bin = await firstCueFile(path)
      if (!bin) return { verdict: 'invalid', message: 'The .cue sheet references no data file', checkedAt: now() }
      try {
        await fs.access(bin)
      } catch {
        return { verdict: 'invalid', message: `The .cue sheet points to a missing file: ${bin}`, checkedAt: now() }
      }
      target = bin
    }

    // Which disc it is, by its serial number: any version or dump format (not a compressed .chd).
    const serial = await readDiscSerial(target)
    const own = serial ? game.serials.find((s) => s.value === serial) : undefined
    if (serial && !own) {
      const other = (await this.registry.get()).games.find((g) => g.id !== game.id && g.serials.some((s) => s.value === serial))
      if (other) {
        const region = other.serials.find((s) => s.value === serial)!.region
        return {
          verdict: 'mismatch',
          message: `This is the ${other.name} disc (${region}, ${serial}): select it under ${other.name} instead`,
          belongsTo: other.id,
          checkedAt: now()
        }
      }
    }
    const disc = own ? `${game.name} ${own.region} disc (${serial})` : null
    // A serial the hub does not know for this game: another region or another game the projects do not name.
    const unknownSerial =
      serial && !own && game.serials.length
        ? `Serial ${serial} is not a ${game.name} disc the hub knows (${game.serials.map((s) => `${s.region} ${s.value}`).join(', ')}): the project will tell whether it reads it.`
        : null

    if (known.size === 0 || ext === 'chd' || ext === 'iso') {
      if (disc) return { verdict: 'identified', message: `${disc}, by its serial`, matched: disc, checkedAt: now() }
      if (unknownSerial) return { verdict: 'mismatch', message: unknownSerial, checkedAt: now() }
      return { verdict: 'unverified', message: serial ? `Disc ${serial} (no reference checksum to compare with)` : 'Accepted (no reference hash for this format)', checkedAt: now() }
    }
    const sha = await sha1File(target)
    if (known.has(sha)) return { verdict: 'verified', message: `Matches ${known.get(sha)}`, matched: known.get(sha), checkedAt: now() }
    return {
      verdict: 'mismatch',
      message:
        unknownSerial ??
        `${disc ? `${disc}, but not the dump the hub knows` : 'Not the expected dump'}. A single .bin holding every track, or another version, may still work — the project will tell.`,
      checkedAt: now()
    }
  }

  private async game(gameId: string): Promise<GameDefinition> {
    const g = (await this.registry.get()).games.find((x) => x.id === gameId)
    if (!g) throw new Error(`Unknown game "${gameId}"`)
    return g
  }

  private async save(config: SourceConfig): Promise<void> {
    const { validating: _v, ...stored } = config
    await this.store.update((s) => ({ sources: { ...s.sources, [config.gameId]: stored } }))
    await this.emit()
  }

  private async emit(): Promise<void> {
    const list = await this.list()
    this.listeners.forEach((l) => l(list))
  }
}

const now = () => new Date().toISOString()

async function sha1File(path: string): Promise<string> {
  const h = createHash('sha1')
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** Path of the first FILE referenced by a cue sheet, resolved next to the sheet. */
async function firstCueFile(cuePath: string): Promise<string | null> {
  const text = await fs.readFile(cuePath, 'utf8')
  const m = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/im.exec(text)
  const name = m?.[1] ?? m?.[2]
  return name ? resolve(dirname(cuePath), name) : null
}

function zipMemberSha1s(path: string): Promise<string[]> {
  return new Promise((res, rej) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip?: ZipFile) => {
      if (err || !zip) return rej(err ?? new Error('Could not open zip'))
      const hashes: string[] = []
      zip.on('error', rej)
      zip.on('end', () => res(hashes))
      zip.on('entry', (entry: Entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry()
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return rej(e2 ?? new Error('Unreadable zip member'))
          const h = createHash('sha1')
          stream.on('data', (c: Buffer) => h.update(c))
          stream.on('error', rej)
          stream.on('end', () => {
            hashes.push(h.digest('hex'))
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}
