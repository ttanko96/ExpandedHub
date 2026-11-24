/**
 * Project registry schema.
 *
 * Every supported project is described by one JSON file in `registry/projects/`.
 * Adding a new mod to the hub means adding a file here — no UI or core code changes.
 * The schema is validated in the main process with zod; invalid files are skipped
 * and reported instead of crashing the app.
 */
import { z } from 'zod'

/** Visual category of a compatibility label. Colors are derived from this, never from the text. */
export const LabelKind = z.enum([
  'game', // purple — required / source games
  'platform', // yellow — required emulators, platforms, tools
  'optional', // grey — optional requirements
  'info' // grey — general information
])
export type LabelKind = z.infer<typeof LabelKind>

export const CompatibilityLabel = z.object({
  text: z.string().min(1),
  kind: LabelKind,
  /** Optional tooltip text shown on hover. */
  hint: z.string().optional()
})
export type CompatibilityLabel = z.infer<typeof CompatibilityLabel>

export const OsPlatform = z.enum(['win32', 'darwin', 'linux'])
export type OsPlatform = z.infer<typeof OsPlatform>

/** A source game file the user has to provide (ISO, ROM set, disc image…). Refers to `registry/games.json`. */
export const SourceRequirement = z.object({
  gameId: z.string().min(1),
  required: z.boolean().default(true),
  /** What this source is used for, shown in the requirements checklist. */
  purpose: z.string().optional(),
  /**
   * The only dump revisions this project reads (`revision` of the game's known hashes).
   * Unset: any verified dump. A verified dump of another revision is shown as not working with it.
   */
  revisions: z.array(z.string().min(1)).optional()
})
export type SourceRequirement = z.infer<typeof SourceRequirement>

/** A tool's zip for one OS, pinned by its hash (SHA-512 or SHA-256, hex). */
export const ToolDownload = z
  .object({
    url: z.string().url().startsWith('https://'),
    sha512: z.string().regex(/^[a-fA-F0-9]{128}$/).optional(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    /** Size in bytes, for the install dialog; 0 when unknown. */
    size: z.number().int().min(0).default(0),
    /** The tool's program inside the zip, e.g. `Godot_v4.7-stable_win64.exe`. */
    executable: z.string().min(1).refine((p) => !p.split(/[\\/]/).includes('..') && !/^([a-zA-Z]:|[\\/])/.test(p), 'a path inside the zip')
  })
  .refine((d) => d.sha512 || d.sha256, { message: 'sha512 or sha256 is required' })
export type ToolDownload = z.infer<typeof ToolDownload>

/** A tool that must exist on the machine (or be provisioned by the hub) before building. */
export const ToolRequirement = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Command used to detect the tool, e.g. `cmake --version`. */
  detect: z.string().optional(),
  /** Oldest version that works, compared with the version `detect` prints, e.g. `22.6`. */
  minVersion: z
    .string()
    .regex(/^\d+(\.\d+){0,2}$/)
    .optional(),
  platforms: z.array(OsPlatform).optional(),
  optional: z.boolean().default(false),
  url: z.string().url().optional(),
  /**
   * The user can browse to the tool (a portable program, for example) instead
   * of it being detected. The chosen path is checked for one of `markers`
   * (file names inside the folder, or the file's own name) and handed to
   * scripts as `${tool:<id>}`.
   */
  pick: z
    .object({
      kind: z.enum(['folder', 'file']),
      markers: z.array(z.string()).default([]),
      /** What to choose, shown beside the Browse button. */
      hint: z.string().optional()
    })
    .optional(),
  /**
   * The hub can install the tool itself (needs `pick`): when it is missing,
   * Install first queues its download on the Downloads page (a zip, checked
   * against the pinned hash and unpacked into `<installs>/_tools/<id>-<version>`),
   * then the project's own installation starts by itself. `executable` is the
   * file inside the zip that becomes the tool's chosen path.
   */
  provision: z
    .object({
      version: z.string().min(1),
      win32: ToolDownload.optional(),
      darwin: ToolDownload.optional(),
      linux: ToolDownload.optional()
    })
    .optional()
}).refine((t) => !t.provision || t.pick, { message: 'A tool the hub installs (provision) needs pick', path: ['provision'] })
export type ToolRequirement = z.infer<typeof ToolRequirement>

/** Per-OS string, e.g. an asset name pattern or an executable path. */
const PerPlatform = z.object({
  win32: z.string().optional(),
  darwin: z.string().optional(),
  linux: z.string().optional()
})

/** A run-step argument: a plain string, or a group added only when its game files are (not) configured. */
export const RunArg = z.union([
  z.string(),
  z.object({
    when: z.array(z.string()).default([]),
    unless: z.array(z.string()).default([]),
    args: z.array(z.string()).min(1)
  })
])
export type RunArg = z.infer<typeof RunArg>

/** A script output line turned into the operation's status. `$1`… are the regex groups. */
export const ProgressPattern = z.object({
  match: z.string().min(1),
  message: z.string().optional(),
  detail: z.string().optional(),
  /** How far the step is, 0–100, e.g. `$1` from `[ 37% ]`; moves the progress bar. */
  percent: z.string().optional(),
  /** Keep the line in the operation log (false for noisy lines such as Ninja's). */
  log: z.boolean().default(true)
})
export type ProgressPattern = z.infer<typeof ProgressPattern>

/**
 * Installation steps. The installation engine (phase 4) executes these in order.
 * New step types can be added to this union without touching existing projects.
 */
export const InstallStep = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('download'),
    /** `source` = release source archive (zipball), `asset` = a release asset matched by pattern. */
    from: z.enum(['source', 'asset']),
    /** Case-insensitive regex matched against asset names, per OS. Required when `from` is `asset`. */
    assetPattern: PerPlatform.optional(),
    /** Case-insensitive regex of a checksum file in the same release (e.g. `SHA256SUMS`), used to verify the download. */
    checksumAsset: z.string().optional()
  }),
  z.object({ type: z.literal('extract'), stripRoot: z.boolean().default(true) }),
  z.object({ type: z.literal('checkTools') }),
  z.object({ type: z.literal('checkSources') }),
  z.object({
    type: z.literal('run'),
    label: z.string(),
    /** Command per OS, relative to the install directory (a file shipped by the project). */
    command: PerPlatform,
    /**
     * Arguments. Placeholders: `${installDir}`, and `${source:<gameId>}` for a
     * configured game file, `${sourceFolder:<gameId>}` for a folder holding its
     * files (a zip is unpacked into a temporary folder for the step and removed
     * after it; any other file stands for its own folder), `${tool:<id>}` for a
     * tool the user browsed to (the argument is dropped when it is not set). A group `{ when, unless, args }`
     * is added as a whole: only when every entry of `when` is configured and not
     * every entry of `unless` is (entries are game ids, or `tool:<id>`).
     */
    args: z.array(RunArg).default([]),
    /**
     * Where `command` is found: the project's own folder, (add-ons) the host
     * project's installation, e.g. the host's Python environment, or `path`: a
     * program installed on the machine and found on the search path, such as
     * `npm` or `node` (a bare name; it runs in the install folder), or `tool`:
     * `command` is the id of one of the project's `tools` (Godot, say), the
     * program the user browsed to, else the one its `detect` command finds on
     * the search path; it runs in the install folder.
     */
    base: z.enum(['install', 'host', 'path', 'tool']).default('install'),
    /** Extra environment variables for the command, e.g. `NODE_OPTIONS`. */
    env: z.record(z.string()).default({}),
    /**
     * An optional part (e.g. arcade content): when the command fails, the
     * installation goes on without it and the operation shows `optionalNote`
     * (or a generic warning) with the command's last lines.
     */
    optional: z.boolean().default(false),
    optionalNote: z.string().optional(),
    /** Run the step only when all of these game files (or `tool:<id>`) are configured. */
    when: z.array(z.string()).default([]),
    /**
     * How the script reports progress. `json-events`: one JSON object per line,
     * `{ "event": "status" | "error" | "complete", "message"?, "detail"? }`.
     * Or `{ "patterns": [...] }`: output lines matched by regular expressions.
     */
    progress: z.union([z.enum(['none', 'json-events']), z.object({ patterns: z.array(ProgressPattern).min(1) })]).default('none'),
    /** Scripts from repositories are never executed without explicit user consent. */
    requiresConsent: z.literal(true).default(true),
    /** Pass configured source file paths to the script as environment variables. */
    passSourcesAsEnv: z.boolean().default(false)
  }),
  z.object({
    type: z.literal('locateOutput'),
    /** Glob patterns, relative to the install directory, that identify the built output. */
    patterns: z.array(z.string()).min(1),
    /** When false, a missing output is only a warning (e.g. a setup window finishes the build later). */
    required: z.boolean().default(false)
  }),
  z.object({
    type: z.literal('pythonVenv'),
    /** The environment's folder, relative to the install directory. */
    path: z.string().min(1),
    /** Python versions to try, in order of preference (`py -<version>` on Windows). */
    versions: z.array(z.string()).min(1),
    /** Supported range, inclusive, e.g. `3.10` – `3.15`. An environment made with another version is made again. */
    minVersion: z.string().regex(/^\d+\.\d+$/),
    maxVersion: z.string().regex(/^\d+\.\d+$/),
    /** Python code that succeeds when the packages are present, e.g. `import PIL, numpy`. */
    check: z.string().optional(),
    /** Requirement files installed in order with pip, relative to the install directory. */
    requirements: z.array(z.string()).default([]),
    /** Extra pip arguments, e.g. `--require-hashes`. */
    pipArgs: z.array(z.string()).default([]),
    /** Packages installed with pip after the requirement files, for projects without one, e.g. `numpy`. */
    packages: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*([<>=!~]=?[A-Za-z0-9.*]+)?$/, 'a package name, optionally with a version')).default([])
  }),
  /**
   * Add-ons: run the host project's own build steps in the host's installation,
   * so the host takes the add-on in and records it (e.g. Tekken 3 Expanded's
   * setup, which asks to run again whenever an add-on is added or updated).
   */
  z.object({ type: z.literal('buildHost') }),
  z.object({ type: z.literal('finalize') })
])
export type InstallStep = z.infer<typeof InstallStep>

/**
 * An optional part made after the installation, on the user's request, from
 * the project's page (e.g. DriftEngine's remaster, which its own docs start
 * with `npm run remaster`): its own tools (downloaded by the hub where they
 * say how) and its own steps, run in the installation like a build. `done`
 * names the files that show it has been made.
 */
export const ProjectExtra = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase kebab-case'),
  name: z.string().min(1),
  description: z.string().min(1),
  /** What it takes, listed before it starts (disk space, a GPU, how long). */
  needs: z.array(z.string()).default([]),
  /** Tools only this part needs; the project's required tools are checked too. */
  tools: z.array(ToolRequirement).default([]),
  /** `run` and `pythonVenv` steps, run in the install folder in order. */
  steps: z
    .array(InstallStep)
    .min(1)
    .refine((steps) => steps.every((s) => s.type === 'run' || s.type === 'pythonVenv'), 'only run and pythonVenv steps'),
  /** Glob patterns, relative to the install folder, of files that exist once it has been made. */
  done: z.array(z.string()).min(1),
  /** Shown once it has been made, e.g. where to turn it on in the game. */
  doneNote: z.string().optional()
})
export type ProjectExtra = z.infer<typeof ProjectExtra>

export const InstallStrategy = z.enum([
  'release-asset', // ready-to-use binaries from a release
  'source-build', // download source and build locally
  'script' // repository provides its own setup script
])
export type InstallStrategy = z.infer<typeof InstallStrategy>

export const InstallConfig = z.object({
  strategy: InstallStrategy,
  supportedPlatforms: z.array(OsPlatform).min(1),
  tools: z.array(ToolRequirement).default([]),
  sources: z.array(SourceRequirement).default([]),
  /** Other registry projects that must be installed first. */
  dependsOn: z.array(z.string()).default([]),
  steps: z.array(InstallStep).min(1),
  /** Optional parts made later from the project's page (see `ProjectExtra`). */
  extras: z.array(ProjectExtra).default([]),
  /**
   * Install inside another project's installation (add-ons), e.g.
   * `{ "project": "tekken3-expanded", "subdir": "addons/tmst" }`. Default: its own folder.
   */
  installInto: z.object({ project: z.string(), subdir: z.string() }).optional(),
  /**
   * Recognising an installation the user already has (Browse… on the Mods page).
   * `markers`: globs relative to the folder, one of which must exist (default:
   * the output executable, `locateOutput` patterns and the scripts the steps run).
   * `version`: files read for the installed version, in order; `pattern` is a
   * regex whose first group is the version, e.g. `TMST_VERSION "([^"]+)"`.
   * Without a match the hub tries the folder's git tags, else the version is unknown.
   */
  detect: z
    .object({
      markers: z.array(z.string().min(1)).default([]),
      version: z
        .array(
          z.object({
            file: z.string().min(1).refine((p) => !p.split(/[\\/]/).includes('..') && !/^([a-zA-Z]:|[\\/])/.test(p), 'a path inside the folder'),
            pattern: z.string().min(1)
          })
        )
        .default([])
    })
    .optional(),
  /**
   * A folder of the installation with screenshots (png, jpg, webp, gif), e.g.
   * TMST's `screenshots`: shown as a slideshow on the project's page once installed.
   */
  screenshots: z
    .object({
      folder: z.string().min(1).refine((p) => !p.split(/[\\/]/).includes('..') && !/^([a-zA-Z]:|[\\/])/.test(p), 'a folder inside the installation'),
      title: z.string().optional()
    })
    .optional(),
  /** What to launch once installed, relative to the install directory. */
  output: z
    .object({
      executable: PerPlatform.optional(),
      /**
       * Games run by one of the project's `tools` (a Godot project, say): Play
       * starts that program with `args` in the install folder.
       */
      launch: z
        .object({
          tool: z.string().min(1),
          args: z.array(z.string()).default([])
        })
        .optional(),
      /**
       * Games played in the browser: Play starts this server (a program on the
       * search path, e.g. `npm run dev`) in the background in the install folder,
       * waits until `url` answers and opens it in the default browser. While it
       * runs, the project shows Stop; quitting the hub stops it too.
       */
      serve: z
        .object({
          command: z.string().regex(/^[A-Za-z0-9._-]+$/, 'a program name found on the search path'),
          args: z.array(z.string()).default([]),
          env: z.record(z.string()).default({}),
          url: z.string().regex(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/, 'a local http:// address'),
          /** How long the first start may take before giving up, in seconds. */
          timeoutSeconds: z.number().int().min(5).max(600).default(120)
        })
        .optional()
    })
    .default({})
})
export type InstallConfig = z.infer<typeof InstallConfig>

export const RepositoryRef = z.object({
  provider: z.literal('github').default('github'),
  owner: z.string().min(1),
  name: z.string().min(1),
  /** Include prereleases when looking for the latest release. */
  includePrereleases: z.boolean().default(false),
  /** Optional regex to filter release tags (e.g. only `v*` tags). */
  tagPattern: z.string().optional(),
  /**
   * Treat exactly this release tag as the latest (e.g. to install an older
   * version and test the update to the next one). Remove it to follow the newest release again.
   */
  pinTag: z.string().optional()
})
export type RepositoryRef = z.infer<typeof RepositoryRef>

export const ProjectArtwork = z.object({
  /** Path relative to `registry/`, e.g. `artwork/tekken3-expanded.png`. */
  logo: z.string().optional(),
  banner: z.string().optional(),
  /** Accent color used for the generated tile when no logo is available. */
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#c8102e'),
  /** Short text for the generated tile, e.g. `T3E`. */
  monogram: z.string().max(4).optional()
})
export type ProjectArtwork = z.infer<typeof ProjectArtwork>

export const ProjectDefinition = z.object({
  /** Schema version of this file, for future migrations. */
  schemaVersion: z.literal(1),
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase kebab-case'),
  name: z.string().min(1),
  tagline: z.string().optional(),
  description: z.string().min(1),
  developer: z.object({
    name: z.string().min(1),
    url: z.string().url().optional()
  }),
  /** Optional only for `comingSoon` entries that have no public repository yet. */
  repository: RepositoryRef.optional(),
  homepage: z.string().url().optional(),
  labels: z.array(CompatibilityLabel).default([]),
  artwork: ProjectArtwork.default({}),
  /**
   * How the hub installs it. Omitted for projects the hub only lists for now
   * (built from source by hand, see their repository) and for `comingSoon` entries.
   */
  install: InstallConfig.optional(),
  /**
   * What the user does, in order, to get from here to playing: written for
   * players, not about what the hub runs in the background. Shown on the
   * project's page as "How to play". A step can link to another project's page
   * (an add-on's host, say) with `project`.
   */
  howToPlay: z
    .array(
      z.object({
        title: z.string().min(1),
        detail: z.string().optional(),
        project: z.string().optional()
      })
    )
    .default([]),
  /** A YouTube trailer, shown on the project's card and page. */
  trailer: z
    .object({
      /** The video id (`watch?v=<id>`). */
      youtube: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'a YouTube video id'),
      /** Where to start, in seconds. */
      start: z.number().int().min(0).default(0),
      title: z.string().optional()
    })
    .optional(),
  /** Announced, not released: no repository checks, no install, shown as "Coming soon". */
  comingSoon: z.boolean().default(false),
  /** Display order in the directory; lower comes first. */
  order: z.number().default(100),
  /** Hidden projects stay in the registry but are not shown. */
  hidden: z.boolean().default(false)
}).superRefine((p, ctx) => {
  if (!p.comingSoon && !p.repository) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['repository'], message: 'Required unless comingSoon is true' })
  }
  // Steps and launchers that run a tool must name one of the project's tools.
  const tools = new Set(p.install?.tools.map((t) => t.id) ?? [])
  const checkSteps = (steps: InstallStep[], known: Set<string>, at: (string | number)[]) =>
    steps.forEach((s, i) => {
      if (s.type !== 'run' || s.base !== 'tool') return
      for (const [os, id] of Object.entries(s.command)) {
        if (id && !known.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...at, i, 'command', os], message: `No tool "${id}" in install.tools` })
      }
    })
  checkSteps(p.install?.steps ?? [], tools, ['install', 'steps'])
  const extraIds = new Set<string>()
  p.install?.extras.forEach((x, e) => {
    if (extraIds.has(x.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['install', 'extras', e, 'id'], message: `Duplicate extra "${x.id}"` })
    extraIds.add(x.id)
    checkSteps(x.steps, new Set([...tools, ...x.tools.map((t) => t.id)]), ['install', 'extras', e, 'steps'])
  })
  const launch = p.install?.output.launch
  if (launch && !tools.has(launch.tool)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['install', 'output', 'launch', 'tool'], message: `No tool "${launch.tool}" in install.tools` })
  }
})
export type ProjectDefinition = z.infer<typeof ProjectDefinition>

/** A project with a repository to check for releases. */
export type TrackedProject = ProjectDefinition & { repository: RepositoryRef }
/** A project the hub can install: it has a repository and an install procedure. */
export type InstallableProject = TrackedProject & { install: InstallConfig }

export function isTracked(p: ProjectDefinition): p is TrackedProject {
  return !p.comingSoon && Boolean(p.repository)
}
export function isInstallable(p: ProjectDefinition): p is InstallableProject {
  return isTracked(p) && Boolean(p.install)
}

/** Every tool the project names: its installation's, then its extras' (each id once). */
export function allTools(install: InstallConfig | undefined): ToolRequirement[] {
  const out = new Map<string, ToolRequirement>()
  for (const t of [...(install?.tools ?? []), ...(install?.extras ?? []).flatMap((x) => x.tools)]) if (!out.has(t.id)) out.set(t.id, t)
  return [...out.values()]
}

/** The add-on host this project lives inside, if any (e.g. TMST inside Tekken 3 Expanded). */
export function hostProjectId(p: ProjectDefinition): string | null {
  return p.install?.installInto?.project ?? null
}

/** A source game known to the hub (used for ISO / ROM management). */
export const GameDefinition = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  platform: z.string().min(1),
  region: z.string().optional(),
  /** Accepted file extensions, lowercase without dot. */
  extensions: z.array(z.string()).min(1),
  /** Known good hashes for validation (phase 4). */
  knownHashes: z
    .array(
      z.object({
        algorithm: z.enum(['sha1', 'md5', 'crc32']),
        value: z.string(),
        label: z.string().optional(),
        /** Which release of the game this dump is, e.g. a board revision; projects can require one. */
        revision: z.string().optional()
      })
    )
    .default([]),
  /**
   * Serial numbers of the game's discs (the program SYSTEM.CNF boots, or a PSP
   * disc's UMD_DATA.BIN): which game and region a chosen disc image is, for any
   * version or dump format. Only serials the projects themselves document.
   */
  serials: z
    .array(
      z.object({
        /** As printed on the disc, e.g. `SLUS-00402`. */
        value: z.string().regex(/^[A-Z]{4}-\d{5}$/),
        region: z.string().min(1)
      })
    )
    .default([])
})
export type GameDefinition = z.infer<typeof GameDefinition>

export const GamesCatalog = z.object({
  schemaVersion: z.literal(1),
  games: z.array(GameDefinition)
})
