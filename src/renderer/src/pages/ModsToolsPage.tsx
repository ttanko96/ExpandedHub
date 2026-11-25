import { Tours } from '../dojo/Tours'

/** The Mods page's other section, under its header (ModsLayout): the projects' tours. Fix-it is on each mod's own page. */
export function ModsToolsPage({ section }: { section: 'tours' }) {
  return <div className="mt-7">{section === 'tours' && <Tours />}</div>
}
