import type { ScreencastInputAction } from 'common/types'

const keys: Record<string, number> = {
  ArrowUp: 2012, ArrowDown: 2013, ArrowLeft: 2014, ArrowRight: 2015,
  Tab: 2049, Enter: 2054, Backspace: 2055, Escape: 2070, Delete: 2071,
  Home: 2081, End: 2082, PageUp: 2068, PageDown: 2069, Insert: 2083,
}

// A real editable element lets Chromium and the desktop IME compose text.
// It contains only the current commit, never a copy of the device's document.
export default class ScreencastInput {
  readonly element = document.createElement('textarea')
  private composing = false
  private destroyed = false
  private tail = Promise.resolve()
  private pending = 0
  private epoch = 0
  private phoneClipboard = false
  private hostAtCopy: string | null = null
  private cancelSnapshots = new Set<() => void>()
  private listeners: Array<() => void> = []
  constructor(private canvas: HTMLCanvasElement,
    private send: (action: ScreencastInputAction) => Promise<unknown>,
    private failed: () => void,
    private readHost = () => document.defaultView!.navigator.clipboard.readText()) {
    const area = this.element
    area.className = 'screencast-keyboard-input'
    area.setAttribute('aria-label', 'Screencast keyboard input')
    area.setAttribute('autocapitalize', 'off')
    area.autocomplete = 'off'
    area.spellcheck = false
    area.style.cssText = 'position:absolute;left:50%;top:50%;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;resize:none;'
    this.listen(area, 'keydown', (event: KeyboardEvent) => this.keydown(event))
    this.listen(area, 'compositionstart', () => { this.composing = true })
    this.listen(area, 'compositionend', () => { this.composing = false; this.commit() })
    this.listen(area, 'input', () => { if (!this.composing) this.commit() })
    this.listen(area, 'paste', (event: ClipboardEvent) => {
      if (!this.active()) return
      event.preventDefault()
      this.paste('auto', event.clipboardData?.getData('text/plain') ?? '')
    })
    // Native Edit menu actions (including macOS) also reach this element.
    for (const type of ['copy', 'cut'] as const) {
      this.listen(area, type, (event: ClipboardEvent) => {
        if (!this.active()) return
        event.preventDefault()
        this.copy(type === 'cut')
      })
    }
    this.listen(area, 'blur', () => {
      this.composing = false
      area.value = ''
      this.invalidate() // cancel input still queued for a departed focus
    })
    this.listen(canvas, 'pointerdown', (event: PointerEvent) => {
      if (event.button === 2) {
        // Cancelling the native menu must leave the existing keyboard focus
        // intact. A right click does not move the phone's caret or drop edits.
        event.preventDefault()
        this.focus()
        return
      }
      if (event.button === 0) {
        this.invalidate()
        this.element.value = ''
        this.composing = false
        event.preventDefault() // canvas must not steal the IME focus afterward
        this.focus()
      }
    })
  }
  mount(container: HTMLElement) { container.appendChild(this.element) }
  focus() { if (!this.destroyed) this.element.focus({ preventScroll: true }) }
  edit(command: 'selectAll' | 'delete') {
    if (!this.active()) return false
    if (command === 'selectAll') this.submit({ type: 'keys', keys: [2072, 2017] })
    else if (command === 'delete') this.submit({ type: 'keys', keys: [2071] })
    else return false
    return true
  }
  copy(cut = false) {
    if (this.destroyed) return
    // Snapshot at the user's copy gesture, not after a slow device command.
    // Read-only: never replace the desktop clipboard with a routing marker.
    const snapshot = this.snapshotHost()
    this.enqueue(async current => {
      const host = await snapshot
      if (!current()) return
      await this.send({ type: 'keys', keys: [2072, cut ? 2040 : 2019] })
      if (!this.destroyed) {
        this.hostAtCopy = host
        this.phoneClipboard = true
      }
    })
  }
  paste(source: 'auto' | 'host' | 'phone' = 'auto', text?: string) {
    if (this.destroyed) return
    const snapshot = source === 'phone' ? Promise.resolve(null)
      : text !== undefined ? Promise.resolve(text) : this.snapshotHost()
    this.enqueue(async current => {
      const host = await snapshot
      if (!current()) return
      if (source === 'phone' || (source === 'auto' && this.phoneClipboard &&
        (this.hostAtCopy === null || host === null || host === this.hostAtCopy))) {
        await this.send({ type: 'keys', keys: [2072, 2038] })
      } else {
        if (host === null) throw new Error('Clipboard read failed')
        this.phoneClipboard = false
        this.hostAtCopy = null
        if (host.length > 65536) throw new Error('Input too large')
        if (host) await this.send({ type: 'text', text: host })
      }
    })
  }
  private snapshotHost() {
    // The OS clipboard can remain locked or its permission request can hang.
    // Never let that hold the device input queue indefinitely.
    return new Promise<string | null>(resolve => {
      let settled = false
      const finish = (text: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.cancelSnapshots.delete(cancel)
        resolve(text)
      }
      const cancel = () => finish(null)
      const timer = setTimeout(cancel, 1500)
      this.cancelSnapshots.add(cancel)
      Promise.resolve().then(() => settled ? null : this.readHost()).then(finish, cancel)
    })
  }
  private invalidate() {
    this.epoch++
    for (const cancel of this.cancelSnapshots) cancel()
  }
  private active() { return !this.destroyed && document.activeElement === this.element }
  private commit() {
    const text = this.element.value
    this.element.value = ''
    if (this.active() && text) this.submit({ type: 'text', text })
  }
  private keydown(event: KeyboardEvent) {
    if (!this.active() || this.composing || event.isComposing || event.keyCode === 229) return
    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey
    const key = event.key.toLowerCase()
    if (shortcut && ['c', 'x', 'v'].includes(key)) {
      event.preventDefault()
      // Empty/non-text desktop clipboards may not dispatch a native paste event.
      if (key === 'v') this.paste(event.shiftKey ? 'phone' : 'auto')
      else this.copy(key === 'x')
      return
    }
    let code = keys[event.key]
    if (shortcut && /^[a-z]$/.test(key)) code = 2017 + key.charCodeAt(0) - 97
    if (!code) return // printable text/dead keys belong to Chromium's IME
    event.preventDefault()
    const modifiers: number[] = []
    if (event.ctrlKey || event.metaKey) modifiers.push(2072)
    if (event.altKey) modifiers.push(2045)
    if (event.shiftKey) modifiers.push(2047)
    if (modifiers.length > 2) { this.failed(); return }
    this.submit({ type: 'keys', keys: [...modifiers, code] })
  }
  submit(action: ScreencastInputAction) {
    if (this.destroyed) return
    if (action.type === 'text' && action.text.length > 65536) {
      this.invalidate()
      this.failed()
      return
    }
    this.enqueue(async () => { await this.send(action) })
  }
  private enqueue(operation: (current: () => boolean) => Promise<void>) {
    if (this.destroyed) return
    if (this.pending >= 64) {
      this.invalidate()
      this.failed()
      return
    }
    const epoch = this.epoch
    const current = () => !this.destroyed && epoch === this.epoch
    this.pending++
    this.tail = this.tail.then(async () => {
      if (!current()) return
      try { await operation(current) }
      catch {
        if (!this.destroyed && epoch === this.epoch) {
          this.invalidate() // do not replay, or run later edits against unknown text
          this.failed()
        }
      }
    }).finally(() => { this.pending-- })
  }
  destroy() {
    this.destroyed = true
    this.invalidate()
    for (const off of this.listeners) off()
    this.listeners = []
    this.element.value = ''
    this.hostAtCopy = null
    this.phoneClipboard = false
    this.element.remove()
  }
  private listen(target: EventTarget, type: string, listener: (event: any) => void) {
    target.addEventListener(type, listener)
    this.listeners.push(() => target.removeEventListener(type, listener))
  }
}
