import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Small persistent JSON store. Writes go to a temp file first and are renamed
 * into place, so a crash mid-write never leaves a corrupted file behind.
 */
export class JsonStore<T> {
  private cache: T | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly defaults: () => T
  ) {}

  async read(): Promise<T> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      this.cache = JSON.parse(raw) as T
    } catch {
      this.cache = this.defaults()
    }
    return this.cache
  }

  async write(value: T): Promise<void> {
    this.cache = value
    // Serialize writes so concurrent updates cannot interleave.
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
      await fs.rename(tmp, this.file)
    })
    return this.writing
  }

  async update(fn: (current: T) => T): Promise<T> {
    const next = fn(await this.read())
    await this.write(next)
    return next
  }
}
