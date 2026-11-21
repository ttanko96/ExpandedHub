import { describe, expect, it } from 'vitest'
import type { Operation, OperationStepId } from '@shared/operations'
import { percent } from '../src/renderer/src/components/downloads/progress-math'

const ids: OperationStepId[] = ['download', 'verify', 'extract', 'prepare', 'build', 'configure', 'finalize']
const op = (states: Partial<Record<OperationStepId, string>>, extra: Partial<Operation> = {}) =>
  ({
    status: 'running',
    received: 0,
    total: 0,
    steps: ids.map((id) => ({ id, label: id, state: states[id] ?? 'pending' })),
    ...extra
  }) as unknown as Operation

describe('overall progress', () => {
  it('counts finished steps, skips skipped ones and is 100 when completed', () => {
    expect(percent(op({}))).toBe(0)
    expect(percent(op({ download: 'done', verify: 'skipped', extract: 'done' }))).toBe(27)
    expect(percent(op({}, { status: 'completed' }))).toBe(100)
  })
  it('moves inside the download by bytes and inside the build by scripts and their own percentage', () => {
    expect(percent(op({ download: 'active' }, { received: 50, total: 100 }))).toBe(10)
    const built = { download: 'done', verify: 'done', extract: 'done', prepare: 'done', build: 'active' } as const
    expect(percent(op(built, { build: { done: 0, total: 2, percent: null } }))).toBe(35)
    expect(percent(op(built, { build: { done: 1, total: 2, percent: 50 } }))).toBe(78)
  })
})
