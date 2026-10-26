import fs from 'fs-extra'
import path from 'path'
import { randomUUID } from 'crypto'
import Store from 'licia/Store'

// Small, infrequently changed preferences must survive an immediate relaunch.
// Keep window geometry on FileStore; it benefits from debounced writes.
export default class SettingsStore extends Store {
  declare save: (data: Record<string, unknown>) => void

  constructor(file: string, defaults: Record<string, unknown>) {
    let saved: Record<string, unknown> = {}
    try {
      const value = fs.readJsonSync(file)
      if (value && typeof value === 'object' && !Array.isArray(value)) saved = value
    } catch { /* A missing or malformed settings file uses defaults. */ }
    // Store's constructor only records data in memory; unlike FileStore it
    // schedules no write before we install the synchronous persistence hook.
    super({ ...defaults, ...saved })
    this.save = (data) => {
      fs.ensureDirSync(path.dirname(file))
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        fs.writeFileSync(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
        fs.renameSync(temporary, file)
      } finally {
        fs.removeSync(temporary)
      }
    }
  }
}
