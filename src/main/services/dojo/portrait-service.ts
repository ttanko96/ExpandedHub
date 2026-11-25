import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { decodePortrait, PORTRAIT_FILES, PORTRAIT_HEIGHT, PORTRAIT_MOD_DIRS, PORTRAIT_WIDTH } from '@shared/dojo-portraits'
import type { DojoPortraits } from '@shared/types'
import { log } from '../logger'
import { encodePng } from './png'

const EXPANDED = 'tekken3-expanded'

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
      if (await fs.stat(join(dir, 'arcade-stages')).then((s) => s.isDirectory(), () => false)) return dir
      if (await fs.stat(join(dir, 'ttt1')).then((s) => s.isDirectory(), () => false)) return dir
    }
    return null
  }

  /** The portraits available now: fighter id → media URL. Empty when switched off or nothing is installed. */
  async list(): Promise<DojoPortraits> {
    const enabled = await this.deps.enabled()
    const found: Record<string, string> = {}
    const dir = enabled ? await this.modsDir() : null
    if (dir) {
      await fs.mkdir(this.deps.cacheDir(), { recursive: true })
      for (const [fighter, rel] of Object.entries(PORTRAIT_FILES)) {
        const png = await this.convert(fighter, join(dir, ...rel.split('/'))).catch((err) => {
          log('warn', `Dojo portrait ${fighter}: ${String(err)}`)
          return null
        })
        if (png) found[fighter] = `expandedhub-media://portrait/${encodeURIComponent(fighter)}.png?v=${png}`
      }
    }
    return { enabled, source: dir ? 'tekken3-expanded' : null, portraits: found }
  }

  /** Makes the fighter's PNG when missing or older than the game's file; its version stamp, or null without a source. */
  private async convert(fighter: string, src: string): Promise<number | null> {
    const st = await fs.stat(src).catch(() => null)
    if (!st?.isFile()) return null
    const out = join(this.deps.cacheDir(), `${fighter}.png`)
    const have = await fs.stat(out).catch(() => null)
    const stamp = Math.round(st.mtimeMs)
    if (have && have.mtimeMs >= st.mtimeMs) return stamp
    const rgba = decodePortrait(await fs.readFile(src))
    if (!rgba) throw new Error(`${src} is not a ${PORTRAIT_WIDTH} x ${PORTRAIT_HEIGHT} portrait`)
    await fs.writeFile(out, encodePng(rgba, PORTRAIT_WIDTH, PORTRAIT_HEIGHT))
    return stamp
  }

  /** A `expandedhub-media://portrait/<fighter>.png` request → the cached file, or null (also when switched off). */
  async path(name: string): Promise<string | null> {
    const fighter = name.replace(/\.png$/, '')
    if (!(fighter in PORTRAIT_FILES) || !(await this.deps.enabled())) return null
    const file = join(this.deps.cacheDir(), `${fighter}.png`)
    return (await fs.stat(file).then((s) => s.isFile(), () => false)) ? file : null
  }

  /** Removes the converted PNGs (switching the portraits off). */
  async clear(): Promise<void> {
    await fs.rm(this.deps.cacheDir(), { recursive: true, force: true })
  }
}
