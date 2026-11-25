import { Gamepad2, Globe, ImageOff, Music, Play, Puzzle, Stethoscope, Swords, Wrench } from 'lucide-react'
import { ext } from './checks'
import type { Area, Finding, FixContext, FixMethod, Symptom } from './types'

const ALL: Area[] = ['install', 'files', 'tools', 'downloads']
const everything: Symptom = { id: 'all', label: 'Check everything', icon: Stethoscope, areas: ALL, tips: [] }

const buildFailed = (tips: string[] = []): Symptom => ({
  id: 'build',
  label: 'Install or build failed',
  icon: Wrench,
  areas: ['downloads', 'files', 'tools'],
  tips: ['Its builds read your own discs: a file that is not the expected version is the most common cause.', 'The failed operation’s log is on the Downloads page; its last lines usually name the problem.', ...tips]
})

/** Any project without a method of its own. */
const DEFAULT: FixMethod = {
  symptoms: [
    { id: 'start', label: 'It will not start', icon: Play, areas: ['install', 'tools'], tips: ['Built before you changed a game file? Build again.'] },
    buildFailed(),
    { id: 'content', label: 'Something is missing', icon: ImageOff, areas: ['files', 'install'], tips: ['Optional content appears only when its game file is set up, after Build again.'] },
    everything
  ]
}

const name = (ctx: FixContext, id: string) => ctx.projects.find((p) => p.id === id)?.name ?? id

const METHODS: Record<string, FixMethod> = {
  'tekken3-expanded': {
    symptoms: [
      {
        id: 'start',
        label: 'Tekken 3 Expanded will not start',
        icon: Play,
        areas: ['install', 'tools'],
        tips: ['It starts from “Tekken 3 Expanded.exe” in its folder; Build again makes it when it is missing.', 'Changed a game file or added an add-on since? Build again.']
      },
      buildFailed(['It needs Python 3.10–3.15; the hub prepares its own environment from it.']),
      {
        id: 'content',
        label: 'Characters, stages or music missing',
        icon: Swords,
        areas: ['files', 'install'],
        tips: [
          'The TTT characters need the Tekken Tag Tournament arcade set.',
          'Arcade stages and HD portraits need the Tekken 3 arcade set; PS2 music needs the TTT PS2 disc.',
          'The Tekken 5 DR content needs its PSP disc and PPSSPP.',
          'After setting up a file: Build again.'
        ]
      },
      everything
    ],
    checks: (ctx) => {
      const install: Finding[] = []
      // Add-ons that live inside it (TMST): installed ones are built in only by Build again.
      for (const a of ctx.projects.filter((p) => p.install?.installInto?.project === ctx.project.id)) {
        const st = ctx.states[a.id]
        if (st?.installed && !st.missing) install.push({ key: `addon:${a.id}`, level: 'ok', title: `${a.name} is in it` })
      }
      const tools: Finding[] = []
      const ppsspp = ctx.preflight?.tools.find((t) => t.id === 'ppsspp')
      if (ctx.sources['t5dr-psp'] && ppsspp?.found === false) {
        tools.push({ key: 't5dr', level: 'warn', title: 'The Tekken 5 DR disc is set up, but PPSSPP is not found', detail: 'Its content is read through PPSSPP.', action: { label: 'Locate…', run: () => void window.hub.tools.pick('ppsspp') } })
      }
      return { install, tools }
    }
  },

  'tmst-addon': {
    symptoms: [
      {
        id: 'ingame',
        label: 'TMST does not show up in the game',
        icon: Puzzle,
        areas: ['install', 'downloads'],
        tips: ['TMST lives inside Tekken 3 Expanded: it is in the game only after Tekken 3 Expanded is built again with it.', 'Its menus (Jukebox, Photo Mode, Tournament, VS Mode+) are reached from the game’s own menus.']
      },
      {
        id: 'music',
        label: 'Tekken 2 or Tekken 1 content missing',
        icon: Music,
        areas: ['files', 'install'],
        tips: ['Tekken 2 and Tekken 1 music and stages come from your own discs; each is optional.', 'After setting up a disc: Build again.']
      },
      buildFailed(),
      everything
    ],
    checks: (ctx) => {
      const hostId = ctx.project.install?.installInto?.project
      if (!hostId) return {}
      const host = ctx.states[hostId]
      const hostName = name(ctx, hostId)
      const open = { label: `Open ${hostName}`, run: () => ctx.navigate(`/mods/${hostId}`) }
      const install: Finding[] = []
      if (!host?.installed) install.push({ key: 'host', level: 'fail', title: `${hostName} is not installed`, detail: `TMST installs into ${hostName}.`, action: open })
      else if (host.missing) install.push({ key: 'host', level: 'fail', title: `${hostName}’s folder is not there`, detail: `TMST lives inside it.\n${host.installed.installPath}`, action: open })
      else if (host.rebuild.length > 0) {
        install.push({ key: 'host', level: 'warn', title: `${hostName} needs Build again`, detail: `Until then the game runs without: ${host.rebuild.join(', ')}.`, action: { label: `Build ${hostName}`, run: () => ctx.openInstall(hostId, 'build') } })
      } else install.push({ key: 'host', level: 'ok', title: `${hostName} is installed and built` })
      return { install }
    }
  },

  'driftengine-tekken3': {
    symptoms: [
      {
        id: 'start',
        label: 'The game does not open in the browser',
        icon: Globe,
        areas: ['install', 'tools', 'downloads'],
        tips: [
          'It plays in Chrome or Edge; the hub starts its server and must stay open while you play.',
          'It uses http://localhost:5190/: another program on that port stops it from starting.',
          'Its server needs Node.js; the first start can take a few minutes.'
        ]
      },
      buildFailed(['It needs Node.js and FFmpeg.']),
      {
        id: 'content',
        label: 'Arcade stages or models missing',
        icon: ImageOff,
        areas: ['files', 'install'],
        tips: ['Only the Japan TET1 (VER.E) arcade revision is read; other revisions are not.', 'After setting up a file: Build again.']
      },
      everything
    ],
    checks: (ctx) => {
      const files: Finding[] = []
      const disc = ctx.sources['tekken3-ps1']
      if (disc && ext(disc.path) === 'chd') {
        files.push({ key: 'chd', level: 'fail', title: 'Its disc is a .chd: DriftEngine reads only .cue with .bin', detail: disc.path, action: { label: 'Choose file…', run: () => void window.hub.sources.pick('tekken3-ps1') } })
      }
      return { files }
    }
  },

  'tekken3-recompiled': {
    symptoms: [
      { id: 'start', label: 'Tekken3Recompiled will not start', icon: Play, areas: ['install'], tips: ['It starts from “Play Tekken 3.exe”; Build again makes it when it is missing.'] },
      buildFailed(),
      { id: 'jun', label: 'Jun Kazama is missing', icon: Swords, areas: ['files', 'install'], tips: ['Jun needs both arcade sets: Tekken 3 and Tekken Tag Tournament. Then Build again.'] },
      everything
    ],
    checks: (ctx) => {
      const have = ['ttt-arcade', 'tekken3-arcade'].filter((g) => ctx.sources[g])
      if (have.length !== 1) return {}
      return { files: [{ key: 'jun', level: 'warn', title: 'Only one of the two arcade sets is set up', detail: 'Jun Kazama needs both, Tekken 3 and Tekken Tag Tournament.' }] }
    }
  },

  'tekken3-remake': {
    symptoms: [
      { id: 'start', label: 'The remake will not start', icon: Gamepad2, areas: ['install', 'tools'], tips: ['It opens in Godot: the hub downloads Godot when it is missing.'] },
      buildFailed(['It needs Python, Godot and FFmpeg.']),
      { id: 'content', label: 'Stages or music missing', icon: ImageOff, areas: ['files', 'install'], tips: ['Arcade stage scenes and fight music need the Tekken 3 arcade set. Then Build again.'] },
      everything
    ],
    checks: (ctx) => {
      const disc = ctx.sources['tekken3-ps1']
      if (!disc || ext(disc.path) !== 'chd') return {}
      return { files: [{ key: 'chd', level: 'info', title: 'Its disc is a .chd', detail: 'Converting it needs MAME’s chdman; a .cue with its .bin needs nothing else.' }] }
    }
  }
}

export function methodFor(projectId: string): FixMethod {
  return METHODS[projectId] ?? DEFAULT
}
