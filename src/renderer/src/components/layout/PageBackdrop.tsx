import { useLocation } from 'react-router-dom'

type Tone = 'mods' | 'downloads' | 'settings'

/** Each page's glow colour: the mods red, downloads green, settings violet. */
const TONES: Record<Tone, string> = {
  mods: '216, 30, 52',
  downloads: '16, 185, 129',
  settings: '139, 92, 246'
}

function toneFor(path: string): Tone {
  if (path.startsWith('/downloads')) return 'downloads'
  if (path.startsWith('/settings')) return 'settings'
  return 'mods'
}

/**
 * A soft glow whose brightness falls off along a bell curve and reaches
 * nothing exactly at its edge, in many small steps, so neither rings nor an
 * outline show. It needs no CSS blur (which Chromium renders blocky on large
 * moving layers).
 */
function glow(rgb: string, alpha: number): string {
  const steps = 28
  const floor = Math.exp(-4.2)
  const stops: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const k = Math.max(0, (Math.exp(-4.2 * t * t) - floor) / (1 - floor))
    stops.push(`rgba(${rgb}, ${(alpha * k).toFixed(4)}) ${(t * 100).toFixed(1)}%`)
  }
  return `radial-gradient(closest-side, ${stops.join(', ')})`
}

/** Fine film grain: dithers the dark, faint gradients so they show no bands. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

/**
 * A faint wash of colour behind the page, tinted per section. The glows
 * swim around in loops on their own; all tones are drawn and cross-fade, so switching
 * pages blends from one colour to the next. A light grain on top keeps the
 * gradients smooth. It stays put while the page scrolls, never takes clicks,
 * and holds still when the system asks for reduced motion.
 */
export function PageBackdrop() {
  const active = toneFor(useLocation().pathname)
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 top-14 overflow-hidden">
      {(Object.keys(TONES) as Tone[]).map((tone) => {
        const rgb = TONES[tone]
        return (
          <div
            key={tone}
            className="absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none"
            style={{ opacity: tone === active ? 1 : 0 }}
          >
            <div
              className="absolute -right-[20%] -top-[45%] h-[110%] w-[80%] animate-drift-a will-change-transform motion-reduce:animate-none"
              style={{ background: glow(rgb, 0.17) }}
            />
            <div
              className="absolute -bottom-[50%] -left-[20%] h-[105%] w-[75%] animate-drift-b will-change-transform motion-reduce:animate-none"
              style={{ background: glow(rgb, 0.1) }}
            />
            <div
              className="absolute left-[25%] top-[15%] h-[75%] w-[55%] animate-drift-c will-change-transform motion-reduce:animate-none"
              style={{ background: glow(rgb, 0.075) }}
            />
            <div
              className="absolute -left-[15%] top-[-30%] h-[70%] w-[50%] animate-drift-d will-change-transform motion-reduce:animate-none"
              style={{ background: glow(rgb, 0.08) }}
            />
          </div>
        )
      })}
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: GRAIN, backgroundSize: '180px 180px' }} />
    </div>
  )
}
