import type { RepositoryRef } from '@shared/registry-schema'
import type { InstalledRecord, ReleaseInfo } from '@shared/types'
import type { ReleaseProvider, RepoSnapshot } from './release-provider'

/**
 * Demo data for offline UI work. Versions and dates are illustrative only —
 * they are NOT read from GitHub. Enabled with Settings → Advanced → Demo mode.
 */
const MOCK_RELEASES: Record<string, Omit<ReleaseInfo, 'htmlUrl'>> = {
  'FishB0nes98/Tekken3Recompiled': {
    version: '1.0.0',
    tag: 'v1.0.0',
    name: 'Tekken3Recompiled 1.0.0',
    publishedAt: '2026-10-02T18:00:00Z',
    notes: '### Mock release\n- Native builds for Windows, macOS and Linux\n- Controller hot-plug support\n- Fixes for widescreen HUD scaling',
    prerelease: false,
    assets: []
  },
  'omarma/tekken3-expanded': {
    version: '0.1.2',
    tag: 'v0.1.2',
    name: 'Tekken 3 Expanded 0.1.2',
    publishedAt: '2026-11-12T20:30:00Z',
    notes: '### Mock release\n- TTT Cinematics: twelve endings in-engine\n- Tekken 5 DR content (experimental): Jin\'s traditional karate moveset\n- PS2 strong-hit sparks for the Mishimas and Unknown',
    prerelease: false,
    assets: [
      { name: 'tekken3-expanded-windows.zip', size: 48_200_000, downloadUrl: 'https://example.invalid/mock.zip' }
    ]
  },
  'ttanko96/t3-expanded-addons': {
    version: '1.0.0',
    tag: 'v1.0.0',
    name: 'TMST 1.0.0',
    publishedAt: '2026-11-14T16:00:00Z',
    notes: '### Mock release\n- Jukebox and Photo Mode\n- Tournament Mode and VS Mode+\n- Tekken 2 music and stages from your Tekken 2 disc',
    prerelease: false,
    assets: [
      { name: 'tmst-1.0.0-windows.zip', size: 3_400_000, downloadUrl: 'https://example.invalid/mock.zip' },
      { name: 'tmst-1.0.0-linux.zip', size: 3_300_000, downloadUrl: 'https://example.invalid/mock.zip' },
      { name: 'tmst-1.0.0-macos.zip', size: 3_350_000, downloadUrl: 'https://example.invalid/mock.zip' }
    ]
  }
}

/** Demo installed state, so every status can be seen in phase 1. Not written to disk. */
export const MOCK_INSTALLED: InstalledRecord[] = [
  {
    projectId: 'tekken3-recompiled',
    version: '1.0.0',
    installedAt: '2026-10-05T10:00:00Z',
    installPath: 'C:/ExpandedHub/installs/tekken3-recompiled'
  },
  {
    projectId: 'tekken3-expanded',
    version: '0.1.1',
    installedAt: '2026-11-01T10:00:00Z',
    installPath: 'C:/ExpandedHub/installs/tekken3-expanded'
  }
]

export class MockReleaseProvider implements ReleaseProvider {
  readonly id = 'mock' as const

  async fetch(repo: RepositoryRef): Promise<RepoSnapshot> {
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 450)) // feel like a network call
    const key = `${repo.owner}/${repo.name}`
    const r = MOCK_RELEASES[key]
    const release: ReleaseInfo | null = r ? { ...r, htmlUrl: `https://github.com/${key}/releases/tag/${r.tag}` } : null
    return { release, commit: null, etags: {}, pinned: repo.pinTag ?? null }
  }

  rateLimit() {
    return null
  }
}
