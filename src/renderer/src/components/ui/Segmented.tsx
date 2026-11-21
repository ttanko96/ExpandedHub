import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../lib/format'

export interface SegmentedOption<T extends string> {
  id: T
  label: ReactNode
  title?: string
}

/**
 * A row of tabs where one is selected. The highlight slides to the chosen tab
 * instead of jumping, and the buttons grow with their text, so a label that
 * wraps onto two lines still fits inside its button.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (id: T) => void
  /** Accessible name of the group. */
  label: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const el = buttons.current.get(value)
      if (el) setPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
    }
    measure()
    // Labels can wrap or counts can change width: follow the button's size.
    const ro = new ResizeObserver(measure)
    if (wrap.current) ro.observe(wrap.current)
    for (const el of buttons.current.values()) ro.observe(el)
    return () => ro.disconnect()
  }, [value, options])

  return (
    <div ref={wrap} role="radiogroup" aria-label={label} className="relative flex items-stretch gap-1 rounded-xl bg-ink-850 p-1">
      {pill && (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-lg bg-ink-600 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] transition-all duration-300 ease-out motion-reduce:transition-none"
          style={pill}
        />
      )}
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            ref={(el) => {
              if (el) buttons.current.set(o.id, el)
              else buttons.current.delete(o.id)
            }}
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={cx(
              'relative z-10 flex min-h-8 items-center justify-center gap-2 rounded-lg px-3.5 py-1 text-center font-display text-[14px] font-bold uppercase leading-tight tracking-[0.1em] transition-colors duration-300',
              active ? 'text-fg' : 'text-zinc-500 hover:text-zinc-200'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
