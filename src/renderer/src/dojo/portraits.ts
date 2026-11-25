import { useEffect, useState } from 'react'
import type { DojoPortraits } from '@shared/types'
import { useHub } from '../store/hub-store'

let cached: DojoPortraits | null = null

/**
 * The fighter portraits from the player's own Tekken 3 Expanded, when the switch in Settings → Dojo
 * is on. Asked again when the switch or the installed projects change; null until the first answer.
 */
export function usePortraits(): DojoPortraits | null {
  const on = useHub((s) => s.settings?.dojo.portraits)
  const expanded = useHub((s) => s.states['tekken3-expanded']?.installed?.installPath ?? null)
  const [value, setValue] = useState<DojoPortraits | null>(cached)
  useEffect(() => {
    let live = true
    window.hub.dojo
      .portraits()
      .then((p) => {
        cached = p
        if (live) setValue(p)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [on, expanded])
  return value
}

/** One fighter's portrait URL, or undefined. */
export function usePortrait(fighterId: string): string | undefined {
  return usePortraits()?.portraits[fighterId]
}
