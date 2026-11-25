import { Compass, LayoutGrid, Stethoscope } from 'lucide-react'
import { SectionTabs } from '../layout/SectionTabs'

const TABS = [
  { to: '/mods', label: 'Library', icon: LayoutGrid, hint: 'The supported projects', exact: true },
  { to: '/mods/tours', label: 'Mod Tours', icon: Compass, hint: 'What each project adds' },
  { to: '/mods/fix-it', label: 'Fix-it', icon: Stethoscope, hint: 'Find what stops a game from working' }
]

/** The Mods page's sections, beside its title: the library, the projects' tours and the troubleshooter. */
export function ModsTabs() {
  return <SectionTabs label="Mods" tabs={TABS} />
}
