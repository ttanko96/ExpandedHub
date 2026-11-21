import type { ProjectStatus } from '@shared/types'

export interface StatusMeta {
  text: string
  /** Tailwind classes for the badge. */
  tone: string
  dot: string
  /** Label of the primary action, null when there is nothing to do. */
  action: string | null
}

/** Single source of truth for how each status looks and what the primary action is. */
export const STATUS_META: Record<ProjectStatus, StatusMeta> = {
  'not-installed': {
    text: 'NOT INSTALLED',
    tone: 'border-zinc-600/50 bg-zinc-500/10 text-zinc-400',
    dot: 'bg-zinc-500',
    action: 'INSTALL'
  },
  'install-available': {
    text: 'INSTALLATION AVAILABLE',
    tone: 'border-zinc-500/50 bg-zinc-400/10 text-zinc-300',
    dot: 'bg-zinc-300',
    action: 'INSTALL'
  },
  'update-available': {
    text: 'NEW VERSION AVAILABLE',
    tone: 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300 shadow-[0_0_18px_-4px_rgba(52,211,153,0.55)]',
    dot: 'bg-emerald-400 animate-pulse',
    action: 'UPDATE'
  },
  installing: {
    text: 'INSTALLING',
    tone: 'border-sky-400/50 bg-sky-400/10 text-sky-300',
    dot: 'bg-sky-400 animate-pulse',
    action: null
  },
  failed: {
    text: 'FAILED',
    tone: 'border-tekken-500/60 bg-tekken-500/15 text-tekken-400',
    dot: 'bg-tekken-500',
    action: 'RETRY'
  },
  'up-to-date': {
    text: 'UP TO DATE',
    tone: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400/90',
    dot: 'bg-emerald-500',
    action: null
  }
}
