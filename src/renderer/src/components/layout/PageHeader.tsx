import type { ReactNode } from 'react'

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        <div className="font-display text-[13px] font-bold uppercase tracking-[0.3em] text-tekken-500">{eyebrow}</div>
        <h1 className="mt-1 font-display text-[44px] font-bold uppercase italic leading-none tracking-[0.02em] text-fg">
          {title}
        </h1>
      </div>
      {children}
    </div>
  )
}

export function ComingSoon({ phase, title, children }: { phase: string; title: string; children: ReactNode }) {
  return (
    <div className="relative mt-8 overflow-hidden rounded-2xl border border-dashed border-ink-600 bg-ink-850/60 p-10">
      <div className="absolute -right-10 -top-10 size-48 rotate-12 rounded-3xl bg-tekken-500/[0.06]" />
      <div className="font-display text-[13px] font-bold uppercase tracking-[0.24em] text-zinc-500">{phase}</div>
      <div className="mt-2 font-display text-[26px] font-bold uppercase tracking-wide text-zinc-200">{title}</div>
      <div className="mt-3 max-w-2xl text-[14px] leading-relaxed text-zinc-400">{children}</div>
    </div>
  )
}
