import { app } from 'electron'
import { join } from 'node:path'

/** Documents/ExpandedHub: downloads, installs and the build environment by default. */
function defaultRoot(): string {
  return join(app.getPath('documents'), app.getName())
}

/** Central place for every filesystem location the app uses. */
export const paths = {
  /** Curated project registry. Shipped next to the app when packaged. */
  registry: () => (app.isPackaged ? join(process.resourcesPath, 'registry') : join(app.getAppPath(), 'registry')),
  userData: () => app.getPath('userData'),
  settingsFile: () => join(app.getPath('userData'), 'settings.json'),
  installedFile: () => join(app.getPath('userData'), 'installed.json'),
  releaseCacheFile: () => join(app.getPath('userData'), 'cache', 'releases.json'),
  defaultRoot
}
