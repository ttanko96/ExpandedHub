import { ExternalLink, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Operation } from '@shared/operations'
import { Button } from '../ui/Button'

/** Shows an operation's log; refreshes while the operation runs. */
export function LogDialog({ op, onClose }: { op: Operation; onClose: () => void }) {
  const [text, setText] = useState('')
  const pre = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let alive = true
    const load = () => window.hub.operations.log(op.id).then((t) => alive && setText(t))
    void load()
    const t = op.status === 'running' ? setInterval(load, 1000) : null
    return () => {
      alive = false
      if (t) clearInterval(t)
    }
  }, [op.id, op.status])

  useEffect(() => {
    pre.current?.scrollTo({ top: pre.current.scrollHeight })
  }, [text])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-8 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Operation log"
        className="flex max-h-full w-full max-w-4xl animate-fade-up flex-col rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line/[0.06] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] font-bold uppercase tracking-wide text-fg">
              {op.projectName} {op.tag} — log
            </div>
            <div className="truncate text-[12.5px] text-zinc-500">{op.file.name}</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink size={14} />}
            onClick={() => void window.hub.operations.logPath(op.id).then((p) => window.hub.app.openPath(p))}
          >
            Open file
          </Button>
          <button onClick={onClose} className="text-zinc-500 hover:text-fg" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <pre
          ref={pre}
          className="selectable min-h-[240px] flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-[12.5px] leading-relaxed text-zinc-300"
        >
          {text || 'No log entries yet.'}
        </pre>
      </div>
    </div>
  )
}
