import { Compass, Gamepad2, Stethoscope, Users } from 'lucide-react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { FighterPage } from '../dojo/FighterPage'
import { FixIt } from '../dojo/FixIt'
import { Roster } from '../dojo/Roster'
import { Tours } from '../dojo/Tours'
import { Trainer } from '../dojo/Trainer'
import { cx } from '../lib/format'

const TABS = [
  { to: '/dojo/roster', label: 'Roster', icon: Users, hint: 'Fighters and their moves' },
  { to: '/dojo/trainer', label: 'Trainer', icon: Gamepad2, hint: 'Practise commands on your controller' },
  { to: '/dojo/tours', label: 'Mod Tours', icon: Compass, hint: 'What each project adds' },
  { to: '/dojo/fix-it', label: 'Fix-it', icon: Stethoscope, hint: 'Find what stops a game from working' }
]

/** The Dojo: fighters, move lists, an input trainer, project tours and a troubleshooter. */
export function DojoPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-8 pb-16 pt-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <div className="font-display text-[13px] font-bold uppercase tracking-[0.3em] text-tekken-500">Learn · Practise · Fix</div>
          <h1 className="mt-1 font-display text-[44px] font-bold uppercase italic leading-none tracking-[0.02em] text-fg">Dojo</h1>
        </div>
        <nav aria-label="Dojo" className="flex gap-1 rounded-xl bg-ink-850 p-1">
          {TABS.map(({ to, label, icon: Icon, hint }) => (
            <NavLink
              key={to}
              to={to}
              title={hint}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2 rounded-lg px-3.5 py-1.5 font-display text-[14px] font-bold uppercase tracking-[0.1em] transition-colors duration-200',
                  isActive ? 'bg-ink-600 text-fg' : 'text-zinc-500 hover:text-zinc-200'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} className={isActive ? 'text-tekken-500' : ''} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="mt-7">
        <Routes>
          <Route index element={<Navigate to="roster" replace />} />
          <Route path="roster" element={<Roster />} />
          <Route path="fighters/:id" element={<FighterPage />} />
          <Route path="trainer" element={<Trainer />} />
          <Route path="tours" element={<Tours />} />
          <Route path="tours/:projectId" element={<Tours />} />
          <Route path="fix-it" element={<FixIt />} />
          <Route path="*" element={<Navigate to="roster" replace />} />
        </Routes>
      </div>

      <p className="mt-14 border-t border-line/[0.06] pt-4 text-[12px] leading-relaxed text-zinc-600">
        The Dojo is written for ExpandedHub by its contributors (CC BY 4.0) and drawn by the hub itself: it holds no
        artwork, sound or text from the games. Tekken is a trademark of Bandai Namco Entertainment; ExpandedHub is an
        unofficial fan project, not affiliated with or endorsed by Bandai Namco. Game and character names only
        describe them.
      </p>
    </div>
  )
}
