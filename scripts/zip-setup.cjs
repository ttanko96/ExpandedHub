// Packs dist/ExpandedHub-Setup-<version>.exe into dist/ExpandedHub-Setup-<version>.zip
// (run by `npm run dist` after electron-builder). The .exe stays too: the hub's
// self-updater downloads it straight from the GitHub release.
const { execFileSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const { version } = require('../package.json')
const dist = join(__dirname, '..', 'dist')
const exe = join(dist, `ExpandedHub-Setup-${version}.exe`)
const zip = join(dist, `ExpandedHub-Setup-${version}.zip`)

if (!existsSync(exe)) {
  console.error(`zip-setup: ${exe} not found; run electron-builder first.`)
  process.exit(1)
}
rmSync(zip, { force: true })
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:ZIP_SRC -DestinationPath $env:ZIP_DST'],
  { stdio: 'inherit', env: { ...process.env, ZIP_SRC: exe, ZIP_DST: zip } }
)
console.log(`zip-setup: ${zip}`)
