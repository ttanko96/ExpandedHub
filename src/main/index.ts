import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAllowedExternalUrl, registerIpc } from './ipc/register'
import { createServices } from './services'
import { log, setDebug } from './services/logger'
import { loadWindowState, trackWindowState } from './services/window-state'

const startedAt = Date.now()
app.setName('ExpandedHub')
if (process.platform === 'win32') app.setAppUserModelId('com.expandedhub.app')

process.on('uncaughtException', (err) => log('error', 'Uncaught exception', err))
process.on('unhandledRejection', (reason) => log('error', 'Unhandled promise rejection', reason))

// Local media (project screenshots) served without exposing file paths to the page.
protocol.registerSchemesAsPrivileged([{ scheme: 'expandedhub-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const services = createServices()
let debugMode = false

/** Window background and native window-control colours per theme (matching --color-ink-900). */
const WINDOW_THEME = {
  dark: { color: '#0b0b0d', symbolColor: '#a1a1aa' },
  light: { color: '#f3f3f6', symbolColor: '#52525b' }
} as const
let theme: keyof typeof WINDOW_THEME = 'dark'

function createWindow(): BrowserWindow {
  const saved = loadWindowState()
  const win = new BrowserWindow({
    width: saved?.bounds.width ?? 1360,
    height: saved?.bounds.height ?? 860,
    x: saved?.bounds.x,
    y: saved?.bounds.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: WINDOW_THEME[theme].color,
    title: 'ExpandedHub',
    icon: join(__dirname, '../../resources/icon.png'),
    titleBarStyle: 'hidden',
    // Native window controls drawn over our own top bar (Windows / Linux).
    titleBarOverlay: { ...WINDOW_THEME[theme], height: 56 },
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  if (saved?.maximized) win.maximize()
  trackWindowState(win)

  win.once('ready-to-show', () => {
    win.show()
    log('info', `Window shown ${Date.now() - startedAt} ms after start`)
  })

  // Never open new Electron windows; send allowed links to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  // Developer tools only in debug mode (Settings → Advanced) or development.
  win.webContents.on('before-input-event', (_e, input) => {
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')
    if (input.type === 'keyDown' && devtools && (debugMode || !app.isPackaged)) win.webContents.toggleDevTools()
  })

  // A crashed renderer is reloaded instead of leaving a blank window.
  win.webContents.on('render-process-gone', (_e, details) => {
    log('error', `Renderer gone: ${details.reason} (exit ${details.exitCode})`)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) setTimeout(() => win.webContents.reload(), 500)
  })
  win.on('unresponsive', () => log('warn', 'Window became unresponsive'))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** Apply settings that live outside the page: login item, debug logging, window colours. */
async function applySystemSettings(): Promise<void> {
  const s = await services.settings.get()
  theme = s.general.theme === 'light' ? 'light' : 'dark'
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(WINDOW_THEME[theme].color)
    if (process.platform !== 'darwin') win.setTitleBarOverlay({ ...WINDOW_THEME[theme], height: 56 })
  }
  debugMode = s.advanced.debug
  setDebug(debugMode)
  // Only the installed app registers itself; a dev build would register the bare Electron binary.
  if (app.isPackaged && process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: s.general.launchOnStartup })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    log('info', `ExpandedHub ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform})`)
    protocol.handle('expandedhub-media', async (req) => {
      const u = new URL(req.url)
      if (u.hostname === 'screenshot') {
        const [project, name] = u.pathname.replace(/^\//, '').split('/').map((s) => { try { return decodeURIComponent(s) } catch { return '' } })
        const shot = project && name ? await services.gallery.path(project, name) : null
        return shot ? net.fetch(pathToFileURL(shot).toString()) : new Response('Not found', { status: 404 })
      }
      if (u.hostname === 'portrait') {
        let name = ''
        try {
          name = decodeURIComponent(u.pathname.replace(/^\//, ''))
        } catch {
          /* a malformed name is not found */
        }
        const file = name ? await services.portraits.path(name) : null
        return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 })
      }
      return new Response('Not found', { status: 404 })
    })
    await applySystemSettings()
    services.settings.onChange(() => void applySystemSettings())
    await services.operations.init()
    registerIpc(services)
    createWindow()
    await services.updates.start()
    services.hubUpdater.start()
    // Restarted on a newer version (the top bar's update): What's new shows its release notes.
    void services.changelog.hubStarted()
    void services.adopt.rescan()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Game servers Play started (browser games) end with the hub, never left running behind it.
  app.on('will-quit', () => services.lifecycle.stopAll())

  app.on('window-all-closed', () => {
    services.updates.stop()
    services.hubUpdater.stop()
    if (process.platform !== 'darwin') app.quit()
  })
}
