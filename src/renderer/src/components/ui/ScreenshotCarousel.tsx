import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Screenshot } from '@shared/install'
import { cx } from '../../lib/format'

/** How long each screenshot stays before the next one, in milliseconds. */
const INTERVAL = 5000

/**
 * A slideshow of a project's screenshots: plays by itself, pauses while the
 * pointer is over it, and steps with the arrows, the mouse wheel, a swipe,
 * the arrow keys or the thumbnails. Click the picture for full screen.
 */
export function ScreenshotCarousel({ shots, accent }: { shots: Screenshot[]; accent: string }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [hover, setHover] = useState(false)
  const [full, setFull] = useState(false)
  // Bumped on every step, so the timer and the progress bar start over.
  const [tick, setTick] = useState(0)
  const count = shots.length
  const current = shots[Math.min(index, count - 1)]

  const go = useCallback(
    (to: number) => {
      if (!count) return
      setIndex(((to % count) + count) % count)
      setTick((t) => t + 1)
    },
    [count]
  )
  const step = useCallback((d: number) => go(index + d), [go, index])

  useEffect(() => {
    if (index >= count) setIndex(0)
  }, [count, index])

  const running = playing && !hover && !full && count > 1
  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => step(1), INTERVAL)
    return () => clearTimeout(t)
  }, [running, step, tick])

  // The next picture is fetched ahead, so it appears without a flash.
  useEffect(() => {
    if (count > 1) new Image().src = shots[(index + 1) % count]!.url
  }, [index, count, shots])

  // The active thumbnail stays in view.
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = strip.current?.children[index] as HTMLElement | undefined
    const box = strip.current
    if (el && box) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [index])

  const nav = useNav(step)

  if (!current) return null

  return (
    <div className="flex flex-col gap-3">
      <div
        tabIndex={0}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1)
          else if (e.key === 'ArrowRight') step(1)
          else if (e.key === 'Enter') setFull(true)
          else return
          e.preventDefault()
        }}
        {...nav}
        className="group relative aspect-[16/10] select-none overflow-hidden rounded-xl border border-line/[0.06] bg-black/50 outline-none focus-visible:border-line/25"
      >
        <img
          key={current.url}
          src={current.url}
          alt={current.name}
          draggable={false}
          onClick={() => !nav.dragged() && setFull(true)}
          className="absolute inset-0 size-full cursor-zoom-in animate-fade-in object-contain"
        />
        {count > 1 && (
          <>
            <Arrow side="left" onClick={() => step(-1)} />
            <Arrow side="right" onClick={() => step(1)} />
          </>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10">
          <span className="truncate text-[12px] text-zinc-300">{current.name}</span>
          <div className="pointer-events-auto flex items-center gap-1.5">
            <span className="mr-1 font-display text-[14px] font-bold tracking-[0.06em] text-zinc-200">
              {index + 1} / {count}
            </span>
            {count > 1 && (
              <OverlayButton label={playing ? 'Pause the slideshow' : 'Play the slideshow'} onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </OverlayButton>
            )}
            <OverlayButton label="Full screen" onClick={() => setFull(true)}>
              <Maximize2 size={14} />
            </OverlayButton>
          </div>
        </div>
        {count > 1 && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
            <div
              key={`${tick}-${running}`}
              className={cx('h-full origin-left', running ? 'animate-slide-progress' : 'scale-x-0')}
              style={{ background: accent, animationDuration: `${INTERVAL}ms` }}
            />
          </div>
        )}
      </div>

      {count > 1 && (
        <div ref={strip} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {shots.map((s, i) => (
            <button
              key={s.url}
              onClick={() => go(i)}
              title={s.name}
              className={cx(
                'relative h-16 w-24 shrink-0 overflow-hidden rounded-md border-2 bg-black/40 transition-[border-color,opacity] duration-200',
                i === index ? 'opacity-100' : 'border-transparent opacity-50 hover:opacity-90'
              )}
              style={i === index ? { borderColor: accent } : undefined}
            >
              <img src={s.url} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {full && <Lightbox shots={shots} index={index} onStep={step} onClose={() => setFull(false)} />}
    </div>
  )
}

/** Mouse wheel and swipe (drag) stepping, shared by the slideshow and full screen. */
function useNav(step: (d: number) => void) {
  const lastWheel = useRef(0)
  const start = useRef<{ x: number; id: number } | null>(null)
  const moved = useRef(false)
  return {
    onWheel: (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      const now = Date.now()
      if (Math.abs(d) < 4 || now - lastWheel.current < 350) return
      lastWheel.current = now
      step(d > 0 ? 1 : -1)
    },
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return
      start.current = { x: e.clientX, id: e.pointerId }
      moved.current = false
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current
      start.current = null
      if (!s || s.id !== e.pointerId) return
      const dx = e.clientX - s.x
      if (Math.abs(dx) > 50) {
        moved.current = true
        step(dx < 0 ? 1 : -1)
      }
    },
    /** True right after a swipe, so it does not count as a click too. */
    dragged: () => {
      const m = moved.current
      moved.current = false
      return m
    }
  }
}

function Lightbox({ shots, index, onStep, onClose }: { shots: Screenshot[]; index: number; onStep: (d: number) => void; onClose: () => void }) {
  const shot = shots[index]!
  const { dragged, ...nav } = useNav(onStep)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onStep(-1)
      else if (e.key === 'ArrowRight') onStep(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  return createPortal(
    <div
      {...nav}
      onClick={() => !dragged() && onClose()}
      className="fixed inset-0 z-50 flex animate-fade-in select-none items-center justify-center bg-black/90 p-10 backdrop-blur-sm"
    >
      <img
        key={shot.url}
        src={shot.url}
        alt={shot.name}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full animate-fade-in object-contain shadow-2xl"
      />
      {shots.length > 1 && (
        <>
          <Arrow side="left" big onClick={() => onStep(-1)} />
          <Arrow side="right" big onClick={() => onStep(1)} />
        </>
      )}
      <div className="absolute left-1/2 top-4 -translate-x-1/2 font-display text-[15px] font-bold tracking-[0.06em] text-zinc-300">
        {index + 1} / {shots.length}
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-zinc-200 transition-colors hover:bg-white/20"
      >
        <X size={18} />
      </button>
    </div>,
    document.body
  )
}

function Arrow({ side, onClick, big = false }: { side: 'left' | 'right'; onClick: () => void; big?: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      aria-label={side === 'left' ? 'Previous screenshot' : 'Next screenshot'}
      className={cx(
        'absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-zinc-100 backdrop-blur transition-[opacity,background-color] hover:bg-black/80',
        big ? 'size-12' : 'size-10 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
        side === 'left' ? (big ? 'left-4' : 'left-3') : big ? 'right-4' : 'right-3'
      )}
    >
      {side === 'left' ? <ChevronLeft size={big ? 26 : 22} /> : <ChevronRight size={big ? 26 : 22} />}
    </button>
  )
}

function OverlayButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-full bg-black/50 text-zinc-200 transition-colors hover:bg-black/80"
    >
      {children}
    </button>
  )
}
