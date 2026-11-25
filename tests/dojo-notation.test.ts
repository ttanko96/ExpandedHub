import { describe, expect, it } from 'vitest'
import { InputMatcher, parseNotation, trainerTargets, type Button, type Dir } from '@shared/dojo-notation'

describe('notation', () => {
  it('reads directions, buttons, links and prefixes', () => {
    expect(parseNotation('d/f+1')).toEqual([{ link: null, prefixes: [], motion: null, dir: 'd/f', hold: false, buttons: [1] }])
    const ewgf = parseNotation('f,n,d,d/f+2')
    expect(ewgf.map((s) => s.dir)).toEqual(['f', 'n', 'd', 'd/f'])
    expect(ewgf[3]!.buttons).toEqual([2])
    const ws = parseNotation('WS+4')[0]!
    expect(ws.prefixes).toEqual(['WS'])
    expect(parseNotation('f,F+3+4')[1]).toMatchObject({ link: ',', dir: 'f', hold: true, buttons: [3, 4] })
    expect(parseNotation('1~2:1').map((s) => s.link)).toEqual([null, '~', ':'])
    expect(parseNotation('qcf+2')[0]!.motion).toBe('qcf')
    expect(parseNotation('2+1')[0]!.buttons).toEqual([1, 2])
  })

  it('refuses what it cannot read', () => {
    for (const bad of ['', 'x+1', '1,', ',1', 'f+b', '1+1', 'qcf+d', 'WS', '1 2']) {
      expect(() => parseNotation(bad), bad).toThrow()
    }
  })
})

/** Plays inputs into a matcher: each entry is held for `hold` ms, frames every 16 ms. */
function play(input: string, frames: { dir?: Dir; btn?: Button[]; ms?: number }[]) {
  const targets = trainerTargets(input)
  if (!targets) throw new Error(`not trainable: ${input}`)
  const m = new InputMatcher(targets)
  const events: string[] = []
  let t = 1000
  for (const f of frames) {
    const end = t + (f.ms ?? 48)
    for (; t < end; t += 16) {
      const e = m.feed(t, f.dir ?? 'n', f.btn ?? [])
      if (e) events.push(e.type === 'fail' ? `fail:${e.reason}` : e.type)
    }
  }
  return events
}

describe('trainer matcher', () => {
  it('accepts a direction with a button', () => {
    expect(play('d/f+1', [{ dir: 'd/f' }, { dir: 'd/f', btn: [1] }, {}])).toContain('done')
    expect(play('d/f+1', [{ dir: 'f', btn: [1] }, {}])).not.toContain('done')
  })

  it('needs buttons pressed together for 1+2', () => {
    expect(play('1+2', [{ btn: [1, 2] }, {}])).toContain('done')
    expect(play('1+2', [{ btn: [1], ms: 200 }, { btn: [1, 2] }, {}])).not.toContain('done')
  })

  it('needs the second tap of f,f+2', () => {
    expect(play('f,f+2', [{ dir: 'f' }, {}, { dir: 'f' }, { dir: 'f', btn: [2] }, {}])).toContain('done')
    expect(play('f,f+2', [{ dir: 'f' }, { dir: 'f', btn: [2] }, {}])).not.toContain('done')
  })

  it('follows a quarter circle and the electric', () => {
    expect(play('qcf+1', [{ dir: 'd' }, { dir: 'd/f' }, { dir: 'f', btn: [1] }, {}])).toContain('done')
    expect(play('f,n,d,d/f+2', [{ dir: 'f' }, { dir: 'n' }, { dir: 'd' }, { dir: 'd/f', btn: [2] }, {}])).toContain('done')
  })

  it('runs out of time between hits', () => {
    expect(play('1,2', [{ btn: [1] }, { ms: 900 }, { btn: [2] }, {}])).toEqual(['progress', 'fail:slow'])
  })

  it('stops on a wrong button', () => {
    expect(play('1,2', [{ btn: [1] }, {}, { btn: [3] }, {}])).toEqual(['progress', 'fail:button'])
  })

  it('lets a crouch wait before a while-standing move', () => {
    expect(play('WS+4', [{ dir: 'd', ms: 1200 }, { dir: 'n', btn: [4] }, {}])).toContain('done')
  })

  it('cannot train back-turned moves', () => {
    expect(trainerTargets('BT+2')).toBeNull()
  })
})
