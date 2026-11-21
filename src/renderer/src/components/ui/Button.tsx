import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../lib/format'

type Variant = 'primary' | 'update' | 'secondary' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-tekken-500 text-white hover:bg-tekken-400 shadow-[0_6px_20px_-8px_rgba(216,30,52,0.8)] active:bg-tekken-600',
  update:
    'bg-emerald-500 text-ink-950 hover:bg-emerald-400 shadow-[0_6px_20px_-8px_rgba(16,185,129,0.8)] active:bg-emerald-600',
  secondary: 'bg-ink-700 text-zinc-200 hover:bg-ink-600 border border-ink-600',
  ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-ink-700'
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-display font-bold uppercase tracking-[0.1em] transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? 'h-10 px-5 text-[15px]' : 'h-8 px-3 text-[13px]',
        VARIANTS[variant],
        className
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex size-10 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-zinc-400 transition-colors hover:border-ink-500 hover:bg-ink-700 hover:text-zinc-100',
        className
      )}
    >
      {children}
    </button>
  )
}
