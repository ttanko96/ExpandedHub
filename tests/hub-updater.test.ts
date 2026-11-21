import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.1.0', getName: () => 'ExpandedHub', isPackaged: false }, net: {}, shell: {} }))

import { pickInstaller } from '../src/main/services/hub-updater'

const asset = (name: string) => ({ name, size: 1, browser_download_url: `https://github.com/x/y/releases/download/v1/${name}` })

describe('hub self-update', () => {
  it('picks the NSIS installer, not the zip or blockmap', () => {
    const list = [asset('ExpandedHub-0.2.0-win.zip'), asset('ExpandedHub-Setup-0.2.0.exe.blockmap'), asset('ExpandedHub-Setup-0.2.0.exe')]
    expect(pickInstaller(list)?.name).toBe('ExpandedHub-Setup-0.2.0.exe')
  })
  it('returns null when the release has no installer', () => {
    expect(pickInstaller([asset('ExpandedHub-0.2.0-win.zip')])).toBeNull()
  })
})
