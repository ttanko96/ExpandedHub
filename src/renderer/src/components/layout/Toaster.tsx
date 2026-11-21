import { X } from 'lucide-react'
import { cx } from '../../lib/format'
import { useToasts } from '../../store/toast-store'

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto animate-fade-up rounded-xl border bg-ink-800/95 p-4 shadow-2xl backdrop-blur',
            t.tone === 'error' ? 'border-tekken-500/50' : t.tone === 'success' ? 'border-emerald-500/40' : 'border-ink-600'
          )}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-display text-[15px] font-bold tracking-wide text-zinc-100">{t.title}</div>
              {t.body && <div className="mt-1 text-[13px] leading-snug text-zinc-400">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-zinc-500 hover:text-zinc-200" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
