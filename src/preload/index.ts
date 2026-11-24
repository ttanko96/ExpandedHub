import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels, type HubApi } from '@shared/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: HubApi = {
  registry: {
    get: () => ipcRenderer.invoke(IpcChannels.registryGet),
    reload: () => ipcRenderer.invoke(IpcChannels.registryReload)
  },
  projects: {
    states: () => ipcRenderer.invoke(IpcChannels.projectsStates),
    onStatesChanged: (cb) => subscribe(IpcChannels.evtStatesChanged, cb)
  },
  updates: {
    check: (force) => ipcRenderer.invoke(IpcChannels.updatesCheck, force),
    summary: () => ipcRenderer.invoke(IpcChannels.updatesSummary),
    onSummary: (cb) => subscribe(IpcChannels.evtUpdateSummary, cb)
  },
  hubUpdate: {
    state: () => ipcRenderer.invoke(IpcChannels.hubUpdateState),
    check: () => ipcRenderer.invoke(IpcChannels.hubUpdateCheck),
    install: () => ipcRenderer.invoke(IpcChannels.hubUpdateInstall),
    onChange: (cb) => subscribe(IpcChannels.evtHubUpdate, cb)
  },
  github: {
    setToken: (token) => ipcRenderer.invoke(IpcChannels.githubSetToken, token)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (patch) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch)
  },
  install: {
    preflight: (projectId, version) => ipcRenderer.invoke(IpcChannels.installPreflight, projectId, false, undefined, version),
    versions: (projectId) => ipcRenderer.invoke(IpcChannels.installVersions, projectId),
    launch: (projectId) => ipcRenderer.invoke(IpcChannels.projectLaunch, projectId),
    stop: (projectId) => ipcRenderer.invoke(IpcChannels.projectStop, projectId),
    running: () => ipcRenderer.invoke(IpcChannels.projectRunning),
    onRunning: (cb) => subscribe(IpcChannels.evtRunning, cb),
    uninstall: (projectId, opts) => ipcRenderer.invoke(IpcChannels.projectUninstall, projectId, opts),
    storage: (projectId) => ipcRenderer.invoke(IpcChannels.projectStorage, projectId),
    adopt: (projectId, folder) => ipcRenderer.invoke(IpcChannels.projectAdopt, projectId, folder),
    report: (projectId) => ipcRenderer.invoke(IpcChannels.projectReport, projectId),
    buildPreflight: (projectId) => ipcRenderer.invoke(IpcChannels.installPreflight, projectId, true),
    extraPreflight: (projectId, extraId) => ipcRenderer.invoke(IpcChannels.installPreflight, projectId, true, extraId),
    extras: (projectId) => ipcRenderer.invoke(IpcChannels.installExtras, projectId),
    screenshots: (projectId) => ipcRenderer.invoke(IpcChannels.installScreenshots, projectId)
  },
  changelog: {
    pending: () => ipcRenderer.invoke(IpcChannels.changelogPending),
    dismiss: (id) => ipcRenderer.invoke(IpcChannels.changelogDismiss, id),
    onChange: (cb) => subscribe(IpcChannels.evtChangelog, cb)
  },
  tools: {
    pick: (toolId) => ipcRenderer.invoke(IpcChannels.toolsPick, toolId),
    clear: (toolId) => ipcRenderer.invoke(IpcChannels.toolsClear, toolId)
  },
  sources: {
    list: () => ipcRenderer.invoke(IpcChannels.sourcesList),
    pick: (gameId) => ipcRenderer.invoke(IpcChannels.sourcesPick, gameId),
    remove: (gameId) => ipcRenderer.invoke(IpcChannels.sourcesRemove, gameId),
    validate: (gameId) => ipcRenderer.invoke(IpcChannels.sourcesValidate, gameId),
    onChange: (cb) => subscribe(IpcChannels.evtSources, cb)
  },
  operations: {
    list: () => ipcRenderer.invoke(IpcChannels.opsList),
    start: (projectId, allowScripts, version) => ipcRenderer.invoke(IpcChannels.opsStart, projectId, allowScripts === true, version),
    build: (projectId, allowScripts, extraId) => ipcRenderer.invoke(IpcChannels.opsBuild, projectId, allowScripts === true, extraId),
    pause: (id) => ipcRenderer.invoke(IpcChannels.opsPause, id),
    resume: (id) => ipcRenderer.invoke(IpcChannels.opsResume, id),
    cancel: (id) => ipcRenderer.invoke(IpcChannels.opsCancel, id),
    retry: (id) => ipcRenderer.invoke(IpcChannels.opsRetry, id),
    remove: (id) => ipcRenderer.invoke(IpcChannels.opsRemove, id),
    clearFinished: () => ipcRenderer.invoke(IpcChannels.opsClear),
    log: (id) => ipcRenderer.invoke(IpcChannels.opsLog, id),
    logPath: (id) => ipcRenderer.invoke(IpcChannels.opsLogPath, id),
    onChange: (cb) => subscribe(IpcChannels.evtOperations, cb)
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannels.appInfo),
    openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
    openPath: (path) => ipcRenderer.invoke(IpcChannels.openPath, path),
    pickFolder: (defaultPath) => ipcRenderer.invoke(IpcChannels.pickFolder, defaultPath),
    log: (level, message, detail) => ipcRenderer.invoke(IpcChannels.appLog, level, message, detail),
    openLogs: () => ipcRenderer.invoke(IpcChannels.appOpenLogs)
  }
}

contextBridge.exposeInMainWorld('hub', api)
