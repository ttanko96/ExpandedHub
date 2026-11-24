import { app, net, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isNewer, normalizeVersion } from '@shared/status'
import { HUB_REPOSITORY, type HubUpdateState, type ReleaseInfo } from '@shared/types'
import { pickReleases } from './releases/github-release-provider'
import { downloadToFile } from './downloads/http-download'
import { log } from './logger'
import type { TokenStore } from './token-store'

/** How often the hub looks for a new version of itself while running. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000

interface GhRelease {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  created_at: string
  assets: { name: string; size: number; browser_download_url: string }[]
}

/** The NSIS installer electron-builder makes (`ExpandedHub-Setup-<version>.exe`). */
export function pickInstaller(assets: GhRelease['assets']): GhRelease['assets'][number] | null {
  return assets.find((a) => /^ExpandedHub-Setup-.*\.exe$/i.test(a.name)) ?? null
}

/**
 * Keeps ExpandedHub itself up to date from its GitHub releases. Installed copies
 * (NSIS) download the new installer and run it silently, which replaces the app
 * and starts it again; other copies (dev build, unpacked zip) open the release page.
 */
export class HubUpdater {
  private state: HubUpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    latest: null,
    canInstall: false,
    progress: null,
    error: null,
    checkedAt: null
  }
  private installer: { url: string; name: string } | null = null
  private timer: NodeJS.Timeout | null = null
  private running: Promise<HubUpdateState> | null = null
  private listeners = new Set<(s: HubUpdateState) => void>()

  constructor(private readonly tokens: TokenStore) {}

  get(): HubUpdateState {
    return this.state
  }

  start(): void {
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  onChange(l: (s: HubUpdateState) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private set(patch: Partial<HubUpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l(this.state))
  }

  /** Installed by the NSIS setup (it leaves its uninstaller next to the executable). */
  private isInstalledCopy(): boolean {
    if (!app.isPackaged || process.platform !== 'win32') return false
    const dir = dirname(process.execPath)
    return existsSync(join(dir, `Uninstall ${app.getName()}.exe`))
  }

  check(): Promise<HubUpdateState> {
    // Never interrupt a running download or install with a check.
    if (this.state.status === 'downloading' || this.state.status === 'installing') return Promise.resolve(this.state)
    if (!this.running) {
      this.running = this.runCheck().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async runCheck(): Promise<HubUpdateState> {
    this.set({ status: 'checking', error: null })
    try {
      const { owner, name } = HUB_REPOSITORY
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `ExpandedHub/${app.getVersion()}`
      }
      const token = await this.tokens.get()
      if (token) headers.Authorization = `Bearer ${token}`

      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      let res: Response
      try {
        res = await net.fetch(`https://api.github.com/repos/${owner}/${name}/releases/latest`, { headers, signal: ctrl.signal })
      } finally {
        clearTimeout(t)
      }

      const checkedAt = new Date().toISOString()
      // 404: the repository has no published release yet, so this is the newest version.
      if (res.status === 404) {
        this.installer = null
        this.set({ status: 'up-to-date', latest: null, canInstall: false, checkedAt })
        return this.state
      }
      if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`)

      const rel = (await res.json()) as GhRelease
      const latest = {
        version: normalizeVersion(rel.tag_name),
        tag: rel.tag_name,
        htmlUrl: rel.html_url,
        publishedAt: rel.published_at ?? rel.created_at
      }
      if (rel.draft || rel.prerelease || !isNewer(latest.version, app.getVersion())) {
        this.installer = null
        this.set({ status: 'up-to-date', latest, canInstall: false, checkedAt })
        return this.state
      }

      const asset = pickInstaller(rel.assets)
      this.installer = asset ? { url: asset.browser_download_url, name: asset.name } : null
      const canInstall = asset !== null && this.isInstalledCopy()
      log('info', `ExpandedHub ${latest.version} is available (running ${app.getVersion()}${canInstall ? '' : ', manual update'})`)
      this.set({ status: 'available', latest, canInstall, checkedAt })
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? 'request timed out' : err instanceof Error ? err.message : String(err)
      log('warn', `Hub update check failed: ${message}`)
      this.set({ status: 'error', error: `Could not check for ExpandedHub updates: ${message}` })
    }
    return this.state
  }

  /** ExpandedHub's published releases with their notes, newest first (for What's new after an update). Throws when offline. */
  async releases(): Promise<ReleaseInfo[]> {
    const { owner, name } = HUB_REPOSITORY
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `ExpandedHub/${app.getVersion()}`
    }
    const token = await this.tokens.get()
    if (token) headers.Authorization = `Bearer ${token}`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await net.fetch(`https://api.github.com/repos/${owner}/${name}/releases?per_page=20`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`)
      return pickReleases((await res.json()) as never, { provider: 'github', owner, name, includePrereleases: false })
    } finally {
      clearTimeout(t)
    }
  }

  /** Download and run the new installer, then quit so it can replace the app. */
  async install(): Promise<void> {
    if (this.state.status !== 'available' || !this.state.latest) return
    if (!this.state.canInstall || !this.installer) {
      await shell.openExternal(this.state.latest.htmlUrl)
      return
    }

    const dir = join(app.getPath('temp'), 'ExpandedHub-update')
    const file = join(dir, basename(this.installer.name))
    const part = `${file}.part`
    this.set({ status: 'downloading', progress: 0, error: null })
    try {
      await fs.mkdir(dir, { recursive: true })
      await downloadToFile({
        url: this.installer.url,
        partPath: part,
        signal: new AbortController().signal,
        userAgent: `ExpandedHub/${app.getVersion()}`,
        log: (line) => log('info', `Hub update: ${line}`),
        onProgress: ({ received, total }) => {
          const progress = total > 0 ? received / total : null
          // Throttle: only push whole-percent changes to the renderer.
          if (progress === null || this.state.progress === null || Math.floor(progress * 100) !== Math.floor(this.state.progress * 100)) {
            this.set({ progress })
          }
        }
      })
      await fs.rm(file, { force: true })
      await fs.rename(part, file)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log('error', 'Hub update download failed', err)
      this.set({ status: 'available', progress: null, error: `Update download failed: ${message}` })
      return
    }

    this.set({ status: 'installing', progress: 1 })
    log('info', `Running ${file} to update ExpandedHub to ${this.state.latest.version}`)
    // electron-builder's NSIS: /S installs silently into the existing folder,
    // --updated keeps settings, --force-run starts the new version afterwards.
    const child = spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' })
    child.on('error', (err) => {
      log('error', 'Could not start the hub installer', err)
      this.set({ status: 'available', progress: null, error: `Could not start the installer: ${err.message}` })
    })
    child.unref()
    setTimeout(() => {
      if (this.state.status === 'installing') app.quit()
    }, 1500)
  }
}
