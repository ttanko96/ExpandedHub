import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Screenshot } from '@shared/install'
import type { InstalledService } from '../installed-service'
import type { RegistryService } from '../registry-service'

const IMAGE = /\.(png|jpe?g|webp|gif)$/i

/**
 * Screenshots an installed project ships in its own folder (`install.screenshots`,
 * e.g. TMST's `screenshots/`), shown as a slideshow on its page. Served through
 * `expandedhub-media://screenshot/<project>/<file>`; only image files directly in
 * that folder are ever handed out.
 */
export class GalleryService {
  constructor(
    private readonly registry: RegistryService,
    private readonly installed: InstalledService
  ) {}

  private async folder(projectId: string): Promise<string | null> {
    const p = (await this.registry.get()).projects.find((x) => x.id === projectId)
    const sub = p?.install?.screenshots?.folder
    const rec = (await this.installed.all())[projectId]
    if (!sub || !rec) return null
    return join(rec.installPath, ...sub.split('/'))
  }

  /** The project's screenshots, sorted by file name (oldest first for date-stamped names). */
  async list(projectId: string): Promise<Screenshot[]> {
    const dir = await this.folder(projectId)
    if (!dir) return []
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    const files = entries.filter((e) => e.isFile() && IMAGE.test(e.name) && !e.name.startsWith('.')).map((e) => e.name)
    files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return Promise.all(
      files.map(async (name) => {
        const mtime = await fs.stat(join(dir, name)).then((s) => s.mtimeMs, () => 0)
        return {
          name,
          url: `expandedhub-media://screenshot/${encodeURIComponent(projectId)}/${encodeURIComponent(name)}?v=${Math.round(mtime)}`
        }
      })
    )
  }

  /** Resolve a `expandedhub-media://screenshot/…` request to a file, or null. */
  async path(projectId: string, name: string): Promise<string | null> {
    if (!IMAGE.test(name) || /[\\/]/.test(name) || name.startsWith('.')) return null
    const dir = await this.folder(projectId)
    if (!dir) return null
    const file = join(dir, name)
    return (await fs.stat(file).then((s) => s.isFile(), () => false)) ? file : null
  }
}
