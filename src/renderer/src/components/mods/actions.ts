import type { ProjectDefinition } from '@shared/registry-schema'
import type { ProjectState } from '@shared/types'
import { repoUrl } from '../../lib/format'
import { useHub } from '../../store/hub-store'
import { toast } from '../../store/toast-store'

async function open(url: string) {
  try {
    await window.hub.app.openExternal(url)
  } catch (err) {
    toast({ tone: 'error', title: 'Could not open link', body: String(err) })
  }
}

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix. */
export function ipcMessage(err: unknown): string {
  return String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export const projectActions = {
  openRepo: (p: ProjectDefinition) => (p.repository ? open(repoUrl(p.repository.owner, p.repository.name)) : Promise.resolve()),
  /** A new issue on the project's GitHub repository: feedback for its developer. */
  giveFeedback: (p: ProjectDefinition) =>
    p.repository ? open(`${repoUrl(p.repository.owner, p.repository.name)}/issues/new`) : Promise.resolve(),
  /** The project's GitHub issues page, where problems with it are reported. */
  openIssues: (p: ProjectDefinition) => (p.repository ? open(`${repoUrl(p.repository.owner, p.repository.name)}/issues`) : Promise.resolve()),
  openRelease: (p: ProjectDefinition, s: ProjectState | undefined) =>
    s?.latest?.htmlUrl
      ? open(s.latest.htmlUrl)
      : p.repository
        ? open(`${repoUrl(p.repository.owner, p.repository.name)}/releases`)
        : Promise.resolve(),
  /** Opens the install dialog: requirements checklist and consent, then starts the operation. */
  primary: (p: ProjectDefinition) => {
    useHub.getState().openInstall(p.id)
  },
  start: async (p: ProjectDefinition, s: ProjectState | undefined, allowScripts: boolean, onStarted?: () => void) => {
    try {
      const op = await window.hub.operations.start(p.id, allowScripts)
      toast({
        tone: 'success',
        title: `${s?.status === 'update-available' ? 'Update' : 'Installation'} started`,
        body: `${p.name} ${op.tag} — follow it on the Downloads page.`
      })
      onStarted?.()
      return true
    } catch (err) {
      toast({ tone: 'error', title: `Could not start ${p.name}`, body: ipcMessage(err) })
      return false
    }
  },
  /** Opens the dialog for rebuilding an existing installation. */
  openBuild: (p: ProjectDefinition) => {
    useHub.getState().openInstall(p.id, 'build')
  },
  /** Opens the dialog for making one of an installed project's extras (DriftEngine's remaster). */
  openExtra: (p: ProjectDefinition, extraId: string) => {
    useHub.getState().openInstall(p.id, 'extra', extraId)
  },
  build: async (p: ProjectDefinition, allowScripts: boolean, onStarted?: () => void, extraId?: string) => {
    try {
      await window.hub.operations.build(p.id, allowScripts, extraId)
      const extra = extraId ? p.install?.extras.find((x) => x.id === extraId) : undefined
      toast({ tone: 'success', title: extra ? `${extra.name} started` : 'Build started', body: `${p.name} — follow it on the Downloads page.` })
      onStarted?.()
      return true
    } catch (err) {
      toast({ tone: 'error', title: `Could not build ${p.name}`, body: ipcMessage(err) })
      return false
    }
  },
  /**
   * Link an installation the user already has: a folder picker (an add-on is
   * looked for inside its host). The hub then works from that folder and the
   * Mods page shows whether a newer release is out.
   */
  adopt: async (p: ProjectDefinition) => {
    try {
      const r = await window.hub.install.adopt(p.id)
      if (!r) return false
      const addons = r.addons.length ? ` Also linked: ${r.addons.join(', ')}.` : ''
      toast({ tone: 'success', title: `${p.name} linked`, body: `${r.detail}.${addons}` })
      return true
    } catch (err) {
      toast({ tone: 'error', title: `Could not link ${p.name}`, body: ipcMessage(err) })
      return false
    }
  },
  launch: async (p: ProjectDefinition) => {
    try {
      await window.hub.install.launch(p.id)
    } catch (err) {
      toast({ tone: 'error', title: `Could not launch ${p.name}`, body: ipcMessage(err) })
    }
  },
  stop: async (p: ProjectDefinition) => {
    try {
      await window.hub.install.stop(p.id)
    } catch (err) {
      toast({ tone: 'error', title: `Could not stop ${p.name}`, body: ipcMessage(err) })
    }
  }
}
