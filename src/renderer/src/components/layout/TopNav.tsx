import { Download, LayoutGrid, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cx } from '../../lib/format'
import { useHub } from '../../store/hub-store'
import { HubUpdateBadge } from './HubUpdateBadge'

const NAV = [
  { to: '/mods', label: 'Mods', icon: LayoutGrid },
  { to: '/downloads', label: 'Downloads', icon: Download },
  { to: '/settings', label: 'Settings', icon: Settings }
]

const isMac = navigator.userAgent.includes('Mac')

export function TopNav() {
  const updates = useHub((s) => Object.values(s.states).filter((x) => x.status === 'update-available').length)

  return (
    <header
      className={cx(
        'drag relative z-20 flex h-14 shrink-0 items-center gap-8 border-b border-line/[0.06] bg-ink-900 pr-[150px]',
        isMac ? 'pl-[88px]' : 'pl-5'
      )}
    >
      <Logo />
      <nav className="no-drag flex h-full items-stretch gap-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cx(
                'group relative flex items-center gap-2 px-4 font-display text-[15px] font-bold uppercase tracking-[0.14em] transition-colors',
                isActive ? 'text-fg' : 'text-zinc-500 hover:text-zinc-200'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={16} className={isActive ? 'text-tekken-500' : ''} />
                {label}
                {to === '/mods' && updates > 0 && (
                  <span className="ml-0.5 rounded-full bg-emerald-500 px-1.5 text-[11px] leading-[17px] text-ink-950">
                    {updates}
                  </span>
                )}
                <span
                  className={cx(
                    'absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-tekken-500 transition-transform duration-200',
                    isActive ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-50 group-hover:bg-ink-500'
                  )}
                />
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center">
        <HubUpdateBadge />
      </div>
    </header>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-7 w-9 items-center justify-center overflow-hidden rounded-[6px] bg-[#111114] ring-1 ring-white/10">
        <span className="absolute -right-2 top-0 h-full w-3 rotate-[20deg] bg-tekken-500" />
        <span className="relative -ml-1.5 font-display text-[17px] font-bold italic leading-none tracking-[-0.02em]">
          <span className="text-tekken-500">E</span>
          <span className="text-white">H</span>
        </span>
      </div>
      <span className="font-display text-[19px] font-bold italic tracking-[0.06em] text-fg">
        <span className="text-tekken-500">EXPANDED</span>HUB
      </span>
    </div>
  )
}
