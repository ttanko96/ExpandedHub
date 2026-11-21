import type { Operation, OperationStepId } from '@shared/operations'

export function formatEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return ''
  if (sec < 60) return `${sec}s left`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s left`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m left`
}

/** How much of the whole operation each step is; the build (the project's own scripts) is the long part. */
const STEP_WEIGHT: Record<OperationStepId, number> = {
  download: 20,
  verify: 3,
  extract: 7,
  prepare: 5,
  build: 58,
  configure: 4,
  finalize: 3
}

/** How far the active step is, 0–1, when it can tell. */
function stepFraction(op: Operation, id: OperationStepId): number {
  if (id === 'download' || id === 'verify' || id === 'extract') return op.total ? Math.min(1, op.received / op.total) : 0
  if (id === 'build' && op.build && op.build.total > 0) {
    return Math.min(1, (op.build.done + (op.build.percent ?? 0) / 100) / op.build.total)
  }
  return 0
}

/** Progress of the whole operation, 0–100, from its steps (skipped ones do not count). */
export function percent(op: Operation): number | null {
  if (op.status === 'completed') return 100
  const counted = op.steps.filter((s) => s.state !== 'skipped')
  const all = counted.reduce((n, s) => n + STEP_WEIGHT[s.id], 0)
  if (!all) return null
  let done = 0
  for (const s of counted) {
    if (s.state === 'done') done += STEP_WEIGHT[s.id]
    else if (s.state === 'active' || s.state === 'failed') done += STEP_WEIGHT[s.id] * stepFraction(op, s.id)
  }
  return Math.min(100, Math.floor((done / all) * 100))
}
