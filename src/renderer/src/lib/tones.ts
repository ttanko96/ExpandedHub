/** Each top-level page's colour: the backdrop's glow and the top bar's active tab. */
export type Tone = 'mods' | 'dojo' | 'downloads' | 'settings'

/** As "r, g, b", for rgba(). */
export const TONES: Record<Tone, string> = {
  mods: '216, 30, 52',
  dojo: '37, 99, 235',
  downloads: '16, 185, 129',
  settings: '139, 92, 246'
}

export function toneFor(path: string): Tone {
  if (path.startsWith('/dojo')) return 'dojo'
  if (path.startsWith('/downloads')) return 'downloads'
  if (path.startsWith('/settings')) return 'settings'
  return 'mods'
}
