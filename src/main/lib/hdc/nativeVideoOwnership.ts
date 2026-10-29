import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export interface NativeOwner {
  name: string
  hostPid: number
  devicePid: string
  started: string
  port?: number
}
const namePattern = /^scrcpy_harmony_[a-f0-9]{16}\.so$/
const recovering = new Map<string, Promise<void>>()
function alive(pid: number) {
  try { process.kill(pid, 0); return true }
  catch (error) {
    // Access denied or an unknown OS error is not proof of a dead owner.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
function validate(value: NativeOwner, name: string) {
  if (!value || value.name !== name || !namePattern.test(value.name) ||
    !Number.isSafeInteger(value.hostPid) || value.hostPid <= 0 ||
    !/^[1-9]\d*$/.test(value.devicePid) || !/^\d+$/.test(value.started) ||
    (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535))) {
    throw new Error('Invalid native ownership record')
  }
}

// A durable per-device journal, never inferred from a remote filename alone.
// Claiming by atomic rename prevents another desktop process recovering it too.
export class NativeVideoOwnership {
  constructor(private directory: string) {}
  private file(name: string) { return path.join(this.directory, `${name}.${process.pid}.json`) }
  async save(identity: Omit<NativeOwner, 'hostPid'>) {
    const value = { ...identity, hostPid: process.pid }
    validate(value, value.name)
    await mkdir(this.directory, { recursive: true })
    const temporary = this.file(value.name) + `.${randomBytes(8).toString('hex')}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
      await rename(temporary, this.file(value.name))
    } finally { await rm(temporary, { force: true }) }
  }
  async clear(name: string) {
    if (!namePattern.test(name)) throw new Error('Invalid native ownership record name')
    await rm(this.file(name), { force: true })
  }
  async hasForeignRecords() {
    let files: string[]
    try { files = await readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
    for (const file of files) {
      const match = /^(scrcpy_harmony_[a-f0-9]{16}\.so)\.([1-9]\d*)\.json$/.exec(file)
      if (!match) continue
      if (Number(match[2]) !== process.pid) return true
      let contents: string
      try { contents = await readFile(path.join(this.directory, file), 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      try {
        const owner = JSON.parse(contents)
        validate(owner, match[1])
        if (owner.hostPid !== process.pid) return true
      } catch { return true }
    }
    return false
  }
  recover(cleanup: (owner: NativeOwner) => Promise<void>): Promise<void> {
    const pending = recovering.get(this.directory)
    if (pending) return pending
    const task = this.recoverRecords(cleanup).finally(() => {
      if (recovering.get(this.directory) === task) recovering.delete(this.directory)
    })
    recovering.set(this.directory, task)
    return task
  }
  private async recoverRecords(cleanup: (owner: NativeOwner) => Promise<void>) {
    let files: string[]
    try { files = await readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const file of files) {
      const match = /^(scrcpy_harmony_[a-f0-9]{16}\.so)\.([1-9]\d*)\.json$/.exec(file)
      if (!match) continue
      const claimant = Number(match[2])
      if (claimant !== process.pid && alive(claimant)) continue
      const source = path.join(this.directory, file)
      let contents: string
      try { contents = await readFile(source, 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      let owner: NativeOwner
      try { owner = JSON.parse(contents); validate(owner, match[1]) }
      catch {
        // Preserve corrupt data for diagnosis, never use it to authorize device
        // cleanup and never let it prevent processing other valid sessions.
        try { await rename(source, source + `.${randomBytes(8).toString('hex')}.invalid`) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        console.warn('Invalid native ownership record quarantined')
        continue
      }
      if (alive(owner.hostPid)) continue
      const claimed = this.file(owner.name)
      if (source !== claimed) {
        try { await rename(source, claimed) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      }
      await cleanup(owner)
      await rm(claimed)
    }
  }
}
