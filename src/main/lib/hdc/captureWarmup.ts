interface Options {
  prepare(key: string, scale: number, valid: () => boolean): Promise<boolean>
  cancel(key: string): Promise<void>
  onError(error: unknown): void
  ttlMs?: number
}
interface Entry {
  key: string
  scale: number
  expired: boolean
  timer?: ReturnType<typeof setTimeout>
}

// Selection policy only. The capture coordinator owns device serialization and
// resource cleanup, including a click racing with selection/expiry/shutdown.
export class CaptureWarmup {
  private targets = new Set<string>()
  private selected?: string
  private scale = 1
  private current?: Entry
  private disposed = false
  private tasks = new Set<Promise<void>>()
  constructor(private options: Options) {}
  select(key: string | undefined, scale: number) {
    this.selected = key
    this.scale = Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 1
    this.reconcile()
  }
  setTargets(keys: string[]) {
    this.targets = new Set(keys)
    this.reconcile()
  }
  private track(task: Promise<unknown>) {
    const settled = task.then(() => {}, error => this.options.onError(error))
    this.tasks.add(settled)
    void settled.finally(() => this.tasks.delete(settled))
  }
  private cancel(entry: Entry) {
    entry.expired = true
    clearTimeout(entry.timer)
    this.track(this.options.cancel(entry.key))
  }
  private reconcile() {
    if (this.disposed) return
    const key = this.selected && this.targets.has(this.selected) ? this.selected : undefined
    if (this.current?.key === key && this.current?.scale === this.scale) return
    if (this.current) this.cancel(this.current)
    this.current = undefined
    if (!key) return
    const entry: Entry = { key, scale: this.scale, expired: false }
    this.current = entry
    const valid = () => !this.disposed && this.current === entry && !entry.expired
    this.track(this.options.prepare(key, entry.scale, valid).then(ready => {
      if (!ready || !valid()) return
      entry.timer = setTimeout(() => this.cancel(entry), this.options.ttlMs ?? 60000)
      entry.timer.unref?.()
    }))
  }
  async dispose() {
    if (!this.disposed) {
      this.disposed = true
      if (this.current && !this.current.expired) this.cancel(this.current)
    }
    await Promise.all([...this.tasks])
  }
}
