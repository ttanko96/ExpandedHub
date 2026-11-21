# ExpandedHub

Desktop mod manager, updater and knowledge hub for curated Tekken 3 community projects.
Electron + React + TypeScript + Tailwind CSS (electron-vite).

## Installation

**Requirements:** Windows 10 or 11 (64-bit) and an internet connection to download projects.
The hub does not ship any game data: projects that need Tekken 3 use your own disc image or ROM set.

### Installer (recommended)

1. Open the [latest release](https://github.com/ttanko96/ExpandedHub/releases/latest).
2. Download `ExpandedHub-Setup-<version>.exe` from the **Assets** list.
3. Run it, choose the install folder (installs for the current user, no administrator rights
   needed) and finish the setup. A desktop and Start menu shortcut is created.
4. Start **ExpandedHub**. On first run it asks where your own game files (disc images, ROM sets)
   are and checks them against known good dumps. You can skip this and set them later in
   **Settings → ISO Management**. The hub never downloads games or uploads your files.

The installed copy updates itself: when a new release is out, the top bar shows an **Update**
button that downloads and installs it, then restarts the hub.

### Portable zip

Download `ExpandedHub-<version>-win.zip` from the same release, unpack it anywhere and run
`ExpandedHub.exe`. The portable copy does not update itself: the **Update** button opens the
release page, and you replace the folder by hand.

### "Windows protected your PC"

The builds are not code-signed yet, so Windows SmartScreen may warn on first run. Click
**More info → Run anyway**. Only do this for files downloaded from this repository's releases page.

### Where your data goes

| What | Location |
| --- | --- |
| Downloads, installed projects, build tools | `Documents\ExpandedHub` (changeable in Settings) |
| Settings, installed-version list, cache | `%APPDATA%\ExpandedHub` |
| Logs | `%APPDATA%\ExpandedHub\logs` (Settings → Advanced → Open logs folder) |

### Uninstalling

Uninstall projects from inside the hub first if you want their files removed, then remove
**ExpandedHub** in Windows **Settings → Apps → Installed apps**. Your `Documents\ExpandedHub`
folder is kept; delete it by hand if you no longer need it.

## Building from source

```bash
npm install
npm run dev        # development with hot reload
npm test           # unit tests (vitest)
npm run build      # typecheck + tests + production bundle in out/
npm run preview    # run the production bundle
npm run dist       # Windows installer + zip in dist/ (electron-builder)
npm run icon       # re-render resources/icon.png from the logo
```

The packaged app reads `registry/` from its `resources` folder, so curating
projects after release means shipping new JSON files, not new code. Builds are not
code-signed yet: Windows SmartScreen will warn until a signing certificate is configured.

If `electron-builder` fails on Windows with "Cannot create symbolic link" while extracting
`winCodeSign`, extract that archive once by hand into
`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` (the macOS symlinks
inside it are not needed), or enable Windows Developer Mode.

Logs: `<userData>/logs/main.log` (app) and one log per operation; Settings → Advanced →
Open logs folder.

## Hub updates

The top bar shows the hub's own version status (`src/main/services/hub-updater.ts`): on start
and every 6 hours it reads the latest release of `HUB_REPOSITORY` (`src/shared/types.ts`,
currently `ttanko96/ExpandedHub`). No newer release → "Up to date ✓"; a newer one → a toast and
an **Update** button. A copy installed by the NSIS setup downloads the release's
`ExpandedHub-Setup-<version>.exe`, runs it silently (`/S --updated --force-run`) and restarts;
dev builds and unpacked zips open the release page instead. To ship a version: bump
`version` in `package.json`, `npm run dist`, and publish a GitHub release tagged `v<version>`
with the setup `.exe` attached.

## Layout

```
registry/                 curated project registry (data, not code)
  games.json              source games (ISOs / ROMs) projects can require
  projects/*.json         one file per supported project; files starting with _ are ignored
src/shared/               code shared by main and renderer
  registry-schema.ts      zod schema of the registry (projects, labels, install steps)
  types.ts, status.ts     release / status types, version comparison
  ipc.ts                  typed renderer <-> main API (channel names + HubApi)
src/main/                 Electron main process (all I/O and long-running work)
  services/               settings, registry, installed versions, update checker
  services/releases/      ReleaseProvider interface + mock provider (GitHub in phase 2)
  ipc/register.ts         IPC handlers, external-link allowlist
src/preload/              contextBridge exposing window.hub
src/renderer/src/         React UI (pages, components, zustand stores)
```

## Adding a project

Drop a new `registry/projects/<id>.json` that matches `src/shared/registry-schema.ts`
(copy an existing file as a starting point), then Settings → Advanced → Reload registry.
Labels choose their color from `kind`: `game` (purple), `platform` (yellow),
`optional` / `info` (grey). Invalid files are skipped and listed on the Mods page.
A project run by a program the user has (e.g. Godot for `tekken3-remake`) lists it in
`install.tools` (with `pick` so it can be browsed to), runs it from steps with `base: "tool"`
and plays through `output.launch`.
Optional parts a project makes later on request (DriftEngine's remaster, which its own docs start
with `npm run remaster`) go in `install.extras`: each has its own `tools` (the hub downloads those with
`provision`), `run` / `pythonVenv` steps run in the installation like a build, and `done` globs that
show it has been made. They appear under Extras on the project's page once it is installed.

## Existing installations

A project the user already has (cloned by hand, installed by an older hub, unpacked from a
release) is linked with **Already installed? Browse…** on its Mods card or page
(`src/main/services/install/adopt-service.ts`). The folder must hold one of the project's
marker files (`install.detect.markers`, default: its executable, `locateOutput` patterns and
the scripts its steps run). The version is read, in order, from the hub's `.expandedhub.json`
(written into every folder the hub installs), the registry's `install.detect.version` files
(regex, first group), the folder's own git checkout (newest tag reachable from HEAD, or the
commit for projects without releases), else it is unknown and the latest release is offered
as an update. Add-ons already inside a linked host are linked too. From then on Play, Build
and Update work in that folder; Uninstall only forgets it, never deletes it. Check for updates
re-reads linked folders until the hub has installed into them.

## Status

- Phase 1 (foundation + Mods interface) — done.
- Phase 2 (GitHub integration) — done. Releases are read from the GitHub REST API
  (`src/main/services/releases/github-release-provider.ts`): one release-list request per
  repository, prerelease and tag filtering from the registry, latest-commit fallback when a
  repository has no releases, ETag caching, rate-limit tracking, and an optional token stored
  encrypted with Electron `safeStorage`. Settings → Advanced → Demo mode switches to bundled
  sample data for offline UI work.
- Phase 3 (download manager) — done. `src/main/services/downloads/`: a queue (2 parallel)
  that downloads the release file picked by the registry's `assetPattern` (or the source
  archive), resumes with HTTP range requests after pause or app restart, verifies SHA-256
  when the release ships a checksum list, and extracts zips with zip-slip protection.
  Files land in `<downloads>/<project>/<tag>/`; every operation has a log in
  `<userData>/logs/`. The Downloads page shows progress, speed, ETA and steps, with
  pause / resume / cancel / retry.
- Phase 4 (installation engine) — done. `src/main/services/install/`:
  - game files (`sources-service.ts`): the user's own discs and ROM sets, assigned once and
    reused by every project; checked against `games.json` hashes (zip members for MAME sets,
    track 1 for `.cue` sheets). Never copied or uploaded.
  - preflight (`planner.ts`): missing files, tools (`detect` commands), dependencies and
    the scripts that will run, shown in the install dialog before anything starts.
  - install: copy over the install folder (updates keep user data), run the project's own
    scripts only with consent given in the dialog (`run-script.ts`: no shell beyond
    `cmd /c` for batch files, cancel kills the process tree), locate the executable,
    record the installed version. Add-ons install into their host via `installInto`.
  - Play and Uninstall (`lifecycle.ts`).
- Phase 5 (Lore database) — postponed to a later release; not part of this one.
- Phase 6 (polish and distribution) — done: unit tests for versions, release selection,
  download resolution, checksums, zip extraction (zip-slip, symlinks), script running and
  cancelling; error boundary and app log; renderer crash recovery; window size/position
  remembered; start-with-system and debug mode wired up; secondary pages lazy-loaded;
  app icon; electron-builder packaging (NSIS installer + zip).

## License

ExpandedHub's own code is under the [MIT License](LICENSE). Tekken is a trademark of Bandai Namco
Entertainment; the license does not cover it, nor the mods the hub installs, which keep their own licenses.
