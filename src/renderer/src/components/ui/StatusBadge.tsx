import type { ProjectStatus } from '@shared/types'
import { cx } from '../../lib/format'
import { STATUS_META } from '../../lib/status-meta'

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={cx(
        'inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border px-3 font-display text-[13px] font-bold tracking-[0.08em]',
        meta.tone,
        className
      )}
    >
      <span className={cx('size-1.5 rounded-full', meta.dot)} />
      {meta.text}
    </span>
  )
}

/** Badge for projects the hub lists but does not install: announced ones and ones built by hand. */
export function ListingBadge({ kind, accent, className }: { kind: 'coming-soon' | 'manual'; accent?: string; className?: string }) {
  const base =
    'inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border px-3 font-display text-[13px] font-bold tracking-[0.08em]'
  if (kind === 'coming-soon') {
    const c = accent ?? '#a1a1aa'
    return (
      <span className={cx(base, className)} style={{ borderColor: `${c}80`, background: `${c}1f`, color: c }}>
        <span className="size-1.5 animate-pulse rounded-full" style={{ background: c }} />
        COMING SOON
      </span>
    )
  }
  return (
    <span className={cx(base, 'border-zinc-500/50 bg-zinc-400/10 text-zinc-300', className)}>
      <span className="size-1.5 rounded-full bg-zinc-400" />
      BUILD FROM SOURCE
    </span>
  )
}
