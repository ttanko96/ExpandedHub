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
import { SettingsService } from './settings-service'
import { TokenStore } from './token-store'
import { UpdateService } from './update-service'

/** Composition root for main-process services. New modules plug in here. */
export function createServices() {
  const settings = new SettingsService()
  const registry = new RegistryService()
  const tokens = new TokenStore()
  const installed = new InstalledService(settings)
  const updates = new UpdateService(registry, installed, settings, tokens)
  const sources = new SourcesService(registry)
  const tools = new ToolsService()
  const planner = new InstallPlanner(registry, settings, installed, updates, sources, tools)
  const operations = new OperationsService(registry, settings, updates, planner, installed, tools)
  const lifecycle = new LifecycleService(registry, settings, installed, tools)
  const adopt = new AdoptService(registry, installed, updates)
  const gallery = new GalleryService(registry, installed)
  const hubUpdater = new HubUpdater(tokens)
  return { hubUpdater, settings, registry, tokens, installed, updates, sources, tools, planner, operations, lifecycle, adopt, gallery }
}

export type Services = ReturnType<typeof createServices>
