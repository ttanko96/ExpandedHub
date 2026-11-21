import type { InstalledRecord } from '@shared/types'
import { JsonStore } from './json-store'
import { paths } from './paths'
import { MOCK_INSTALLED } from './releases/mock-release-provider'
import type { SettingsService } from './settings-service'

interface InstalledFile {
  records: Record<string, InstalledRecord>
}

/** Tracks which project versions are installed locally. Written by the installation engine (phase 4). */
export class InstalledService {
  private store = new JsonStore<InstalledFile>(paths.installedFile(), () => ({ records: {} }))

  constructor(private readonly settings: SettingsService) {}

  async all(): Promise<Record<string, InstalledRecord>> {
    if ((await this.settings.get()).advanced.demoMode) {
      return Object.fromEntries(MOCK_INSTALLED.map((r) => [r.projectId, r]))
    }
    return (await this.store.read()).records
  }

  async set(record: InstalledRecord): Promise<void> {
    await this.store.update((f) => ({ records: { ...f.records, [record.projectId]: record } }))
  }

  async remove(projectId: string): Promise<void> {
    await this.store.update((f) => {
      const { [projectId]: _removed, ...rest } = f.records
      return { records: rest }
    })
  }
}
