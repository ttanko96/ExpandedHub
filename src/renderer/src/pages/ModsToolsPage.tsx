import { FixIt } from '../dojo/FixIt'
import { Tours } from '../dojo/Tours'

/** The Mods page's other sections, under its header (ModsLayout): the projects' tours and the troubleshooter. */
export function ModsToolsPage({ section }: { section: 'tours' | 'fix-it' }) {
  return <div className="mt-7">{section === 'tours' ? <Tours /> : <FixIt />}</div>
}
