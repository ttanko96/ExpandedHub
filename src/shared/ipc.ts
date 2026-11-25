/**
 * The typed bridge between renderer and main. The preload script implements
 * `HubApi` with `ipcRenderer.invoke` on the channels below; the main process
 * registers a handler per channel. Keep both sides in sync through this file.
 */
import type {
  AppInfo,
  AppSettings,
  DeepPartial,
  DojoPortraits,
  AdoptResult,
  ChangelogEntry,
  IssueReport,
  HubUpdateState,
  ProjectState,
  RegistrySnapshot,
  TokenValidation,
  UpdateCheckSummary
} from './types'
import type { ExtraStatus, Preflight, ReleaseChoice, Screenshot, ProjectStorage, SourceConfig, UninstallOptions, UninstallResult } from './install'
import type { Operation } from './operations'

export const IpcChannels = {
  registryGet: 'registry:get',
  registryReload: 'registry:reload',
  projectsStates: 'projects:states',
  updatesCheck: 'updates:check',
  updatesSummary: 'updates:summary',
  hubUpdateState: 'hub-update:state',
  hubUpdateCheck: 'hub-update:check',
  hubUpdateInstall: 'hub-update:install',
  githubSetToken: 'github:set-token',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  appInfo: 'app:info',
  openExternal: 'shell:open-external',
  openPath: 'shell:open-path',
  pickFolder: 'dialog:pick-folder',
  toolsPick: 'tools:pick',
  toolsClear: 'tools:clear',
  appLog: 'app:log',
  appOpenLogs: 'app:open-logs',
  installPreflight: 'install:preflight',
  installVersions: 'install:versions',
  installExtras: 'install:extras',
  installScreenshots: 'install:screenshots',
  dojoPortraits: 'dojo:portraits',
  projectLaunch: 'project:launch',
  projectStop: 'project:stop',
  projectRunning: 'project:running',
  projectUninstall: 'project:uninstall',
  projectStorage: 'project:storage',
  projectAdopt: 'project:adopt',
  projectReport: 'project:report',
  changelogPending: 'changelog:pending',
  changelogDismiss: 'changelog:dismiss',
  opsBuild: 'ops:build',
  sourcesList: 'sources:list',
  sourcesPick: 'sources:pick',
  sourcesRemove: 'sources:remove',
  sourcesValidate: 'sources:validate',
  opsList: 'ops:list',
  opsStart: 'ops:start',
  opsPause: 'ops:pause',
  opsResume: 'ops:resume',
  opsCancel: 'ops:cancel',
  opsRetry: 'ops:retry',
  opsRemove: 'ops:remove',
  opsClear: 'ops:clear-finished',
  opsLog: 'ops:log',
  opsLogPath: 'ops:log-path',
  // main → renderer events
  evtStatesChanged: 'evt:states-changed',
  evtUpdateSummary: 'evt:update-summary',
  evtHubUpdate: 'evt:hub-update',
  evtOperations: 'evt:operations',
  evtRunning: 'evt:running',
  evtSources: 'evt:sources',
  evtChangelog: 'evt:changelog'
} as const

export interface HubApi {
  registry: {
    get(): Promise<RegistrySnapshot>
    reload(): Promise<RegistrySnapshot>
  }
  projects: {
    states(): Promise<ProjectState[]>
    onStatesChanged(cb: (states: ProjectState[]) => void): () => void
  }
  updates: {
    /** Force a refresh. `force` ignores the cache TTL. */
    check(force?: boolean): Promise<UpdateCheckSummary>
    summary(): Promise<UpdateCheckSummary>
    onSummary(cb: (summary: UpdateCheckSummary) => void): () => void
  }
  /** ExpandedHub's own updates. */
  hubUpdate: {
    state(): Promise<HubUpdateState>
    check(): Promise<HubUpdateState>
    /** Download and run the new installer (the app restarts), or open the release page when it cannot install itself. */
    install(): Promise<void>
    onChange(cb: (state: HubUpdateState) => void): () => void
  }
  github: {
    /** Validate and store a token (encrypted), or remove it with null. */
    setToken(token: string | null): Promise<TokenValidation>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: DeepPartial<AppSettings>): Promise<AppSettings>
  }
  install: {
    /** Install checks; with `version`, for installing that earlier release instead of the latest. */
    preflight(projectId: string, version?: string): Promise<Preflight>
    /** The project's releases for Other versions (newest first, what is installed and downloaded). */
    versions(projectId: string): Promise<ReleaseChoice[]>
    launch(projectId: string): Promise<void>
    /** Stop the game server Play started (browser games). */
    stop(projectId: string): Promise<void>
    /** Projects whose game server the hub is running. */
    running(): Promise<string[]>
    onRunning(cb: (ids: string[]) => void): () => void
    uninstall(projectId: string, opts?: UninstallOptions): Promise<UninstallResult>
    /**
     * Link an installation the user already has. Without `folder` a folder picker
     * opens (add-ons are looked for inside their host instead). Null when cancelled;
     * throws when the folder is not that project.
     */
    adopt(projectId: string, folder?: string): Promise<AdoptResult | null>
    /** A drafted GitHub issue for the project (setup, game files, last operation and its log), for the user to check and send. */
    report(projectId: string): Promise<IssueReport>
    /** Where the project's files and downloads are, and their size. */
    storage(projectId: string): Promise<ProjectStorage>
    /** Install checks for rebuilding an existing installation. */
    buildPreflight(projectId: string): Promise<Preflight>
    /** Checks before making one of an installed project's extras (e.g. DriftEngine's remaster). */
    extraPreflight(projectId: string, extraId: string): Promise<Preflight>
    /** Which of an installed project's extras have been made. */
    extras(projectId: string): Promise<ExtraStatus[]>
    /** The screenshots an installed project ships (`install.screenshots`); empty when none. */
    screenshots(projectId: string): Promise<Screenshot[]>
  }
  dojo: {
    /** Fighter portraits from the player's own Tekken 3 Expanded (converted on first use); none when switched off. */
    portraits(): Promise<DojoPortraits>
  }
  changelog: {
    /** What's new entries not seen yet: updated projects, and the hub itself after it updated. Oldest first. */
    pending(): Promise<ChangelogEntry[]>
    /** The user closed this entry's What's new window. */
    dismiss(id: string): Promise<void>
    onChange(cb: (pending: ChangelogEntry[]) => void): () => void
  }
  tools: {
    /** Browse to a tool (a folder or a file, as the registry asks). Null when cancelled; throws when the choice is not that tool. */
    pick(toolId: string): Promise<string | null>
    clear(toolId: string): Promise<void>
  }
  sources: {
    list(): Promise<SourceConfig[]>
    /** Open a file picker for this game and assign the chosen file. Null when cancelled. */
    pick(gameId: string): Promise<SourceConfig | null>
    remove(gameId: string): Promise<void>
    validate(gameId: string): Promise<void>
    onChange(cb: (sources: SourceConfig[]) => void): () => void
  }
  operations: {
    list(): Promise<Operation[]>
    /**
     * Install or update a project from its latest release. `allowScripts` is the
     * user's consent to run the project's own scripts (asked in the install dialog).
     */
    start(projectId: string, allowScripts?: boolean, version?: string): Promise<Operation>
    /** Run the project's build again in its existing installation (no download), or make one of its extras. */
    build(projectId: string, allowScripts?: boolean, extraId?: string): Promise<Operation>
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    cancel(id: string): Promise<void>
    retry(id: string): Promise<void>
    remove(id: string): Promise<void>
    clearFinished(): Promise<void>
    log(id: string): Promise<string>
    logPath(id: string): Promise<string>
    onChange(cb: (ops: Operation[]) => void): () => void
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    /** Write a line to the app log (renderer errors). */
    log(level: 'info' | 'warn' | 'error', message: string, detail?: string): Promise<void>
    /** Open the folder with the app log and operation logs. */
    openLogs(): Promise<void>
    /** Native folder picker. Resolves with null when cancelled. */
    pickFolder(defaultPath?: string): Promise<string | null>
  }
}
