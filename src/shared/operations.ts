/** Download / installation operations shown on the Downloads page. */

export type OperationStepId = 'download' | 'verify' | 'extract' | 'prepare' | 'build' | 'configure' | 'finalize'

export type StepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed'

export type OperationStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface OperationStep {
  id: OperationStepId
  label: string
  state: StepState
}

export interface OperationFile {
  name: string
  url: string
  /** Expected size in bytes, 0 when unknown (source archives). */
  size: number
}

export interface Operation {
  id: string
  projectId: string
  projectName: string
  /** `build` reruns the project's build in an existing installation, without downloading. */
  /** `tool` downloads a program a project needs (Godot) before that project's own operation. */
  kind: 'install' | 'update' | 'build' | 'tool'
  /** The tool a `tool` operation installs (its id in the registry's `install.tools`). */
  toolId?: string
  /** A `build` that makes one of the project's extras (`install.extras`) instead of its build. */
  extraId?: string
  /** That extra's name, for the Downloads page. */
  extraName?: string
  /** Operations that must complete first (the tools it needs); it waits queued until then. */
  waitFor?: string[]
  version: string
  tag: string
  status: OperationStatus
  steps: OperationStep[]
  /** Short human-readable description of what is happening now. */
  message: string
  file: OperationFile
  checksumFile: OperationFile | null
  /** Bytes received / expected for the current transfer or extraction. */
  received: number
  total: number
  /** Bytes per second, smoothed. */
  speed: number
  etaSeconds: number | null
  /** Folder holding the extracted files once the download stage completes. */
  outputDir: string | null
  /** Where the project gets installed. */
  installPath: string | null
  /** Scripts the user allowed to run for this operation (shown in the install dialog). */
  consentedScripts: string[]
  error: string | null
  /** Troubleshooting hint shown with errors. */
  hint: string | null
  /** Optional parts that were skipped (e.g. an optional step that failed), shown even when the operation succeeds. */
  warnings?: string[]
  /**
   * The build phase: scripts finished of all, and how far the running one is
   * (0–100) when it reports a percentage. Drives the overall progress shown.
   */
  build?: { done: number; total: number; percent: number | null }
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export const ACTIVE_STATUSES: OperationStatus[] = ['queued', 'running', 'paused']

export const isActive = (op: Operation) => ACTIVE_STATUSES.includes(op.status)
