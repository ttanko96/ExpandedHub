import { Bug, Copy, ExternalLink, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { ProjectDefinition } from '@shared/registry-schema'
import type { IssueReport } from '@shared/types'
import { toast } from '../../store/toast-store'
import { Button } from '../ui/Button'
import { ProjectTile } from '../ui/ProjectTile'
import { ipcMessage, projectActions } from './actions'

/** Longest new-issue link GitHub takes; a longer report goes through the clipboard. */
const MAX_URL = 7800

/**
 * Report a problem with a project: the hub drafts the issue (versions, game
 * files, the last operation and its log), the user reads and edits it, then
 * it opens on GitHub, where they send it. Nothing is sent from the hub.
 */
export function ReportDialog({ project, onClose }: { project: ProjectDefinition; onClose: () => void }) {
  const [report, setReport] = useState<IssueReport | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.hub.install
      .report(project.id)
      .then((r) => {
        setReport(r)
        setTitle(r.title)
        setBody(r.body)
      })
      .catch((err) => setError(ipcMessage(err)))
  }, [project.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async (quiet = false) => {
    try {
      await navigator.clipboard.writeText(body)
      if (!quiet) toast({ tone: 'success', title: 'Report copied', body: 'Paste it into the issue on GitHub.' })
      return true
    } catch {
      toast({ tone: 'error', title: 'Could not copy the report' })
      return false
    }
  }

  const send = async () => {
    if (!report) return
    const link = (b: string) => `${report.url}?${new URLSearchParams({ title, body: b }).toString()}`
    let url = link(body)
    if (url.length > MAX_URL) {
      // Too long for a link: the report goes on the clipboard, the issue opens with a note to paste it.
      if (!(await copy(true))) return
      url = link('<!-- The report is on your clipboard: paste it here (Ctrl+V). -->')
      toast({ tone: 'info', title: 'Report copied', body: 'It is too long for a link: paste it into the issue on GitHub (Ctrl+V).' })
    }
    try {
      await window.hub.app.openExternal(url)
      onClose()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not open GitHub', body: ipcMessage(err) })
    }
  }

  // In document.body: the page's entry animation leaves a transform that would anchor a fixed overlay to the page.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Report a problem with ${project.name}`}
        className="flex max-h-full w-full max-w-[760px] animate-fade-up flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-4 border-b border-line/[0.06] px-6 py-5">
          <ProjectTile project={project} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold uppercase tracking-[0.24em] text-tekken-500">Report a problem</div>
            <div className="truncate font-display text-[26px] font-bold uppercase leading-tight tracking-wide text-fg">{project.name}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-fg" aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 py-5">
          <p className="text-[13px] leading-snug text-zinc-400">
            The hub filled in your setup, game files and the end of the last log, so the developer can see what happened. Describe the
            problem at the top. It opens as a <span className="text-zinc-200">public</span> issue on GitHub, where you send it: read it
            first. Your user name and home folder are already left out.
          </p>
          {error ? (
            <div className="rounded-lg border border-tekken-500/40 bg-tekken-500/10 p-3 text-[13px] text-zinc-300">{error}</div>
          ) : !report ? (
            <div className="py-10 text-center text-[13px] text-zinc-500">Collecting your setup…</div>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="In a few words: what went wrong?"
                  className="selectable rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[14px] font-normal normal-case tracking-normal text-fg outline-none focus:border-tekken-500"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Report
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={16}
                  spellCheck={false}
                  className="selectable min-h-[220px] resize-y rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-[12px] font-normal normal-case leading-relaxed tracking-normal text-zinc-300 outline-none focus:border-tekken-500"
                />
              </label>
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line/[0.06] px-6 py-4">
          <Button size="sm" variant="ghost" icon={<Bug size={14} />} onClick={() => void projectActions.openIssues(project)}>
            Known issues
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<Copy size={14} />} disabled={!report} onClick={() => void copy()}>
              Copy
            </Button>
            <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} disabled={!report || !title.trim()} onClick={() => void send()}
              title={title.trim() ? undefined : 'Give it a title first'}>
              Open on GitHub
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  )
}
