import { app } from 'electron'
import { join } from 'node:path'
import { OperationsService } from './downloads/operations-service'
import { LifecycleService } from './install/lifecycle'
import { AdoptService } from './install/adopt-service'
import { GalleryService } from './install/gallery-service'
import { InstallPlanner } from './install/planner'
import { SourcesService } from './install/sources-service'
import { ToolsService } from './install/tools-service'
import { HubUpdater } from './hub-updater'
import { InstalledService } from './installed-service'
import { RegistryService } from './registry-service'
import { ReportService } from './report-service'
import { ChangelogService } from './changelog-service'
import { HUB_REPOSITORY } from '@shared/types'
import { paths } from './paths'
import { SettingsService } from './settings-service'
import { TokenStore } from './token-store'
import { UpdateService } from './update-service'

/** Composition root for main-process services. New modules plug in here. */
export function createServices() {
  const settings = new SettingsService()
  const registry = new RegistryService()
  const tokens = new TokenStore()
  const installed = new InstalledService(settings)
  const sources = new SourcesService(registry)
  const updates = new UpdateService(registry, installed, settings, tokens, sources)
  // Changed game files can mean a build is out of date.
  sources.onChange(() => void updates.emit())
  const tools = new ToolsService()
  const planner = new InstallPlanner(registry, settings, installed, updates, sources, tools)
  const operations = new OperationsService(registry, settings, updates, planner, installed, tools)
  const lifecycle = new LifecycleService(registry, settings, installed, tools)
  const adopt = new AdoptService(registry, installed, updates)
  const gallery = new GalleryService(registry, installed)
  const hubUpdater = new HubUpdater(tokens)
  const changelog = new ChangelogService({
    userData: paths.userData(),
    project: async (id) => (await registry.get()).projects.find((p) => p.id === id) ?? null,
    releases: (id) => updates.releases(id),
    hubVersion: app.getVersion(),
    hubReleases: () => hubUpdater.releases(),
    hubReleasesUrl: `https://github.com/${HUB_REPOSITORY.owner}/${HUB_REPOSITORY.name}/releases`,
    // Not a fresh install: the first-start window was shown, or something is installed.
    usedBefore: async () => (await settings.get()).onboarding.gameFilesPrompted || Object.keys(await installed.all()).length > 0
  })
  // A finished install or update tells What's new what it replaced.
  operations.onInstalled((e) => void changelog.projectUpdated(e.projectId, e.previous, e.version, e.tag))
  const reports = new ReportService({
    registry,
    states: () => updates.states(),
    sources: () => sources.list(),
    operations: () => operations.list(),
    hubVersion: app.getVersion(),
    logsDir: join(paths.userData(), 'logs')
  })
  return { hubUpdater, reports, changelog, settings, registry, tokens, installed, updates, sources, tools, planner, operations, lifecycle, adopt, gallery }
}

export type Services = ReturnType<typeof createServices>
