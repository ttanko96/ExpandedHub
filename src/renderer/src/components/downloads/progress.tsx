import type { Operation } from '@shared/operations'
import { cx, formatBytes } from '../../lib/format'
import { formatEta, percent } from './progress-math'

export { formatEta, percent }

export function ProgressBar({ op, thin }: { op: Operation; thin?: boolean }) {
  const pct = percent(op)
  const tone =
    op.status === 'failed'
      ? 'from-tekken-700 to-tekken-500'
      : op.status === 'paused'
        ? 'from-zinc-600 to-zinc-500'
        : op.status === 'completed'
          ? 'from-emerald-600 to-emerald-400'
          : 'from-tekken-600 to-tekken-400'
  const width = op.status === 'completed' ? 100 : (pct ?? 0)
  return (
    <div className={cx('overflow-hidden rounded-full bg-ink-700', thin ? 'h-1.5' : 'h-2')}>
      {pct === null && op.status === 'running' ? (
        <div className="h-full w-full animate-shimmer bg-[linear-gradient(90deg,transparent,#d81e34,transparent)] bg-[length:50%_100%] bg-no-repeat" />
      ) : (
        <div className={cx('h-full rounded-full bg-gradient-to-r transition-[width] duration-300', tone)} style={{ width: `${width}%` }} />
      )}
    </div>
  )
}

/** "48.2 MB of 131 MB · 6.4 MB/s · 12s left" */
export function transferLine(op: Operation): string {
  const parts: string[] = []
  if (op.total) parts.push(`${formatBytes(op.received)} of ${formatBytes(op.total)}`)
  else if (op.received) parts.push(formatBytes(op.received))
  if (op.status === 'running' && op.speed > 0) parts.push(`${formatBytes(op.speed)}/s`)
  const eta = op.status === 'running' ? formatEta(op.etaSeconds) : ''
  if (eta) parts.push(eta)
  return parts.join(' · ')
}
