import { safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'


/**
 * Keeps the optional GitHub token encrypted with the OS keychain
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux) through
 * Electron's safeStorage. The token never reaches the renderer.
 *
 * When the OS offers no encryption the token is kept in memory for this
 * session only, never written to disk in plain text.
 */
export class TokenStore {
  private cached: string | null | undefined
  private sessionOnly = false

  /** `fileName` lets other secrets (e.g. ScreenScraper credentials) reuse the same mechanism. */
  constructor(private readonly fileName = 'github-token.bin') {}

  private file(): string {
    return join(paths.userData(), this.fileName)
  }

  async get(): Promise<string | null> {
    if (this.cached !== undefined) return this.cached
    try {
      const buf = await fs.readFile(this.file())
      this.cached = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null
    } catch {
      this.cached = null
    }
    return this.cached
  }

  /** Returns false when the token could only be kept for this session. */
  async set(token: string): Promise<boolean> {
    this.cached = token
    if (!safeStorage.isEncryptionAvailable()) {
      this.sessionOnly = true
      return false
    }
    await fs.mkdir(paths.userData(), { recursive: true })
    await fs.writeFile(this.file(), safeStorage.encryptString(token))
    this.sessionOnly = false
    return true
  }

  async clear(): Promise<void> {
    this.cached = null
    this.sessionOnly = false
    await fs.rm(this.file(), { force: true })
  }

  isSessionOnly(): boolean {
    return this.sessionOnly
  }
}
