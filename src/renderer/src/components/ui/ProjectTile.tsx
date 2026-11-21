import type { ProjectDefinition } from '@shared/registry-schema'
import { cx } from '../../lib/format'

/** Project artwork. Falls back to a generated tile from the registry accent color and monogram. */
export function ProjectTile({ project, size = 'md' }: { project: ProjectDefinition; size?: 'sm' | 'md' | 'lg' }) {
  const { accent, monogram } = project.artwork
  const text = monogram ?? project.name.replace(/[^A-Z0-9]/g, '').slice(0, 3)
  return (
    <div
      className={cx(
        'relative shrink-0 overflow-hidden rounded-xl border border-white/5',
        size === 'sm' ? 'size-16 rounded-lg' : size === 'md' ? 'size-[104px]' : 'size-[148px]'
      )}
      style={{
        background: `radial-gradient(120% 90% at 20% 10%, ${accent}55 0%, transparent 60%), linear-gradient(145deg, #1b1b20 0%, #0d0d10 100%)`
      }}
    >
      {/* diagonal slash, a nod to the Tekken logo */}
      <div
        className="absolute -right-6 top-0 h-full w-10 rotate-[18deg] opacity-80"
        style={{ background: `linear-gradient(180deg, ${accent}, transparent)` }}
      />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.025)_6px_7px)]" />
      <span
        className={cx(
          'absolute font-display font-bold italic leading-none tracking-tight text-white drop-shadow',
          size === 'sm'
            ? 'bottom-1.5 left-2 text-[17px]'
            : size === 'md'
              ? cx('bottom-2 left-3', text.length > 3 ? 'text-[26px]' : 'text-[32px]')
              : 'bottom-2 left-3 text-[44px]'
        )}
      >
        {text}
      </span>
    </div>
  )
}
