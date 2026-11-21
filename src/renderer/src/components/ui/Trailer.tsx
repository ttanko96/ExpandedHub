import { Play } from 'lucide-react'
import { useState } from 'react'
import type { ProjectDefinition } from '@shared/registry-schema'
import { cx } from '../../lib/format'
import { toast } from '../../store/toast-store'

type TrailerInfo = NonNullable<ProjectDefinition['trailer']>

export const trailerUrl = (t: TrailerInfo) => `https://www.youtube.com/watch?v=${t.youtube}${t.start ? `&t=${t.start}s` : ''}`

/**
 * A project's trailer: its YouTube thumbnail with a play button. Opens in the
 * browser (embedded YouTube players do not run from the app's local pages).
 */
export function Trailer({ trailer, accent, className }: { trailer: TrailerInfo; accent: string; className?: string }) {
  // maxresdefault is missing for some videos: fall back to hqdefault.
  const [src, setSrc] = useState(`https://i.ytimg.com/vi/${trailer.youtube}/maxresdefault.jpg`)
  const open = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.hub.app.openExternal(trailerUrl(trailer)).catch((err) => toast({ tone: 'error', title: 'Could not open the trailer', body: String(err) }))
  }
  return (
    <button
      onClick={open}
      title={`${trailer.title ?? 'Watch the trailer'} (YouTube)`}
      className={cx('group/trailer relative block aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-ink-800', className)}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setSrc(`https://i.ytimg.com/vi/${trailer.youtube}/hqdefault.jpg`)}
        className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover/trailer:scale-105"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <span
        className="absolute left-1/2 top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-lg transition-transform group-hover/trailer:scale-110"
        style={{ background: accent, boxShadow: `0 0 24px ${accent}99` }}
      >
        <Play size={20} className="ml-0.5 fill-white text-white" />
      </span>
      <span className="absolute bottom-2 left-3 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-white drop-shadow">
        {trailer.title ?? 'Watch trailer'}
      </span>
    </button>
  )
}
