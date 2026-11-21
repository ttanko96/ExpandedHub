import type { OsPlatform, ProjectDefinition } from './registry-schema'
import type { ReleaseAsset, ReleaseInfo } from './types'

function safeRegex(pattern: string | undefined): RegExp | null {
  if (!pattern) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

export interface DownloadPlan {
  kind: 'asset' | 'source'
  /** The asset to download, when `kind` is `asset`. */
  asset: ReleaseAsset | null
  checksum: ReleaseAsset | null
  /** Human-readable reason when no download can be resolved. */
  problem: string | null
}

/** Resolve which file of a release the installer would download on this OS. */
export function resolveDownload(
  project: ProjectDefinition,
  release: ReleaseInfo | null,
  platform: string
): DownloadPlan {
  const step = project.install?.steps.find((s) => s.type === 'download')
  if (!step || step.type !== 'download') return { kind: 'source', asset: null, checksum: null, problem: 'No download step defined' }
  if (!release) return { kind: step.from, asset: null, checksum: null, problem: 'No release available' }
  // A release without any uploaded package (older releases): its source archive instead.
  if (step.from === 'source' || (release.assets.length === 0 && release.zipballUrl)) {
    return { kind: 'source', asset: null, checksum: null, problem: release.zipballUrl ? null : 'Release has no source archive' }
  }
  const re = safeRegex(step.assetPattern?.[platform as OsPlatform])
  if (!re) return { kind: 'asset', asset: null, checksum: null, problem: `No package defined for ${platform}` }
  const asset = release.assets.find((a) => re.test(a.name)) ?? null
  const csRe = safeRegex(step.checksumAsset)
  const checksum = csRe ? (release.assets.find((a) => csRe.test(a.name)) ?? null) : null
  return {
    kind: 'asset',
    asset,
    checksum,
    problem: asset ? null : `This release has no package matching your system (${platform})`
  }
}
