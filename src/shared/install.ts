/** Types for game files, tool detection and the pre-installation checklist. */

export type SourceVerdict =
  | 'verified' // content matches a known good hash
  | 'unverified' // accepted, but no known hash to compare with
  | 'mismatch' // readable, but not the version the projects expect
  | 'missing' // file no longer exists
  | 'invalid' // wrong file type or unreadable

export interface SourceValidation {
  verdict: SourceVerdict
  message: string
  /** Label of the matched known hash, when verified. */
  matched?: string
  checkedAt: string
}

/** A release offered under Other versions on the project page. */
export interface ReleaseChoice {
  version: string
  tag: string
  name: string
  publishedAt: string
  prerelease: boolean
  /** The newest release. */
  latest: boolean
  /** The version installed now. */
  installed: boolean
  /** Its package is in the downloads folder already, so installing it needs no download. */
  downloaded: boolean
  /** Download size in bytes; 0 when unknown (source archives). */
  size: number
  /** Why it cannot be installed here (no package for this system); null when it can. */
  problem: string | null
}

/** A game file the user assigned to a game from `registry/games.json`. */
export interface SourceConfig {
  gameId: string
  path: string
  size: number
  validation: SourceValidation | null
  /** True while the file is being checked (not persisted). */
  validating?: boolean
}

export interface ToolStatus {
  id: string
  name: string
  optional: boolean
  found: boolean | null // null: cannot be detected automatically
  version: string | null
  url?: string
  /** Set when the user can browse to the tool instead of it being detected. */
  pick?: { kind: 'folder' | 'file'; hint?: string }
  /** The folder or file the user chose. */
  path?: string | null
  /** Why the chosen path does not work, when it does not. */
  problem?: string | null
}

export interface PreflightSource {
  gameId: string
  name: string
  platform: string
  required: boolean
  purpose?: string
  config: SourceConfig | null
}

export interface PreflightScript {
  label: string
  /** File that will run, relative to the install directory. */
  command: string
  args: string[]
  /** How the script reports progress (see the registry `run` step). */
  progress: 'none' | 'json-events' | 'patterns'
  /**
   * `venv`: the hub makes a Python environment and installs pinned packages with pip.
   * `program`: `command` is a program installed on the machine (e.g. `npm`), run in the install folder.
   */
  kind: 'run' | 'venv' | 'program'
  /** Index of the registry step this comes from. */
  step: number
  /** Folder the command runs from; null until it is known (dependency not installed). */
  base: string | null
  /** A step of the host project's build (an add-on's `buildHost`): `step` indexes the host's steps. */
  host: boolean
  /** Game files handed over as folders (`${sourceFolder:…}`): the configured file, and the folder the step sees. */
  folders?: { gameId: string; file: string; folder: string }[]
  /** An optional part: when it fails, the installation goes on without it. */
  optional?: boolean
}

/** Everything the user should see before an installation starts. */
export interface Preflight {
  projectId: string
  version: string | null
  installPath: string | null
  sources: PreflightSource[]
  tools: ToolStatus[]
  /** Missing tools the hub downloads first, as their own operations, before installing. */
  provisions: { toolId: string; name: string; version: string; size: number }[]
  dependencies: { id: string; name: string; installed: boolean }[]
  scripts: PreflightScript[]
  /** Only the build runs, in the existing installation (no download). */
  buildOnly: boolean
  /** Set when this makes one of the project's extras instead of its build. */
  extra: { id: string; name: string; description: string; needs: string[] } | null
  download: { file: string | null; size: number; problem: string | null }
  /** Reasons the installation cannot start. Empty when ready. */
  blockers: string[]
  /** Things that work but deserve attention (optional files missing, unverified files…). */
  warnings: string[]
}

/** Whether one of an installed project's extras has been made. */
export interface ExtraStatus {
  id: string
  done: boolean
}

/** One of a project's screenshots (`install.screenshots`), as a `expandedhub-media://` URL. */
export interface Screenshot {
  name: string
  url: string
}

/** Disk usage of a project, shown before uninstalling. */
export interface ProjectStorage {
  /** The installed mod; null when it is not installed. `removable` is false for folders the hub did not create. */
  install: { path: string; bytes: number; removable: boolean } | null
  /** Downloaded packages and their extracted copies. */
  downloads: { path: string; bytes: number }
  /** Installed projects this one depends on, which the uninstall dialog can remove too or keep. */
  dependencies: DependencyStorage[]
  /** Tools the hub installed for this project (Godot, FFmpeg…), which can be removed too or kept. Tools you installed yourself are never listed. */
  tools: ToolStorage[]
}

/** A tool the hub downloaded and set up, in `<installs>/_tools`. */
export interface ToolStorage {
  id: string
  name: string
  install: { path: string; bytes: number }
  downloads: { path: string; bytes: number }
  /** Other installed projects that also use it; while any of them stays installed it cannot be removed. */
  neededBy: { id: string; name: string }[]
}

/** An installed dependency of a project being uninstalled. */
export interface DependencyStorage {
  id: string
  name: string
  install: { path: string; bytes: number; removable: boolean }
  downloads: { path: string; bytes: number }
  /** Other installed projects that also need it; while there are any it cannot be removed. */
  neededBy: string[]
}

export interface UninstallOptions {
  /** Remove the installed mod (default true). */
  files?: boolean
  /** Remove the downloaded packages (the removed dependencies' too). */
  downloads?: boolean
  /** Dependencies (project ids from `dependsOn`) to uninstall as well; the rest are kept. Needs `files`. */
  dependencies?: string[]
  /** Hub-installed tools (tool ids) to remove as well; the rest are kept. Needs `files`. */
  tools?: string[]
}

export interface UninstallResult {
  removedFiles: boolean
  removedDownloads: boolean
  /** Names of the dependencies that were uninstalled too. */
  removedDependencies: string[]
  /** Names of the tools that were removed too. */
  removedTools: string[]
}
