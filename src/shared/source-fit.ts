import type { SourceConfig } from './install'
import type { GameDefinition, SourceRequirement } from './registry-schema'

export type SourceFit =
  | { kind: 'ok' }
  /** Readable, but not a known dump: the project may or may not take it. */
  | { kind: 'doubtful' }
  /** A known dump of a revision this project does not read. */
  | { kind: 'wrong-revision'; have: string | undefined; need: string[] }

/** The revision of a verified file, from the known hash it matched. */
export function matchedRevision(game: GameDefinition | undefined, config: SourceConfig | null | undefined): string | undefined {
  const matched = config?.validation?.verdict === 'verified' ? config.validation.matched : undefined
  if (!matched || !game) return undefined
  return game.knownHashes.find((h) => (h.label ?? h.value) === matched)?.revision
}

/**
 * Whether a chosen, readable game file works with one project. Null while there is
 * nothing to judge (no file, still checking, missing or unreadable).
 */
export function sourceFit(game: GameDefinition | undefined, req: SourceRequirement, config: SourceConfig | null | undefined): SourceFit | null {
  const verdict = config?.validation?.verdict
  if (!config || config.validating || !verdict || verdict === 'missing' || verdict === 'invalid') return null
  if (req.revisions?.length) {
    if (verdict !== 'verified') return { kind: 'doubtful' }
    const have = matchedRevision(game, config)
    return have && req.revisions.includes(have) ? { kind: 'ok' } : { kind: 'wrong-revision', have, need: req.revisions }
  }
  return verdict === 'mismatch' ? { kind: 'doubtful' } : { kind: 'ok' }
}
