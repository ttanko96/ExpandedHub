import { ArrowRight } from 'lucide-react'
import { versionLabel } from '@shared/status'
import type { ProjectState } from '@shared/types'

const v = (s: string) => (s.startsWith('v') ? s : `v${s}`)

/** `v0.1.1 INSTALLED → v0.1.2 AVAILABLE`, or the single relevant version. */
export function VersionLine({ state }: { state: ProjectState | undefined }) {
  if (!state) return <Chip tone="muted">CHECKING…</Chip>
  const { installed, latest, status } = state

  if (status === 'update-available' && installed && latest) {
    return (
      <div className="flex items-center gap-2">
        <Chip tone="muted">{versionLabel(installed).toUpperCase()} INSTALLED</Chip>
        <ArrowRight size={14} className="text-emerald-400" />
        <Chip tone="green">{v(latest.version)} AVAILABLE</Chip>
      </div>
    )
  }
  if (installed) return <Chip tone="muted">{versionLabel(installed).toUpperCase()} INSTALLED</Chip>
  if (latest) return <Chip tone="muted">LATEST {v(latest.version)}{latest.prerelease ? ' · PRE-RELEASE' : ''}</Chip>
  if (state.latestCommit) return <Chip tone="muted">NO RELEASES YET</Chip>
  return <Chip tone="muted">NO RELEASE INFO</Chip>
}

function Chip({ tone, children }: { tone: 'muted' | 'green'; children: React.ReactNode }) {
  return (
    <span
      className={
        tone === 'green'
          ? 'whitespace-nowrap font-display text-[14px] font-bold tracking-[0.04em] text-emerald-300'
          : 'whitespace-nowrap font-display text-[14px] font-semibold tracking-[0.04em] text-zinc-400'
      }
    >
      {children}
    </span>
  )
}
