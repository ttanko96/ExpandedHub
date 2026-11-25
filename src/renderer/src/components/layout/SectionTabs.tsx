import type { LucideIcon } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Segmented } from '../ui/Segmented'

export interface SectionTab {
  to: string
  label: string
  icon: LucideIcon
  hint?: string
  /** Other paths that belong to this tab (a fighter's page under Roster). */
  also?: string[]
  /** Active only on exactly `to`, not below it (the Mods library, whose project pages are not a tab). */
  exact?: boolean
}

/**
 * A page's sub-sections as tabs: the same sliding highlight as the other choices in the hub
 * (Segmented), each tab a route.
 */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const matches = (t: SectionTab) =>
    [t.to, ...(t.also ?? [])].some((p) => pathname === p || (!t.exact && pathname.startsWith(`${p}/`)))
  const active = tabs.find(matches) ?? tabs[0]!
  return (
    <Segmented
      label={label}
      value={active.to}
      onChange={(to) => {
        if (to !== active.to || pathname !== to) navigate(to)
      }}
      options={tabs.map((t) => ({
        id: t.to,
        title: t.hint,
        label: (
          <>
            <t.icon size={15} className={t.to === active.to ? 'text-tekken-500' : ''} />
            {t.label}
          </>
        )
      }))}
    />
  )
}
