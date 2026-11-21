import { allTools } from '@shared/registry-schema'
import { isActive } from '@shared/operations'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { AppInfo, AppSettings, DeepPartial } from '@shared/types'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { Services } from '../services'
import { log, logFile } from '../services/logger'

/** Only these hosts may be opened from the renderer through `openExternal`. */
const EXTERNAL_HOSTS = new Set([
  'github.com',
  'www.github.com',
  // linked from release notes
  'youtu.be',
  'www.youtube.com',
  'youtube.com'
])

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

export function registerIpc(services: Services): void {
  const { hubUpdater, registry, settings, updates, operations, planner, sources, lifecycle, tools, adopt, gallery } = services

  ipcMain.handle(IpcChannels.registryGet, () => registry.get())
  ipcMain.handle(IpcChannels.registryReload, async () => {
    const snap = await registry.reload()
    void updates.emit()
    return snap
  })

  ipcMain.handle(IpcChannels.projectsStates, () => updates.states())
  ipcMain.handle(IpcChannels.updatesCheck, async (_e, force?: boolean) => {
    const summary = await updates.check(force === true)
    // A manual check also re-reads linked installations (updated by hand since?).
    if (force === true) await adopt.rescan()
    return summary
  })
  ipcMain.handle(IpcChannels.updatesSummary, () => updates.summary())
  ipcMain.handle(IpcChannels.hubUpdateState, () => hubUpdater.get())
  ipcMain.handle(IpcChannels.hubUpdateCheck, () => hubUpdater.check())
  ipcMain.handle(IpcChannels.hubUpdateInstall, () => hubUpdater.install())

  ipcMain.handle(IpcChannels.githubSetToken, (_e, token: string | null) =>
    updates.setToken(typeof token === 'string' ? token : null)
  )

  ipcMain.handle(IpcChannels.settingsGet, () => settings.get())
  ipcMain.handle(IpcChannels.settingsUpdate, async (_e, patch: DeepPartial<AppSettings>) => {
    const before = await settings.get()
    const next = await settings.update(patch)
    if (before.advanced.demoMode !== next.advanced.demoMode) void updates.check(true)
    else void updates.emit()
    return next
  })

  ipcMain.handle(
    IpcChannels.appInfo,
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      userDataPath: app.getPath('userData')
    })
  )

  ipcMain.handle(IpcChannels.openExternal, async (_e, url: string) => {
    // Besides the fixed hosts: exactly the addresses the curated registry links to (tool downloads, homepages).
    const listed = new Set(
      (await registry.get()).projects.flatMap((p) => [p.homepage, p.developer.url, ...allTools(p.install).map((t) => t.url)])
    )
    if (!isAllowedExternalUrl(url) && !(typeof url === 'string' && url.startsWith('https://') && listed.has(url))) {
      throw new Error(`Blocked external URL: ${url}`)
    }
    await shell.openExternal(url)
  })

  ipcMain.handle(IpcChannels.openPath, async (_e, path: string) => {
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  })

  ipcMain.handle(IpcChannels.appLog, (_e, level: unknown, message: unknown, detail: unknown) => {
    const lv = level === 'warn' || level === 'error' ? level : 'info'
    log(lv, `[renderer] ${String(message).slice(0, 2000)}`, typeof detail === 'string' ? detail.slice(0, 8000) : undefined)
  })
  ipcMain.handle(IpcChannels.appOpenLogs, async () => {
    const dir = dirname(logFile())
    await fs.mkdir(dir, { recursive: true })
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })

  ipcMain.handle(IpcChannels.toolsPick, async (e, toolId: unknown) => {
    const id = str(toolId)
    const tool = (await registry.get()).projects.flatMap((p) => allTools(p.install)).find((t) => t.id === id && t.pick)
    if (!tool?.pick) throw new Error(`${id} cannot be chosen by hand`)
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: `Choose ${tool.name}${tool.pick.hint ? ` — ${tool.pick.hint}` : ''}`,
      properties: tool.pick.kind === 'folder' ? ['openDirectory'] : ['openFile'],
      defaultPath: (await tools.paths()).get(id)
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const chosen = await tools.choose(tool, r.filePaths[0])
    void updates.emit()
    return chosen
  })
  ipcMain.handle(IpcChannels.toolsClear, async (_e, toolId: unknown) => {
    await tools.clear(str(toolId))
    void updates.emit()
  })

  ipcMain.handle(IpcChannels.pickFolder, async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  const str = (v: unknown) => {
    if (typeof v !== 'string') throw new Error('Invalid argument')
    return v
  }
  ipcMain.handle(IpcChannels.installPreflight, (_e, id: unknown, buildOnly: unknown, extra: unknown) =>
    planner.preflight(str(id), { buildOnly: buildOnly === true, extra: typeof extra === 'string' ? extra : undefined })
  )
  ipcMain.handle(IpcChannels.installExtras, (_e, id: unknown) => planner.extras(str(id)))
  ipcMain.handle(IpcChannels.installScreenshots, (_e, id: unknown) => gallery.list(str(id)))
  ipcMain.handle(IpcChannels.projectLaunch, (_e, id: unknown) => lifecycle.launch(str(id)))
  ipcMain.handle(IpcChannels.projectStop, (_e, id: unknown) => lifecycle.stop(str(id)))
  ipcMain.handle(IpcChannels.projectRunning, () => lifecycle.running())
  ipcMain.handle(IpcChannels.projectStorage, (_e, id: unknown) => lifecycle.storage(str(id)))
  ipcMain.handle(IpcChannels.projectAdopt, async (e, id: unknown, folder: unknown) => {
    const projectId = str(id)
    if ((await operations.list()).some((o) => o.projectId === projectId && isActive(o))) {
      throw new Error('An installation or build of this project is running. Wait for it or cancel it first.')
    }
    let dir = typeof folder === 'string' ? folder : await adopt.expectedFolder(projectId)
    if (!dir) {
      const name = (await registry.get()).projects.find((p) => p.id === projectId)?.name ?? projectId
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts: Electron.OpenDialogOptions = { title: `Choose the folder ${name} is installed in`, properties: ['openDirectory'] }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    }
    return adopt.adopt(projectId, dir)
  })
  ipcMain.handle(IpcChannels.projectUninstall, async (_e, id: unknown, opts: unknown) => {
    const projectId = str(id)
    if ((await operations.list()).some((o) => o.projectId === projectId && isActive(o))) {
      throw new Error('An installation or build of this project is running. Cancel it on the Downloads page first.')
    }
    const o = (opts && typeof opts === 'object' ? opts : {}) as { files?: unknown; downloads?: unknown; dependencies?: unknown; tools?: unknown }
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string') : [])
    const dependencies = strings(o.dependencies)
    const toolIds = strings(o.tools)
    const ops = await operations.list()
    for (const dep of dependencies) {
      if (ops.some((op) => op.projectId === dep && isActive(op))) {
        throw new Error('An installation or build of a dependency is running. Cancel it on the Downloads page first.')
      }
    }
    if (toolIds.some((t) => ops.some((op) => op.projectId === `tool:${t}` && isActive(op)))) {
      throw new Error('A download of one of these tools is running. Cancel it on the Downloads page first.')
    }
    const r = await lifecycle.uninstall(projectId, { files: o.files !== false, downloads: o.downloads === true, dependencies, tools: toolIds })
    void updates.emit()
    return r
  })

  ipcMain.handle(IpcChannels.sourcesList, () => sources.list())
  ipcMain.handle(IpcChannels.sourcesPick, async (e, gameId: unknown) => {
    const id = str(gameId)
    const game = (await registry.get()).games.find((g) => g.id === id)
    if (!game) throw new Error('Unknown game')
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: `Select your ${game.name} (${game.platform}) file`,
      properties: ['openFile'],
      filters: [{ name: `${game.name} (${game.extensions.map((x) => '.' + x).join(', ')})`, extensions: game.extensions }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return sources.assign(id, r.filePaths[0])
  })
  ipcMain.handle(IpcChannels.sourcesRemove, (_e, gameId: unknown) => sources.remove(str(gameId)))
  ipcMain.handle(IpcChannels.sourcesValidate, async (_e, gameId: unknown) => {
    void sources.validate(str(gameId))
  })

  ipcMain.handle(IpcChannels.opsList, () => operations.list())
  ipcMain.handle(IpcChannels.opsStart, (_e, projectId: unknown, allowScripts: unknown) =>
    operations.start(str(projectId), allowScripts === true)
  )
  ipcMain.handle(IpcChannels.opsBuild, (_e, projectId: unknown, allowScripts: unknown, extra: unknown) =>
    operations.build(str(projectId), allowScripts === true, typeof extra === 'string' ? extra : undefined)
  )
  ipcMain.handle(IpcChannels.opsPause, (_e, id: unknown) => operations.pause(str(id)))
  ipcMain.handle(IpcChannels.opsResume, (_e, id: unknown) => operations.resume(str(id)))
  ipcMain.handle(IpcChannels.opsCancel, (_e, id: unknown) => operations.cancel(str(id)))
  ipcMain.handle(IpcChannels.opsRetry, (_e, id: unknown) => operations.retry(str(id)))
  ipcMain.handle(IpcChannels.opsRemove, (_e, id: unknown) => operations.remove(str(id)))
  ipcMain.handle(IpcChannels.opsClear, () => operations.clearFinished())
  ipcMain.handle(IpcChannels.opsLog, (_e, id: unknown) => operations.readLog(str(id)))
  ipcMain.handle(IpcChannels.opsLogPath, (_e, id: unknown) => operations.logPath(str(id)))

  // Push events to every window.
  const broadcast = (channel: string, payload: unknown) =>
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload))
  updates.onStates((s) => broadcast(IpcChannels.evtStatesChanged, s))
  updates.onSummary((s) => broadcast(IpcChannels.evtUpdateSummary, s))
  hubUpdater.onChange((s) => broadcast(IpcChannels.evtHubUpdate, s))
  operations.onChange((ops) => broadcast(IpcChannels.evtOperations, ops))
  sources.onChange((s) => broadcast(IpcChannels.evtSources, s))
  lifecycle.onRunning((ids) => broadcast(IpcChannels.evtRunning, ids))
}
