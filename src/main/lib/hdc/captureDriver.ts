import { AsyncLocalStorage } from 'node:async_hooks'
import { UiDriver } from 'hdckit'
import types from 'licia/types'
import type { CaptureFrameMetadata } from 'common/types'
import type { NativeVideo } from './nativeVideo'
import type { ControlRecovery } from './controlRecovery'

export function isControlRecoveryError(error: unknown) {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error.code === 'UITEST_TRANSPORT' || error.code === 'UITEST_SDK_UPDATE_REQUIRED')
}

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
  protected allowDaemonRestart = false
  nativeVideo?: NativeVideo
  controlRecovery?: ControlRecovery
  private nativeActive = false
  private jpegCaptureAttempted = false
  private capture?: { scope: CaptureScope; scale: number; videoReceived: boolean }
  private promotion?: {
    scope: CaptureScope; id: number; active: boolean; task: Promise<boolean>; settled?: Promise<boolean>; finish?: Promise<void>
  }
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
    try {
      await this.controlRecovery?.remember()
      try { await this.getDisplaySize() }
      catch (error) {
        // Background setup never interrupts another tool. Foreground setup
        // uses the same recorded-process guard as a cached driver's recovery.
        if (background || !isControlRecoveryError(error) || !this.controlRecovery) throw error
        await this.recoverControl()
        return
      }
      await this.controlRecovery?.remember()
    } catch (error) {
      // A failed identity read must not orphan a live, uncached connection.
      this.closeControlConnection()
      throw error
    }
  }
  async recoverControl() {
    if (!this.controlRecovery) throw new Error('Control recovery is unavailable')
    // Finish/cancel any promotion before touching its process. Native cleanup
    // must still be confirmed even when the separate control daemon is sick.
    if (this.promotion) {
      this.promotion.active = false
      await (this.promotion.settled || this.promotion.task).catch(() => {})
      await this.promotion.finish?.catch(() => {})
    }
    await this.nativeVideo?.stop()
    if (this.nativeVideo && !await this.nativeVideo.available()) {
      throw new Error('Control recovery blocked by another native capture')
    }
    this.closeControlConnection()
    await this.controlRecovery.reset()
    this.clearStoppedCapture()
    this.nativeActive = false
    this.jpegCaptureAttempted = false
    this.promotion = undefined
    this.capture = undefined
    // Exactly one reset, never the broad initial-setup fallback a second time.
    await this.initializeControl(true)
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
    const capture = this.capture = { scope, scale, videoReceived: false }
    const startJpeg = () => {
      this.jpegCaptureAttempted = true
      return registration.run({ driver: this, scope }, () =>
        super.startCaptureScreen(image => {
          if (!capture.videoReceived) scope.deliver(image)
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
          if (!metadata.config) capture.videoReceived = true
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
  retryCaptureVideo(scope: CaptureScope, id: number): Promise<boolean> {
    const capture = this.capture
    if (!this.nativeVideo || this.nativeActive || this.promotion || !this.jpegCaptureAttempted ||
      capture?.scope !== scope || !scope.active) return Promise.resolve(false)
    const promotion = { scope, id, active: true, task: Promise.resolve(false) } as NonNullable<CaptureUiDriver['promotion']>
    this.promotion = promotion
    this.nativeActive = true
    promotion.task = this.nativeVideo.start(capture.scale, ({ data, ...metadata }) => {
      if (promotion.active && scope.active) scope.deliver(data, { codec: 'h264', ...metadata, promotion: id })
    }, () => {
      if (promotion.active && scope.active) scope.deliver(Buffer.alloc(0), { codec: 'error', promotion: id })
    })
    // Keep live JPEG until the renderer acknowledges an actually painted frame.
    // Never hold the device input queue while waiting for the encoder.
    promotion.settled = promotion.task.then(async started => {
      if (!started) await this.finishCaptureVideo(scope, id, false)
      return started
    }, async error => {
      await this.finishCaptureVideo(scope, id, false)
      throw error
    })
    return promotion.settled
  }
  finishCaptureVideo(scope: CaptureScope, id: number, commit: boolean): Promise<void> {
    const promotion = this.promotion
    if (!promotion || promotion.scope !== scope || promotion.id !== id) return Promise.resolve()
    if (promotion.finish) return promotion.finish
    if (!commit) promotion.active = false
    promotion.finish = (async () => {
      const started = await promotion.task.catch(() => false)
      if (commit && started && scope.active && this.capture?.scope === scope) {
        this.capture.videoReceived = true
        await super.stopCaptureScreen()
        this.jpegCaptureAttempted = false
      } else {
        promotion.active = false
        await this.nativeVideo!.stop()
        this.nativeActive = false
        if (this.promotion === promotion) this.promotion = undefined
      }
    })()
    return promotion.finish
  }
  async stopCaptureScreen() {
    this.capture = undefined
    const promotion = this.promotion
    if (promotion) {
      promotion.active = false
      await (promotion.settled || promotion.task).catch(() => {})
      await promotion.finish?.catch(() => {})
    }
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
    this.promotion = undefined
  }
}
