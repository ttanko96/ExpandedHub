# ExpandedHub

Desktop mod manager and updater for curated Tekken 3 community projects. It downloads,
installs, updates and launches the projects for you, and keeps the hub itself up to date.

## Installation

**Requirements:** Windows 10 or 11 (64-bit) and an internet connection. ExpandedHub runs only
on Windows for now; macOS and Linux are not supported yet.
The hub does not ship any game data: projects that need Tekken 3 use your own disc image or ROM set.

1. Open the [latest release](https://github.com/ttanko96/ExpandedHub/releases/latest) and
   download `ExpandedHub-Setup-<version>.zip` from the **Assets** list.
2. Unzip it and run `ExpandedHub-Setup-<version>.exe`.
3. Choose the install folder and finish the setup. It installs for the current user, so no
   administrator rights are needed, and it creates desktop and Start menu shortcuts.
4. Start **ExpandedHub**. On first run it asks where your own game files are. You can skip
   this and set them later in **Settings → ISO Management**.

**"Windows protected your PC":** the builds are not code-signed yet, so SmartScreen may warn
on first run. Click **More info → Run anyway**. Only do this for files from this repository's
releases page.

**Updates:** when a new version is out, the top bar shows an **Update** button. It downloads
and installs the new version, then restarts the hub.

**Uninstalling:** remove **ExpandedHub** in Windows **Settings → Apps → Installed apps**.
Your downloads and installed projects in `Documents\ExpandedHub` are kept; delete that folder
by hand if you no longer need it.

| What | Location |
| --- | --- |
| Downloads, installed projects, build tools | `Documents\ExpandedHub` (changeable in Settings) |
| Settings and cache | `%APPDATA%\ExpandedHub` |
| Logs | `%APPDATA%\ExpandedHub\logs` (Settings → Advanced → Open logs folder) |

## Building from source

Electron + React + TypeScript + Tailwind CSS (electron-vite). Requires Node.js 22.

```bash
npm install
npm run dev        # development with hot reload
npm test           # unit tests (vitest)
npm run build      # typecheck + tests + production bundle in out/
npm run dist       # setup .exe and setup .zip in dist/ (electron-builder)
```

If `npm run dist` fails with "Cannot create symbolic link" while extracting `winCodeSign`,
run it once from an administrator terminal or enable Windows Developer Mode.

**Releasing:** bump `version` in `package.json`, run `npm run dist`, and publish a GitHub
release tagged `v<version>` with `ExpandedHub-Setup-<version>.exe`, its `.blockmap` and
`ExpandedHub-Setup-<version>.zip` attached. The hub's self-updater downloads the `.exe` from the
latest release of `ttanko96/ExpandedHub`, so it must be attached as is.

## Adding a project

Projects are data, not code: each one is a JSON file in `registry/projects/` that matches
`src/shared/registry-schema.ts` (copy an existing file to start). Files starting with `_` are
skipped and left out of the build, which is how a project is held back from a release.
In a dev build, Settings → Advanced → Reload registry picks up changes.

## License

ExpandedHub's own code is under the [MIT License](LICENSE). Tekken is a trademark of Bandai Namco
Entertainment; the license does not cover it, nor the mods the hub installs, which keep their own licenses.
