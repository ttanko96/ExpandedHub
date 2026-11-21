// Renders the ExpandedHub logo mark (red E, white H on black) to resources/icon.png (512×512) with Electron.
// Run: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')
const font = pathToFileURL(join(root, 'node_modules/@fontsource/rajdhani/files/rajdhani-latin-700-normal.woff2')).href

const html = `<!doctype html><html><head><style>
@font-face { font-family: R; src: url('${font}') format('woff2'); font-weight: 700; }
html, body { margin: 0; width: 512px; height: 512px; background: transparent; overflow: hidden; }
.tile { position: absolute; inset: 24px; border-radius: 104px; overflow: hidden;
  background: radial-gradient(120% 90% at 25% 15%, #2a2a30 0%, #151518 50%, #070708 100%);
  box-shadow: inset 0 0 0 6px rgba(255,255,255,0.06); }
.slash { position: absolute; right: -60px; top: -40px; width: 110px; height: 600px; transform: rotate(20deg); background: #d81e34; opacity: .95; }
.slash2 { position: absolute; right: 70px; top: -40px; width: 16px; height: 600px; transform: rotate(20deg); background: #d81e34; opacity: .6; }
.t { position: absolute; left: 40px; bottom: 96px; font: italic 700 270px/1 R, 'Segoe UI', sans-serif; letter-spacing: -10px;
  text-shadow: 0 10px 30px rgba(0,0,0,.5); }
.e { color: #ef2b42; text-shadow: 0 0 28px rgba(216,30,52,.45), 0 10px 30px rgba(0,0,0,.5); }
.h { color: #fff; }
</style></head><body><div class="tile"><div class="slash"></div><div class="slash2"></div><div class="t"><span class="e">E</span><span class="h">H</span></div></div></body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  mkdirSync(join(root, 'resources'), { recursive: true })
  writeFileSync(join(root, 'resources/icon.png'), image.resize({ width: 512, height: 512 }).toPNG())
  console.log('wrote resources/icon.png')
  app.quit()
})
