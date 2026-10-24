import { AsyncLocalStorage } from 'node:async_hooks'
import { UiDriver } from 'hdckit'
import types from 'licia/types'
import type { CaptureFrameMetadata } from 'common/types'
import type { NativeVideo } from './nativeVideo'

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
  constructor(private receive?: (image: Buffer, metadata?: CaptureFrameMetadata) => void) {}
  deliver = (image: Buffer, metadata?: CaptureFrameMetadata) => this.receive?.(image, metadata)
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
  nativeVideo?: NativeVideo
  private nativeActive = false
  private jpegCaptureAttempted = false
  async prepareNativeCapture(scale: number, valid: () => boolean) {
    if (!this.nativeVideo || !valid()) return false
    await this.getDisplaySize()
    if (!valid()) return false
    return this.nativeVideo.prepare(scale, valid)
  }
  async discardNativePreparation() {
    if (!this.nativeActive) await this.nativeVideo?.stop()
  }
  async initializeControl() {
    // UiDriver checks the agent version and handshakes before this read-only
    // query. Reuse a healthy daemon left by the previous application process.
    try { await this.getDisplaySize() }
    catch {
      // Recovery is confined to initial control setup, before video ownership.
      // Never replay input or restart a daemon from an active session timeout.
      await this.stop()
      await this.getDisplaySize()
    }
  }
  on(event: string, listener: types.AnyFn): this {
    const current = registration.getStore()
    if (event === 'message' && current?.driver === this) {
      if (!current.scope.active) return this
      current.scope.track(this, listener)
    }
    super.on(event, listener)
    return this
  }
  async startOwnedCapture(scope: CaptureScope, scale: number, preferVideo = true) {
    if (preferVideo && this.nativeVideo) {
      // Bootstrap UITest's control server before the native extension is up.
      // The old preflight stop did this incidentally; a read-only query does
      // not depend on an idle JPEG capture acknowledging a stop request.
      await this.getDisplaySize()
      this.nativeActive = true
      const started = await this.nativeVideo.start(scale,
        ({ data, ...metadata }) => scope.deliver(data, { codec: 'h264', ...metadata }),
        (error) => {
          console.error('Native video stream interrupted:', error)
          scope.deliver(Buffer.alloc(0), { codec: 'error' })
        },
      )
      if (started) return
      this.nativeActive = false
      console.error('Native video unavailable; using JPEG compatibility capture')
    }
    // A failed start can still have reached the device; only a confirmed stop
    // clears this flag. Native-only sessions never need a JPEG stop command.
    await this.discardNativePreparation()
    this.jpegCaptureAttempted = true
    return registration.run({ driver: this, scope }, () =>
      super.startCaptureScreen(scope.deliver, { scale }),
    )
  }
  async stopCaptureScreen() {
    if (this.nativeActive) {
      await this.nativeVideo!.stop()
      this.nativeActive = false
    } else if (!this.nativeVideo || this.jpegCaptureAttempted) {
      await super.stopCaptureScreen()
      this.jpegCaptureAttempted = false
    }
  }
}
