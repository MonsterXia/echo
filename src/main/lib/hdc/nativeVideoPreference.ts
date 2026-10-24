import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import manifest from '../../../../vendor/native-video/manifest.json'

// A hint only: the selected library still passes local/remote integrity checks
// and a live stream handshake. Firmware and resource changes invalidate it.
export class NativeVideoPreference {
  private file?: string
  constructor(directory: string | undefined, identity: string[]) {
    if (directory) {
      const key = createHash('sha256').update(JSON.stringify([identity, manifest.libraries])).digest('hex')
      this.file = path.join(directory, `${key}.json`)
    }
  }
  async load(): Promise<string | undefined> {
    if (!this.file) return
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'))
      if (manifest.libraries.some(library => library.file === value)) return value
    } catch { /* cache misses must not prevent probing */ }
  }
  async save(value: string) {
    if (!this.file || !manifest.libraries.some(library => library.file === value)) return
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`
    try {
      await mkdir(path.dirname(this.file), { recursive: true })
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx' })
      await rename(temporary, this.file)
    } catch { /* best effort; video is already running */ }
    finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
  async clear() {
    if (this.file) await rm(this.file, { force: true }).catch(() => {})
  }
}
