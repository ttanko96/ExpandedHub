import { AlertTriangle, Check, FileText, FolderOpen, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Operation } from '@shared/operations'
import { isActive } from '@shared/operations'
import { LogDialog } from '../components/downloads/LogDialog'
import { percent, ProgressBar, transferLine } from '../components/downloads/progress'
import { PageHeader } from '../components/layout/PageHeader'
import { ipcMessage } from '../components/mods/actions'
import { Button, IconButton } from '../components/ui/Button'
import { ProjectTile } from '../components/ui/ProjectTile'
import { cx, relativeTime } from '../lib/format'
import { useHub } from '../store/hub-store'
import { toast } from '../store/toast-store'

const STATUS_TEXT: Record<Operation['status'], string> = {
  queued: 'Queued',
  running: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

const STATUS_TONE: Record<Operation['status'], string> = {
  queued: 'text-zinc-400',
  running: 'text-sky-300',
  paused: 'text-amber-300',
  completed: 'text-emerald-300',
  failed: 'text-tekken-400',
  cancelled: 'text-zinc-500'
}

async function act(fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    toast({ tone: 'error', title: 'Action failed', body: ipcMessage(err) })
  }
}

export function DownloadsPage() {
  const operations = useHub((s) => s.operations)
  const [logFor, setLogFor] = useState<string | null>(null)
  const active = useMemo(() => operations.filter(isActive), [operations])
  const finished = useMemo(() => operations.filter((o) => !isActive(o)), [operations])
  const logOp = operations.find((o) => o.id === logFor)

  return (
    <div className="mx-auto max-w-[1280px] px-8 pb-16 pt-8">
      <PageHeader eyebrow="Operations" title="Downloads">
        {finished.length > 0 && (
          <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void act(() => window.hub.operations.clearFinished())}>
            Clear finished
          </Button>
        )}
      </PageHeader>

      {operations.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-ink-600 px-8 py-16 text-center">
          <div className="font-display text-[22px] font-bold uppercase tracking-wide text-zinc-300">Nothing here yet</div>
          <p className="mt-2 text-[14px] text-zinc-500">
            Press <span className="font-semibold text-zinc-300">Install</span> on a project in{' '}
            <Link to="/mods" className="text-tekken-400 hover:underline">
              Mods
            </Link>{' '}
            and its download shows up here.
          </p>
        </div>
      )}

      {active.length > 0 && (
        <Section title="Active" count={active.length}>
          {active.map((op) => (
            <OperationCard key={op.id} op={op} onLog={() => setLogFor(op.id)} />
          ))}
        </Section>
      )}
      {finished.length > 0 && (
        <Section title="Finished" count={finished.length}>
          {finished.map((op) => (
            <OperationCard key={op.id} op={op} onLog={() => setLogFor(op.id)} />
          ))}
        </Section>
      )}

      {logOp && <LogDialog op={logOp} onClose={() => setLogFor(null)} />}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-display text-[15px] font-bold uppercase tracking-[0.18em] text-zinc-400">
        {title} <span className="text-zinc-600">{count}</span>
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function OperationCard({ op, onLog }: { op: Operation; onLog: () => void }) {
  const project = useHub((s) => s.projects.find((p) => p.id === op.projectId))
  const pct = percent(op)
  const ops = window.hub.operations

  return (
    <article className="animate-fade-up rounded-2xl border border-line/[0.06] bg-ink-850 p-5">
      <div className="flex items-start gap-5">
        {project && <ProjectTile project={project} size="sm" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            {op.kind === 'tool' ? (
              <span className="truncate font-display text-[21px] font-bold uppercase tracking-wide text-fg">{op.projectName}</span>
            ) : (
              <Link to={`/mods/${op.projectId}`} className="truncate font-display text-[21px] font-bold uppercase tracking-wide text-fg hover:underline">
                {op.projectName}
              </Link>
            )}
            <span className="font-display text-[15px] font-semibold text-zinc-400">{op.tag}</span>
            <span className="rounded bg-ink-700 px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              {op.extraName ?? op.kind}
            </span>
            <span className={cx('ml-auto whitespace-nowrap font-display text-[14px] font-bold uppercase tracking-[0.1em]', STATUS_TONE[op.status])}>
              {STATUS_TEXT[op.status]}
              {op.status === 'running' && pct !== null ? ` · ${pct}%` : ''}
            </span>
          </div>

          <div className="mt-1 flex items-center justify-between gap-4 text-[13px]">
            <span className="truncate text-zinc-400">{op.message}</span>
            <span className="shrink-0 text-zinc-500">
              {isActive(op) ? transferLine(op) : op.finishedAt ? relativeTime(op.finishedAt) : ''}
            </span>
          </div>

          {op.status !== 'cancelled' && (
            <div className="mt-3">
              <ProgressBar op={op} />
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {op.steps.map((s) => (
              <span
                key={s.id}
                className={cx(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 font-display text-[12px] font-bold uppercase tracking-wider',
                  s.state === 'done' && 'bg-emerald-500/10 text-emerald-300',
                  s.state === 'active' && 'bg-tekken-500/15 text-tekken-300',
                  s.state === 'failed' && 'bg-tekken-500/20 text-tekken-400',
                  s.state === 'pending' && 'bg-ink-700 text-zinc-500',
                  s.state === 'skipped' && 'bg-ink-800 text-zinc-600 line-through'
                )}
              >
                {s.state === 'done' && <Check size={12} />}
                {s.label}
              </span>
            ))}
          </div>

          {(op.warnings?.length ?? 0) > 0 && (
            <div className="mt-3 flex gap-2.5 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] p-3 text-[13px]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
              <ul className="selectable flex flex-col gap-1 text-zinc-300">
                {op.warnings!.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {op.error && (
            <div className="mt-3 flex gap-2.5 rounded-lg border border-tekken-500/25 bg-tekken-500/[0.07] p-3 text-[13px]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-tekken-400" />
              <div>
                <div className="selectable text-zinc-200">{op.error}</div>
                {op.hint && <div className="mt-0.5 text-zinc-400">{op.hint}</div>}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 self-center">
          {op.status === 'running' && op.steps.find((s) => s.state === 'active')?.id === 'download' && (
            <IconButton label="Pause" onClick={() => void act(() => ops.pause(op.id))}>
              <Pause size={16} />
            </IconButton>
          )}
          {op.status === 'paused' && (
            <IconButton label="Resume" onClick={() => void act(() => ops.resume(op.id))} className="text-emerald-300">
              <Play size={16} />
            </IconButton>
          )}
          {(op.status === 'failed' || op.status === 'cancelled') && (
            <IconButton label="Retry" onClick={() => void act(() => ops.retry(op.id))}>
              <RotateCcw size={16} />
            </IconButton>
          )}
          {op.outputDir && (
            <IconButton label="Open folder" onClick={() => void act(() => window.hub.app.openPath(op.outputDir!))}>
              <FolderOpen size={16} />
            </IconButton>
          )}
          <IconButton label="View log" onClick={onLog}>
            <FileText size={16} />
          </IconButton>
          {isActive(op) ? (
            <IconButton label="Cancel" onClick={() => void act(() => ops.cancel(op.id))} className="hover:text-tekken-400">
              <X size={16} />
            </IconButton>
          ) : (
            <IconButton label="Remove from list" onClick={() => void act(() => ops.remove(op.id))}>
              <Trash2 size={16} />
            </IconButton>
          )}
        </div>
      </div>
    </article>
  )
}
