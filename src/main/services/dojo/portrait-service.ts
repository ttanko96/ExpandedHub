import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  decodePortrait,
  PORTRAIT_FIGHTERS,
  PORTRAIT_FILES,
  PORTRAIT_HEIGHT,
  PORTRAIT_MOD_DIRS,
  PORTRAIT_WIDTH,
  TMST_IN_EXPANDED,
  TMST_PORTRAIT_DIR,
  TMST_PORTRAIT_FILES,
  tmstPortrait
} from '@shared/dojo-portraits'
import type { DojoPortraits } from '@shared/types'
import { log } from '../logger'
import { decodePng, encodePng } from './png'

const EXPANDED = 'tekken3-expanded'
const TMST = 'tmst-addon'
/** How the cached PNGs are made; a new value makes them all again (2: TMST portraits keyed and stretched). */
const CACHE_FORMAT = '2'
const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false)

interface Deps {
  /** Installed projects, by id (the installed-projects record). */
  installed: () => Promise<Record<string, { installPath: string } | undefined>>
  /** The player's choice in Settings → Dojo. */
  enabled: () => Promise<boolean>
  /** Where the PNGs are kept (in the hub's own data folder, never anywhere else). */
  cacheDir: () => string
}

/**
 * The Dojo's fighter portraits, from the player's own Tekken 3 Expanded installation (see
 * `@shared/dojo-portraits`). Each one is converted to a PNG once and served through
 * `expandedhub-media://portrait/<fighter>.png`; a newer file in the game makes it again.
 */
export class PortraitService {
  constructor(private readonly deps: Deps) {}

  /** The game's `mods` folder of the installed Tekken 3 Expanded, or null. */
  private async modsDir(): Promise<string | null> {
    const rec = (await this.deps.installed())[EXPANDED]
    if (!rec) return null
    for (const sub of PORTRAIT_MOD_DIRS) {
      const dir = join(rec.installPath, ...sub.split('/'))
      if (await isDir(join(dir, 'arcade-stages'))) return dir
      if (await isDir(join(dir, 'ttt1'))) return dir
    }
    return null
  }

  /** The TMST add-on's rendered Tournament Mode portraits, or null: its own installation first, then inside Tekken 3 Expanded. */
  private async tmstDir(): Promise<string | null> {
    const all = await this.deps.installed()
    const expanded = all[EXPANDED]?.installPath
    for (const root of [all[TMST]?.installPath, expanded && join(expanded, ...TMST_IN_EXPANDED.split('/'))]) {
      if (!root) continue
      const dir = join(root, ...TMST_PORTRAIT_DIR.split('/'))
      if (await isDir(dir)) return dir
    }
    return null
  }

  /** The portraits available now: fighter id → media URL. Empty when switched off or nothing is installed. */
  async list(): Promise<DojoPortraits> {
    const enabled = await this.deps.enabled()
    const found: Record<string, string> = {}
    const dir = enabled ? await this.modsDir() : null
    const tmst = enabled ? await this.tmstDir() : null
    const add = async (fighter: string, make: () => Promise<number | null>) => {
      const png = await make().catch((err) => {
        log('warn', `Dojo portrait ${fighter}: ${String(err)}`)
        return null
      })
      if (png) found[fighter] = `expandedhub-media://portrait/${encodeURIComponent(fighter)}.png?v=${CACHE_FORMAT}.${png}`
    }
    if (dir || tmst) await this.prepareCache()
    if (dir) {
      for (const [fighter, rel] of Object.entries(PORTRAIT_FILES)) await add(fighter, () => this.convert(fighter, join(dir, ...rel.split('/'))))
    }
    // Anna, Gon and Dr. B: only TMST has them (it lives inside Tekken 3 Expanded, hence the same source).
    if (tmst) {
      for (const [fighter, file] of Object.entries(TMST_PORTRAIT_FILES)) await add(fighter, () => this.tmstPng(fighter, join(tmst, file)))
    }
    return { enabled, source: dir || tmst ? 'tekken3-expanded' : null, portraits: found }
  }

  /** The cache folder, emptied first when its images were made the older way. */
  private async prepareCache(): Promise<void> {
    const marker = join(this.deps.cacheDir(), 'format')
    if ((await fs.readFile(marker, 'utf8').catch(() => '')) === CACHE_FORMAT) return
    await fs.rm(this.deps.cacheDir(), { recursive: true, force: true })
    await fs.mkdir(this.deps.cacheDir(), { recursive: true })
    await fs.writeFile(marker, CACHE_FORMAT)
  }

  /** Makes the fighter's PNG with `make` when missing or older than `src`; its version stamp, or null without a source. */
  private async refresh(fighter: string, src: string, make: (data: Buffer) => Buffer): Promise<number | null> {
    const st = await fs.stat(src).catch(() => null)
    if (!st?.isFile()) return null
    const out = join(this.deps.cacheDir(), `${fighter}.png`)
    const have = await fs.stat(out).catch(() => null)
    const stamp = Math.round(st.mtimeMs)
    if (have && have.mtimeMs >= st.mtimeMs) return stamp
    await fs.writeFile(out, make(await fs.readFile(src)))
    return stamp
  }

  /** A portrait file of the game, turned into a PNG. */
  private convert(fighter: string, src: string): Promise<number | null> {
    return this.refresh(fighter, src, (data) => {
      const rgba = decodePortrait(data)
      if (!rgba) throw new Error(`${src} is not a ${PORTRAIT_WIDTH} x ${PORTRAIT_HEIGHT} portrait`)
      return encodePng(rgba, PORTRAIT_WIDTH, PORTRAIT_HEIGHT)
    })
  }

  /** A PNG the TMST add-on rendered: its magenta made transparent, stretched to the size of the others. */
  private tmstPng(fighter: string, src: string): Promise<number | null> {
    return this.refresh(fighter, src, (data) => {
      const png = decodePng(data)
      const rgba = png && tmstPortrait(png.rgba, png.width, png.height)
      if (!rgba) throw new Error(`${src} is not a TMST portrait (an 8-bit RGB PNG, ${PORTRAIT_HEIGHT} pixels tall)`)
      return encodePng(rgba, PORTRAIT_WIDTH, PORTRAIT_HEIGHT)
    })
  }

  /** A `expandedhub-media://portrait/<fighter>.png` request → the cached file, or null (also when switched off). */
  async path(name: string): Promise<string | null> {
    const fighter = name.replace(/\.png$/, '')
    if (!PORTRAIT_FIGHTERS.has(fighter) || !(await this.deps.enabled())) return null
    const file = join(this.deps.cacheDir(), `${fighter}.png`)
    return (await fs.stat(file).then((s) => s.isFile(), () => false)) ? file : null
  }

  /** Removes the converted PNGs (switching the portraits off). */
  async clear(): Promise<void> {
    await fs.rm(this.deps.cacheDir(), { recursive: true, force: true })
  }
}
