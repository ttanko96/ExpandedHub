import { ImageIcon, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PORTRAIT_FILES, TMST_PORTRAIT_FILES } from '@shared/dojo-portraits'
import { Button } from '../components/ui/Button'
import { useHub } from '../store/hub-store'
import { toast } from '../store/toast-store'
import { usePortraits } from './portraits'

/** What the player still needs to do for the portraits; each one is hidden on its own. */
type Kind = 'off' | 'game' | 'tmst'

const HIDDEN_KEY = 'expandedhub.dojoPortraitHint'
function readHidden(): Kind[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as Kind[]
  } catch {
    return []
  }
}

const linkClass = 'font-semibold text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300'

/**
 * Above the roster: where the fighter portraits come from and what is still missing, so nobody has to
 * find the switch in Settings → Dojo. Shows nothing once every portrait is there.
 */
export function PortraitHint() {
  const on = useHub((s) => s.settings?.dojo.portraits)
  const updateSettings = useHub((s) => s.updateSettings)
  const found = usePortraits()
  const [hidden, setHidden] = useState<Kind[]>(readHidden)

  const have = found?.portraits ?? {}
  const kind: Kind | null =
    on === undefined
      ? null
      : !on
        ? 'off'
        : found === null
          ? null
          : !Object.keys(PORTRAIT_FILES).some((f) => have[f])
            ? 'game'
            : Object.keys(TMST_PORTRAIT_FILES).some((f) => !have[f])
              ? 'tmst'
              : null
  // Nothing to do (or the strip was hidden): a quiet link stays, so the setting is always one click away.
  if (on === undefined) return null
  if (!kind || hidden.includes(kind)) {
    return (
      <div className="mt-3 flex justify-end">
        <Link
          to="/settings?section=dojo"
          className="flex items-center gap-1.5 text-[12px] text-zinc-500 transition-colors hover:text-zinc-300"
          title="Portraits come from your own Tekken 3 Expanded and TMST add-on"
        >
          <ImageIcon size={13} />
          Fighter portraits: {on ? 'on' : 'off'} · Settings → Dojo
        </Link>
      </div>
    )
  }

  const hide = () => {
    const next = [...hidden, kind]
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
    } catch {
      /* it shows again next time */
    }
  }
  const turnOn = () =>
    updateSettings({ dojo: { portraits: true } }).catch((e) => toast({ tone: 'error', title: 'Could not save settings', body: String(e) }))

  const tmst = (
    <Link to="/mods/tmst-addon" className={linkClass}>
      TMST add-on
    </Link>
  )
  let body: ReactNode
  if (kind === 'off') {
    body = (
      <>
        The Dojo can show every fighter's portrait from your own installed games: Tekken 3 Expanded for most of the cast,
        the {tmst} for Anna, Gon and Dr. B. They stay on this PC.
      </>
    )
  } else if (kind === 'game') {
    body = (
      <>
        None found yet. Install{' '}
        <Link to="/mods/tekken3-expanded" className={linkClass}>
          Tekken 3 Expanded
        </Link>{' '}
        with your Tekken 3 arcade and Tag Tournament files for most of the cast, and the {tmst} for Anna, Gon and Dr. B.
      </>
    )
  } else {
    body = <>Anna, Gon and Dr. B come from the {tmst}: install it into Tekken 3 Expanded and they appear here.</>
  }

  return (
    <div className="mt-4 flex animate-fade-up items-center gap-4 rounded-xl border border-line/[0.06] bg-ink-850 px-4 py-3">
      <ImageIcon size={18} className="shrink-0 text-tekken-400" />
      <div className="min-w-0 flex-1 text-[13px] leading-snug text-zinc-400">
        <span className="mr-2 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-fg">Fighter portraits</span>
        {body}{' '}
        <Link to="/settings?section=dojo" className="whitespace-nowrap text-zinc-500 hover:text-zinc-300">
          Settings → Dojo
        </Link>
      </div>
      {kind === 'off' && (
        <Button size="sm" variant="primary" onClick={turnOn}>
          Show portraits
        </Button>
      )}
      <button onClick={hide} title="Hide this" aria-label="Hide this" className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-ink-700 hover:text-zinc-200">
        <X size={16} />
      </button>
    </div>
  )
}
