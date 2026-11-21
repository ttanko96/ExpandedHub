import { AlertTriangle, CheckCircle2, Circle, FileQuestion, Loader2, RefreshCw, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SourceConfig } from '@shared/install'
import { cx, formatBytes } from '../../lib/format'
import { toast } from '../../store/toast-store'
import { ipcMessage } from '../mods/actions'
import { Button } from '../ui/Button'

/** Status icon + text for a configured (or missing) game file. */
export function sourceStatus(config: SourceConfig | null | undefined, required: boolean | undefined) {
  if (!config) {
    if (required === undefined) return { icon: <Circle size={16} className="text-zinc-600" />, text: 'Not selected', tone: 'text-zinc-500' }
    return required
      ? { icon: <Circle size={16} className="text-violet-300" />, text: 'Not selected', tone: 'text-violet-200' }
      : { icon: <Circle size={16} className="text-zinc-600" />, text: 'Not selected (optional)', tone: 'text-zinc-500' }
  }
  if (config.validating) return { icon: <Loader2 size={16} className="animate-spin text-sky-300" />, text: 'Checking…', tone: 'text-sky-300' }
  const v = config.validation
  switch (v?.verdict) {
    case 'verified':
      return { icon: <CheckCircle2 size={16} className="text-emerald-400" />, text: v.message, tone: 'text-emerald-300' }
    case 'unverified':
      return { icon: <FileQuestion size={16} className="text-zinc-300" />, text: v.message, tone: 'text-zinc-400' }
    case 'mismatch':
      return { icon: <AlertTriangle size={16} className="text-amber-300" />, text: v.message, tone: 'text-amber-200' }
    case 'missing':
    case 'invalid':
      return { icon: <AlertTriangle size={16} className="text-tekken-400" />, text: v.message, tone: 'text-tekken-400' }
    default:
      return { icon: <Loader2 size={16} className="animate-spin text-sky-300" />, text: 'Waiting to be checked…', tone: 'text-zinc-400' }
  }
}

const pick = (gameId: string) =>
  window.hub.sources.pick(gameId).catch((err) => toast({ tone: 'error', title: 'File not accepted', body: ipcMessage(err) }))

export function SourceRow(props: {
  gameId: string
  name: string
  platform: string
  /** Undefined outside a project context (Settings), where required/optional does not apply. */
  required?: boolean
  purpose?: string
  config: SourceConfig | null | undefined
  compact?: boolean
  /** Extra content under the status line (Settings: the projects this file works with). */
  footer?: ReactNode
}) {
  const st = sourceStatus(props.config, props.required)
  return (
    <div className={cx('flex items-start gap-3', props.compact ? 'py-2' : 'py-3')}>
      <span className="mt-0.5 shrink-0">{st.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-zinc-200">
          {props.name}
          <span className="ml-2 text-[12px] text-zinc-500">{props.platform}</span>
          {props.required && !props.compact && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-violet-300/80">required</span>}
        </div>
        {props.purpose && <div className="text-[12.5px] text-zinc-500">{props.purpose}</div>}
        {props.config && (
          <div className="selectable mt-0.5 truncate text-[12px] text-zinc-500" title={props.config.path}>
            {props.config.path} · {formatBytes(props.config.size)}
          </div>
        )}
        <div className={cx('mt-0.5 text-[12.5px]', st.tone)}>{st.text}</div>
        {props.footer}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {props.config && (
          <>
            <button
              title="Check again"
              onClick={() => void window.hub.sources.validate(props.gameId)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-ink-700 hover:text-zinc-200"
            >
              <RefreshCw size={14} />
            </button>
            <button
              title="Forget this file"
              onClick={() => void window.hub.sources.remove(props.gameId)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-ink-700 hover:text-tekken-400"
            >
              <X size={14} />
            </button>
          </>
        )}
        <Button size="sm" variant="secondary" onClick={() => void pick(props.gameId)}>
          {props.config ? 'Change' : 'Select'}
        </Button>
      </div>
    </div>
  )
}
