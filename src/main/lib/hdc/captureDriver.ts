import { AsyncLocalStorage } from 'node:async_hooks'
import { UiDriver } from 'hdckit'
import types from 'licia/types'

// UiDriver owns its private callback. Track only registrations made by its
// capture-start async chain, using public Emitter methods, without clearing
// unrelated listeners or changing the dependency's private state.
const registration = new AsyncLocalStorage<{
  driver: CaptureUiDriver
  scope: CaptureScope
}>()

export class CaptureScope {
  active = true
  private listeners: Array<{ driver: CaptureUiDriver; listener: types.AnyFn }> =
    []
  constructor(private receive?: (image: Buffer) => void) {}
  deliver = (image: Buffer) => this.receive?.(image)
  track(driver: CaptureUiDriver, listener: types.AnyFn) {
    this.listeners.push({ driver, listener })
  }
  dispose() {
    this.active = false
    // The dependency may retain its private callback until stop succeeds.
    // Release its route to the renderer immediately, including pending starts.
    this.receive = undefined
    for (const { driver, listener } of this.listeners) {
      driver.off('message', listener)
    }
    this.listeners = []
  }
}

export class CaptureUiDriver extends UiDriver {
  on(event: string, listener: types.AnyFn): this {
    const current = registration.getStore()
    if (event === 'message' && current?.driver === this) {
      if (!current.scope.active) return this
      current.scope.track(this, listener)
    }
    super.on(event, listener)
    return this
  }
  startOwnedCapture(scope: CaptureScope, scale: number) {
    return registration.run({ driver: this, scope }, () =>
      super.startCaptureScreen(scope.deliver, { scale }),
    )
  }
}
