import { ArrowRight, ExternalLink, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectDefinition } from '@shared/registry-schema'
import { formatVersion } from '@shared/status'
import type { ChangelogEntry } from '@shared/types'
import { shortDate } from '../../lib/format'
import { useHub } from '../../store/hub-store'
import { Button } from '../ui/Button'
import { ProjectTile } from '../ui/ProjectTile'
import { SimpleMarkdown } from '../ui/SimpleMarkdown'

/** The hub's own tile, drawn like a project's. */
const HUB_TILE = { name: 'ExpandedHub', artwork: { accent: '#d81e34', monogram: 'EH' } } as unknown as ProjectDefinition

/**
 * What's new: after a project updated (or ExpandedHub itself, after it
 * restarted on a newer version), the release notes of everything that changed.
 * One entry at a time, oldest first; closing it marks it seen.
 */
export function WhatsNewDialog() {
  const projects = useHub((s) => s.projects)
  const [pending, setPending] = useState<ChangelogEntry[]>([])

  useEffect(() => {
    void window.hub.changelog.pending().then(setPending).catch(() => {})
    return window.hub.changelog.onChange(setPending)
  }, [])

  const entry = pending[0]
  useEffect(() => {
    if (!entry) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && void window.hub.changelog.dismiss(entry.id)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entry])
  if (!entry) return null

  const project = projects.find((p) => p.id === entry.projectId)
  const close = () => void window.hub.changelog.dismiss(entry.id)
  const open = (url: string) => void window.hub.app.openExternal(url).catch(() => {})
  const more = pending.length - 1

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm" onClick={close}>
      <div
        role="dialog"
        aria-label={`What's new in ${entry.name}`}
        className="flex max-h-full w-full max-w-[760px] animate-fade-up flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-4 border-b border-line/[0.06] px-6 py-5">
          <ProjectTile project={project ?? HUB_TILE} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-display text-[13px] font-bold uppercase tracking-[0.24em] text-tekken-500">
              <Sparkles size={13} /> What's new
            </div>
            <div className="truncate font-display text-[26px] font-bold uppercase leading-tight tracking-wide text-fg">{entry.name}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[13px] text-zinc-400">
              {entry.from ? (
                <>
                  <span>{entry.from}</span>
                  <ArrowRight size={13} className="text-emerald-400" />
                </>
              ) : (
                <span>Updated to</span>
              )}
              <span className="font-semibold text-emerald-300">{entry.to}</span>
            </div>
          </div>
          <button onClick={close} className="text-zinc-500 hover:text-fg" aria-label="Close">
            <X size={20} />
          </button>
        </header>

        {/* Keyed by the entry, so the next one starts at its top. */}
        <div key={entry.id} className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 py-5">
          {entry.releases.length === 0 && (
            <p className="text-[13.5px] text-zinc-400">The release notes could not be read now. They are on GitHub.</p>
          )}
          {entry.releases.map((r) => (
            <section key={r.tag} className="border-b border-line/[0.06] pb-5 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-[18px] font-bold text-fg">
                  {r.tag.startsWith('commit-') ? formatVersion(r.version, r.tag) : r.name && r.name !== r.tag ? `${r.tag} · ${r.name}` : r.tag}
                </h3>
                <span className="text-[12px] text-zinc-500">{shortDate(r.publishedAt)}</span>
              </div>
              <div className="mt-2 text-[13.5px] leading-relaxed text-zinc-300">
                {r.notes.trim() ? <SimpleMarkdown source={r.notes} /> : <p className="text-zinc-500">No release notes.</p>}
              </div>
              <button onClick={() => open(r.htmlUrl)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-zinc-500 hover:text-zinc-200">
                <ExternalLink size={12} /> View on GitHub
              </button>
            </section>
          ))}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line/[0.06] px-6 py-4">
          <div className="text-[12.5px] text-zinc-500">
            {entry.moreUrl && (
              <button onClick={() => open(entry.moreUrl!)} className="inline-flex items-center gap-1 hover:text-zinc-200">
                <ExternalLink size={12} /> {entry.releases.length ? 'Earlier changes on GitHub' : 'Release notes on GitHub'}
              </button>
            )}
          </div>
          <Button variant="primary" onClick={close} className="min-w-[120px]">
            {more > 0 ? `Next (${more} more)` : 'Got it'}
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
