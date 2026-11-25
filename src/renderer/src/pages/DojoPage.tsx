import { Gamepad2, Users } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { SectionTabs } from '../components/layout/SectionTabs'
import { FighterPage } from '../dojo/FighterPage'
import { Roster } from '../dojo/Roster'
import { Trainer } from '../dojo/Trainer'

const TABS = [
  { to: '/dojo/roster', label: 'Roster', icon: Users, hint: 'Fighters and their moves', also: ['/dojo/fighters'] },
  { to: '/dojo/trainer', label: 'Trainer', icon: Gamepad2, hint: 'Practise commands on your controller' }
]

/** The Dojo: fighters, their move lists and an input trainer. */
export function DojoPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-8 pb-16 pt-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <div className="font-display text-[13px] font-bold uppercase tracking-[0.3em] text-tekken-500">Learn · Practise</div>
          <h1 className="mt-1 font-display text-[44px] font-bold uppercase italic leading-none tracking-[0.02em] text-fg">Dojo</h1>
        </div>
        <SectionTabs label="Dojo" tabs={TABS} />
      </div>

      <div className="mt-7">
        <Routes>
          <Route index element={<Navigate to="roster" replace />} />
          <Route path="roster" element={<Roster />} />
          <Route path="fighters/:id" element={<FighterPage />} />
          <Route path="trainer" element={<Trainer />} />
          {/* Mod Tours and Fix-it moved to the Mods page. */}
          <Route path="tours/*" element={<Navigate to="/mods/tours" replace />} />
          <Route path="fix-it" element={<Navigate to="/mods" replace />} />
          <Route path="*" element={<Navigate to="roster" replace />} />
        </Routes>
      </div>

      <p className="mt-14 border-t border-line/[0.06] pt-4 text-[12px] leading-relaxed text-zinc-600">
        The Dojo is written for ExpandedHub by its contributors (CC BY 4.0) and drawn by the hub itself: it holds no
        artwork, sound or text from the games. Its move lists are adapted from the Tekken Wiki (CC BY-SA 3.0). Fighter
        portraits, when switched on in Settings, come from your own Tekken 3 Expanded and TMST add-on installation and
        stay on this PC. Tekken is a trademark of Bandai Namco Entertainment; ExpandedHub is an unofficial fan project, not
        affiliated with or endorsed by Bandai Namco. Game and character names only describe them.
      </p>
    </div>
  )
}
