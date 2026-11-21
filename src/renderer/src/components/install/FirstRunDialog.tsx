import { Disc3, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useHub } from '../../store/hub-store'
import { Button } from '../ui/Button'
import { GameFilesList } from './GameFilesList'

/**
 * Shown once, the first time the hub opens: choose where your game files are
 * (the list from Settings → ISO Management), so installs can start right away.
 * Users who already have game files set up never see it. Closing it in any
 * way marks it as shown.
 */
export function FirstRunDialog() {
  const ready = useHub((s) => s.ready)
  const settings = useHub((s) => s.settings)
  const sources = useHub((s) => s.sources)
  const updateSettings = useHub((s) => s.updateSettings)
  // Decided once, when the hub has loaded: choosing files in the window must not close it.
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    if (open !== null || !ready || !settings) return
    setOpen(!settings.onboarding.gameFilesPrompted && Object.keys(sources).length === 0)
  }, [open, ready, settings, sources])

  const close = () => {
    setOpen(false)
    void updateSettings({ onboarding: { gameFilesPrompted: true } }).catch(() => {})
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null
  const chosen = Object.keys(sources).length

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Set up your game files"
        className="flex max-h-full w-full max-w-[720px] animate-fade-up flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl"
      >
        <header className="flex items-start gap-4 border-b border-line/[0.06] px-6 py-5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-tekken-500/15 text-tekken-400">
            <Disc3 size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold uppercase tracking-[0.24em] text-tekken-500">Welcome to ExpandedHub</div>
            <div className="font-display text-[26px] font-bold uppercase leading-tight tracking-wide text-fg">Set up your game files</div>
            <p className="mt-1.5 text-[13.5px] leading-snug text-zinc-400">
              Tell the hub where your own copies of the games are. You do this once: every project uses them, and they are
              checked against known good dumps. You can skip anything now and change it later in Settings → ISO Management.
            </p>
          </div>
          <button onClick={close} className="text-zinc-500 hover:text-fg" aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          <GameFilesList />
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-line/[0.06] px-6 py-4">
          <div className="text-[12.5px] text-zinc-500">
            {chosen > 0 ? `${chosen} game${chosen === 1 ? '' : 's'} set up` : 'ExpandedHub never downloads games or uploads your files.'}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              Skip for now
            </Button>
            <Button variant="primary" onClick={close} className="min-w-[120px]">
              Done
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
