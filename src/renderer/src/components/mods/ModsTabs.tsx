import { Compass, LayoutGrid } from 'lucide-react'
import { SectionTabs } from '../layout/SectionTabs'

const TABS = [
  { to: '/mods', label: 'Library', icon: LayoutGrid, hint: 'The supported projects', exact: true },
  { to: '/mods/tours', label: 'Mod Tours', icon: Compass, hint: 'What each project adds' }
]

/** The Mods page's sections, beside its title: the library and the projects' tours. Fix-it is on each mod's own page. */
export function ModsTabs() {
  return <SectionTabs label="Mods" tabs={TABS} />
}
