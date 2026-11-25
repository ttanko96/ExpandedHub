import { app } from 'electron'
import { join } from 'node:path'
import type { AppSettings, DeepPartial } from '@shared/types'
import { JsonStore } from './json-store'
import { paths } from './paths'

function defaults(): AppSettings {
  const root = paths.defaultRoot()
  return {
    general: {
      theme: 'dark',
      launchOnStartup: false,
      autoCheckUpdates: true,
      checkIntervalMinutes: 60
    },
    directories: {
      downloads: join(root, 'downloads'),
      installs: join(root, 'installs'),
      temp: join(root, 'temp'),
      buildEnv: join(root, 'build-env')
    },
    advanced: { debug: false, demoMode: false },
    onboarding: { gameFilesPrompted: false },
    dojo: { portraits: true }
  }
}

/** Demo mode (sample data instead of GitHub) is a development aid: never on in a packaged build. */
export const demoModeAvailable = (): boolean => !app?.isPackaged

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base)) continue // ignore unknown keys
    out[k] = deepMerge((base as Record<string, unknown>)[k], v)
  }
  return out as T
}

type Listener = (s: AppSettings) => void

export class SettingsService {
  private store = new JsonStore<AppSettings>(paths.settingsFile(), defaults)
  private listeners = new Set<Listener>()

  /** Always returns a complete settings object, filling keys added in newer versions. */
  async get(): Promise<AppSettings> {
    const s = deepMerge(defaults(), await this.store.read())
    if (!demoModeAvailable()) s.advanced.demoMode = false
    return s
  }

  async update(patch: DeepPartial<AppSettings>): Promise<AppSettings> {
    const next = deepMerge(await this.get(), patch)
    if (!demoModeAvailable()) next.advanced.demoMode = false
    next.general.checkIntervalMinutes = Math.min(24 * 60, Math.max(15, Math.round(next.general.checkIntervalMinutes)))
    await this.store.write(next)
    this.listeners.forEach((l) => l(next))
    return next
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}
