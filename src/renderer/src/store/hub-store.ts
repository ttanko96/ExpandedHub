import { create } from 'zustand'
import type { SourceConfig } from '@shared/install'
import type { Operation } from '@shared/operations'
import type { GameDefinition, ProjectDefinition } from '@shared/registry-schema'
import type { AppInfo, AppSettings, DeepPartial, HubUpdateState, ProjectState, RegistryIssue, TokenValidation, UpdateCheckSummary } from '@shared/types'

interface HubState {
  ready: boolean
  projects: ProjectDefinition[]
  games: GameDefinition[]
  issues: RegistryIssue[]
  states: Record<string, ProjectState>
  summary: UpdateCheckSummary | null
  /** ExpandedHub's own update state (top bar). */
  hubUpdate: HubUpdateState | null
  settings: AppSettings | null
  appInfo: AppInfo | null
  operations: Operation[]
  sources: Record<string, SourceConfig>
  /** Projects whose game server (browser games) the hub is running. */
  running: string[]
  /** Project whose install dialog is open. */
  installFor: string | null
  /** `build` reruns the build in the existing installation instead of downloading; `extra` makes one of its extras. */
  installMode: 'install' | 'build' | 'extra'
  /** The extra the dialog makes, in `extra` mode. */
  installExtra: string | null
  loadError: string | null

  init(): () => void
  refresh(): Promise<void>
  reloadRegistry(): Promise<void>
  updateSettings(patch: DeepPartial<AppSettings>): Promise<void>
  setToken(token: string | null): Promise<TokenValidation>
  openInstall(projectId: string | null, mode?: 'install' | 'build' | 'extra', extraId?: string): void
}

const byId = (states: ProjectState[]) => Object.fromEntries(states.map((s) => [s.projectId, s]))
const sourcesById = (list: SourceConfig[]) => Object.fromEntries(list.map((s) => [s.gameId, s]))

/** Renderer-side cache of everything the main process knows. Kept fresh by push events. */
export const useHub = create<HubState>((set) => ({
  ready: false,
  projects: [],
  games: [],
  issues: [],
  states: {},
  summary: null,
  hubUpdate: null,
  settings: null,
  appInfo: null,
  operations: [],
  sources: {},
  running: [],
  installFor: null,
  installMode: 'install',
  installExtra: null,
  loadError: null,

  init() {
    const hub = window.hub
    Promise.all([hub.registry.get(), hub.projects.states(), hub.updates.summary(), hub.settings.get(), hub.app.info(), hub.operations.list(), hub.sources.list()])
      .then(([reg, states, summary, settings, appInfo, operations, sources]) =>
        set({ ready: true, ...reg, states: byId(states), summary, settings, appInfo, operations, sources: sourcesById(sources) })
      )
      .catch((err) => set({ ready: true, loadError: String(err) }))

    const offStates = hub.projects.onStatesChanged((s) => set({ states: byId(s) }))
    const offSummary = hub.updates.onSummary((summary) => set({ summary }))
    const offOps = hub.operations.onChange((operations) => set({ operations }))
    hub.hubUpdate.state().then((hubUpdate) => set({ hubUpdate })).catch(() => {})
    const offHubUpdate = hub.hubUpdate.onChange((hubUpdate) => set({ hubUpdate }))
    const offSources = hub.sources.onChange((s) => set({ sources: sourcesById(s) }))
    hub.install.running().then((running) => set({ running })).catch(() => {})
    const offRunning = hub.install.onRunning((running) => set({ running }))
    return () => {
      offStates()
      offSummary()
      offOps()
      offSources()
      offRunning()
      offHubUpdate()
    }
  },

  async refresh() {
    // Registry files may have changed (a new project, a release pin removed): read them first.
    const reg = await window.hub.registry.reload()
    set({ ...reg })
    const summary = await window.hub.updates.check(true)
    set({ summary })
  },

  async reloadRegistry() {
    const reg = await window.hub.registry.reload()
    set({ ...reg })
  },

  openInstall(projectId, mode = 'install', extraId) {
    set({ installFor: projectId, installMode: mode, installExtra: mode === 'extra' ? (extraId ?? null) : null })
  },

  async setToken(token) {
    const result = await window.hub.github.setToken(token)
    set({ summary: await window.hub.updates.summary() })
    return result
  },

  async updateSettings(patch) {
    const settings = await window.hub.settings.update(patch)
    set({ settings })
  }
}))
