import type { LucideIcon } from 'lucide-react'
import type { Preflight, SourceConfig } from '@shared/install'
import type { Operation } from '@shared/operations'
import type { GameDefinition, ProjectDefinition } from '@shared/registry-schema'
import type { ProjectState } from '@shared/types'

/** The parts of one project Fix-it looks at, in the order they are shown. */
export type Area = 'install' | 'files' | 'tools' | 'downloads'

export const AREA_LABEL: Record<Area, string> = {
  install: 'Its installation',
  files: 'Its game files',
  tools: 'Tools and dependencies',
  downloads: 'Its downloads and builds'
}

export type Level = 'ok' | 'info' | 'warn' | 'fail'

export interface Finding {
  key: string
  level: Level
  title: string
  detail?: string
  action?: { label: string; run: () => void }
}

/** What the user says is going wrong: which areas to look at, and what is good to know about it. */
export interface Symptom {
  id: string
  label: string
  icon: LucideIcon
  areas: Area[]
  tips: string[]
}

/** Everything a check may read. Nothing in it changes anything: actions run only on a click. */
export interface FixContext {
  project: ProjectDefinition
  state: ProjectState | undefined
  /** Null while it is being asked for, or when the hub could not work it out. */
  preflight: Preflight | null
  projects: ProjectDefinition[]
  states: Record<string, ProjectState>
  games: GameDefinition[]
  sources: Record<string, SourceConfig>
  operations: Operation[]
  navigate: (to: string) => void
  openInstall: (projectId: string, mode?: 'install' | 'build') => void
}

/**
 * How one project is diagnosed: the problems it can have, in its own words,
 * and the checks that only make sense for it. The common checks (folder,
 * game files, tools, downloads) run for every project.
 */
export interface FixMethod {
  symptoms: Symptom[]
  checks?: (ctx: FixContext) => Partial<Record<Area, Finding[]>>
}
