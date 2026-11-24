import { AlertTriangle, ArrowDownToLine, Check, ExternalLink, Loader2, RotateCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { isActive } from '@shared/operations'
import { cx } from '../../lib/format'
import { useHub } from '../../store/hub-store'
import { toast } from '../../store/toast-store'

/**
 * Right side of the top bar: ExpandedHub's own version status. Shows a check
 * mark when up to date, and an update button (with a notification) when a new
 * release is out; clicking it downloads and installs the new version.
 */
export function HubUpdateBadge() {
  const u = useHub((s) => s.hubUpdate)
  const busyOps = useHub((s) => s.operations.some(isActive))
  const notified = useRef<string | null>(null)

  // One notification per new version.
  useEffect(() => {
    if (u?.status === 'available' && u.latest && notified.current !== u.latest.version) {
      notified.current = u.latest.version
      toast({
        tone: 'info',
        title: `ExpandedHub ${u.latest.version} is available`,
        body: u.canInstall ? 'Click Update in the top bar to install it. The hub restarts afterwards.' : 'Click Update in the top bar to download it from GitHub.'
      })
    }
  }, [u?.status, u?.latest, u?.canInstall])

  // Errors during a download / start of the installer.
  const lastError = useRef<string | null>(null)
  useEffect(() => {
    if (u?.status === 'available' && u.error && u.error !== lastError.current) toast({ tone: 'error', title: 'Update failed', body: u.error })
    lastError.current = u?.error ?? null
  }, [u?.status, u?.error])

  if (!u || u.status === 'idle') return null

  const base =
    'no-drag flex h-8 items-center gap-1.5 rounded-lg px-3 font-display text-[13px] font-bold uppercase tracking-[0.12em] transition-colors'

  switch (u.status) {
    case 'checking':
      return (
        <span className={cx(base, 'text-zinc-500')}>
          <Loader2 size={14} className="animate-spin" />
          Checking…
        </span>
      )
    case 'up-to-date':
      return (
        <button
          className={cx(base, 'group text-zinc-500 hover:bg-ink-700 hover:text-zinc-200')}
          title={`ExpandedHub ${u.currentVersion} is the latest version${u.checkedAt ? ` · checked ${new Date(u.checkedAt).toLocaleTimeString()}` : ''}. Click to check again.`}
          onClick={() => void window.hub.hubUpdate.check()}
        >
          <Check size={15} className="text-emerald-500 group-hover:hidden" />
          <RotateCw size={14} className="hidden group-hover:block" />
          Up to date
          <span className="ml-1 font-semibold normal-case tracking-normal text-zinc-600 group-hover:text-zinc-400">
            v{u.currentVersion}
          </span>
        </button>
      )
    case 'error':
      return (
        <button
          className={cx(base, 'text-zinc-500 hover:bg-ink-700 hover:text-zinc-200')}
          title={`${u.error ?? 'Update check failed'}. Click to try again.`}
          onClick={() => void window.hub.hubUpdate.check()}
        >
          <AlertTriangle size={14} className="text-amber-500" />
          Update check failed
        </button>
      )
    case 'available': {
      const blocked = u.canInstall && busyOps
      return (
        <button
          className={cx(
            base,
            'relative bg-emerald-500 text-ink-950 shadow-[0_6px_20px_-8px_rgba(16,185,129,0.8)] hover:bg-emerald-400',
            blocked && 'opacity-60'
          )}
          title={
            blocked
              ? 'Wait for the running downloads and installs to finish before updating ExpandedHub.'
              : u.canInstall
                ? `Install ExpandedHub ${u.latest?.version} (you have ${u.currentVersion}). The hub restarts afterwards.`
                : `ExpandedHub ${u.latest?.version} is out (you have ${u.currentVersion}). Opens the release on GitHub.`
          }
          onClick={() => {
            if (blocked) {
              toast({ tone: 'info', title: 'Update waits', body: 'Finish or cancel the running downloads and installs first.' })
              return
            }
            void window.hub.hubUpdate.install()
          }}
        >
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tekken-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-tekken-500" />
          </span>
          {u.canInstall ? <ArrowDownToLine size={15} /> : <ExternalLink size={14} />}
          Update {u.latest?.version}
        </button>
      )
    }
    case 'downloading':
      return (
        <span className={cx(base, 'relative overflow-hidden bg-ink-700 text-zinc-200')}>
          <span
            className="absolute inset-y-0 left-0 bg-emerald-500/25 transition-[width] duration-300"
            style={{ width: `${Math.round((u.progress ?? 0) * 100)}%` }}
          />
          <Loader2 size={14} className="relative animate-spin text-emerald-500" />
          <span className="relative">Updating{u.progress !== null ? ` ${Math.round(u.progress * 100)}%` : '…'}</span>
        </span>
      )
    case 'installing':
      return (
        <span className={cx(base, 'text-emerald-500')}>
          <Loader2 size={14} className="animate-spin" />
          Restarting…
        </span>
      )
  }
}
