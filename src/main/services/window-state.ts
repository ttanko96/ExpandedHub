import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

const file = () => join(paths.userData(), 'window.json')

/** Last window size/position, ignored when it no longer fits on any display. */
export function loadWindowState(): WindowState | null {
  try {
    const s = JSON.parse(readFileSync(file(), 'utf8')) as WindowState
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return s.bounds.x < a.x + a.width - 100 && s.bounds.x + s.bounds.width > a.x + 100 && s.bounds.y >= a.y - 20 && s.bounds.y < a.y + a.height - 100
    })
    return visible ? s : null
  } catch {
    return null
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return
    const state: WindowState = { bounds: win.isMaximized() ? win.getNormalBounds() : win.getBounds(), maximized: win.isMaximized() }
    try {
      writeFileSync(file(), JSON.stringify(state))
    } catch {
      /* not important enough to fail on */
    }
  }
  const later = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('close', save)
}
