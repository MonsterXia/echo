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
    // A cached driver's control connection may have closed since last use.
    await this.initializeControl(true)
    if (!valid()) return false
    return this.nativeVideo.prepare(scale, valid)
  }
  async discardNativePreparation() {
    if (!this.nativeActive) await this.nativeVideo?.stop()
  }
  async initializeControl(background = false) {
    // UiDriver checks the agent version and handshakes before this read-only
    // query. Reuse a healthy daemon left by the previous application process.
    this.allowDaemonRestart = !background
    try { await this.getDisplaySize() }
    catch (error) {
      // Background selection is not permission to interrupt another tool's
      // control-only UITest session (which has no video socket to detect).
      if (background) throw error
      // Recovery is confined to initial control setup, before video ownership.
      // Never replay input or restart a daemon from an active session timeout.
      await this.stop()
      await this.getDisplaySize()
    } finally {
      this.allowDaemonRestart = true
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
    let videoReceived = false
    const startJpeg = () => {
      this.jpegCaptureAttempted = true
      return registration.run({ driver: this, scope }, () =>
        super.startCaptureScreen(image => {
          if (!videoReceived) scope.deliver(image)
        }, { scale }),
      )
    }
    if (preferVideo && this.nativeVideo) {
      // Bootstrap UITest's control server before the native extension is up.
      // The old preflight stop did this incidentally; a read-only query does
      // not depend on an idle JPEG capture acknowledging a stop request.
      await this.getDisplaySize()
      // Static displays may not produce an encoded frame until they change.
      // Show the real screen immediately while native startup is in flight.
      let previewError: unknown
      try { await startJpeg() }
      catch (error) { previewError = error; console.error('JPEG startup preview failed:', error) }
      this.nativeActive = true
      const started = await this.nativeVideo.start(scale,
        ({ data, ...metadata }) => {
          if (!metadata.config) videoReceived = true
          scope.deliver(data, { codec: 'h264', ...metadata })
        },
        (error) => {
          console.error('Native video stream interrupted:', error)
          scope.deliver(Buffer.alloc(0), { codec: 'error' })
        },
      )
      if (started) {
        await super.stopCaptureScreen()
        this.jpegCaptureAttempted = false
        return
      }
      this.nativeActive = false
      console.error('Native video unavailable; using JPEG compatibility capture')
      await this.discardNativePreparation()
      if (previewError) throw previewError
      return // Keep the preview's live JPEG capture, without a second start.
    }
    // A failed start can still have reached the device; only a confirmed stop
    // clears this flag. Native-only sessions never need a JPEG stop command.
    await this.discardNativePreparation()
    return startJpeg()
  }
  async stopCaptureScreen() {
    let failure: unknown
    if (this.nativeActive) {
      try { await this.nativeVideo!.stop(); this.nativeActive = false }
      catch (error) { failure = error }
    }
    if (!this.nativeVideo || this.jpegCaptureAttempted) {
      try { await super.stopCaptureScreen(); this.jpegCaptureAttempted = false }
      catch (error) { failure ??= error }
    }
    if (failure) throw failure
  }
}
