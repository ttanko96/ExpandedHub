import { Download, HardDrive, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { ReleaseChoice } from '@shared/install'
import type { ProjectDefinition } from '@shared/registry-schema'
import { formatBytes, shortDate } from '../../lib/format'
import { useHub } from '../../store/hub-store'
import { Button } from '../ui/Button'
import { ProjectTile } from '../ui/ProjectTile'
import { ipcMessage } from './actions'

/**
 * Other versions of a project: the latest release and the earlier ones from
 * the last update check. Choosing one opens the install dialog for it, so a
 * release that broke something can be gone back from.
 */
export function VersionsDialog({ project, onClose }: { project: ProjectDefinition; onClose: () => void }) {
  const openInstall = useHub((s) => s.openInstall)
  const installed = useHub((s) => Boolean(s.states[project.id]?.installed))
  const [list, setList] = useState<ReleaseChoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.hub.install
      .versions(project.id)
      .then(setList)
      .catch((err) => setError(ipcMessage(err)))
  }, [project.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const install = (r: ReleaseChoice) => {
    onClose()
    openInstall(project.id, 'install', undefined, r.latest ? undefined : r.version)
  }

  // In document.body: the page's entry animation leaves a transform that would anchor a fixed overlay to the page.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Other versions of ${project.name}`}
        className="flex max-h-full w-full max-w-[620px] animate-fade-up flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-4 border-b border-line/[0.06] px-6 py-5">
          <ProjectTile project={project} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold uppercase tracking-[0.24em] text-tekken-500">Other versions</div>
            <div className="truncate font-display text-[26px] font-bold uppercase leading-tight tracking-wide text-fg">{project.name}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-fg" aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 py-5">
          <p className="text-[13px] leading-snug text-zinc-400">
            {installed
              ? 'Did a new version break something? Install an earlier one over it: your saves and settings stay.'
              : 'Install normally gets the latest. Need an earlier one? Install it from here.'}{' '}
            Ones already in your downloads folder install without downloading again.
          </p>
          {error ? (
            <div className="rounded-lg border border-tekken-500/40 bg-tekken-500/10 p-3 text-[13px] text-zinc-300">{error}</div>
          ) : !list ? (
            <div className="py-8 text-center text-[13px] text-zinc-500">Loading versions…</div>
          ) : list.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-zinc-500">No releases are known yet. Check for updates on the Mods page first.</div>
          ) : (
            <ul className="flex flex-col divide-y divide-line/[0.06] rounded-xl border border-line/[0.06]">
              {list.map((r) => (
                <li key={r.tag} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[17px] font-bold text-fg">{r.tag}</span>
                      {r.latest && <Badge tone="emerald">Latest</Badge>}
                      {r.installed && <Badge tone="sky">Installed</Badge>}
                      {r.prerelease && <Badge tone="amber">Pre-release</Badge>}
                    </div>
                    {r.tag.startsWith('commit-') && (
                      <div className="truncate text-[12.5px] text-zinc-400" title={r.name}>
                        {r.name.replace(/^(Latest commit|Commit) [0-9a-f]+: /, '')}
                      </div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-zinc-500">
                      <span>{shortDate(r.publishedAt)}</span>
                      {r.problem ? (
                        <span className="text-zinc-500">No package for your system</span>
                      ) : r.downloaded ? (
                        <span className="inline-flex items-center gap-1 text-zinc-400">
                          <HardDrive size={11} /> Downloaded
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Download size={11} /> {r.size > 0 ? formatBytes(r.size) : 'Source archive'}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={r.installed || Boolean(r.problem)} title={r.problem ?? undefined} onClick={() => install(r)}>
                    {r.installed ? 'Installed' : 'Install'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function Badge({ tone, children }: { tone: 'emerald' | 'sky' | 'amber'; children: string }) {
  const cls = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    sky: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  }[tone]
  return <span className={`rounded border px-1.5 py-px text-[10.5px] font-bold uppercase tracking-[0.1em] ${cls}`}>{children}</span>
}
