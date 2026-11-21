import type { LabelKind } from '@shared/registry-schema'
import { cx } from '../../lib/format'

export type LabelTone = LabelKind | 'update'

const TONES: Record<LabelTone, string> = {
  game: 'border-violet-400/35 bg-violet-500/12 text-violet-200',
  platform: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
  update: 'border-emerald-400/45 bg-emerald-400/12 text-emerald-300',
  optional: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
  info: 'border-zinc-600/40 bg-zinc-600/10 text-zinc-400'
}

/** Compact compatibility / status label. Color comes from the kind, never from the text. */
export function Label({ kind, text, hint }: { kind: LabelTone; text: string; hint?: string }) {
  return (
    <span
      title={hint}
      className={cx(
        'inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md border px-2 font-display text-[12px] font-semibold uppercase leading-none tracking-[0.06em]',
        TONES[kind],
        kind === 'optional' && 'border-dashed'
      )}
    >
      {text}
    </span>
  )
}

export const LABEL_LEGEND: { kind: LabelTone; text: string }[] = [
  { kind: 'game', text: 'Required game' },
  { kind: 'platform', text: 'Emulator / tool' },
  { kind: 'optional', text: 'Optional' },
  { kind: 'update', text: 'Update' }
]
