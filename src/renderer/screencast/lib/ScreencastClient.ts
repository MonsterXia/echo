import types from 'licia/types'
import noop from 'licia/noop'
import Readiness from 'licia/Readiness'
import { loadImage } from './util'
import clamp from 'licia/clamp'
import store from '../store'
import H264Decoder from './H264Decoder'
import type { CaptureFrameMetadata } from 'common/types'

export default class ScreencastClient {
  canvas = document.createElement('canvas')
  ctx = this.canvas.getContext('2d')!
  ready: Promise<void>
  private connectKey: string
  private offCaptureScreen: types.AnyFn = noop
  private offPointerEvents: types.AnyFn = noop
  private destroyed = false
  private generation = 0
  private captureTask: Promise<void> = Promise.resolve()
  private sessionId?: string
  private sessionPromise?: Promise<string>
  private sessionReleased = false
  private retryTimer?: ReturnType<typeof setTimeout>
  private frameReceived = false
  private videoReceived = false
  private acceptingFrames = false
  private imageAbort = new AbortController()
  private readiness = new Readiness()
  private isTouching = false
  private isDrawing = false
  private pendingFrame?: Uint8Array
  private pendingVideoFrame?: { frame: VideoFrame; generation: number }
  private videoDecoder?: H264Decoder
  private preferVideo = true
  private videoRecoveryAttempted = false
  private renderedCodec: 'H.264' | 'JPEG' | null = null
  private renderedFrames = 0
  private displaySize: { width: number; height: number } | null = null
  constructor(connectKey: string) {
    this.connectKey = connectKey
    this.ready = this.readiness.ready('captureScreen')

    this.bindEvent()
    this.start()
  }
  start() {
    if (this.destroyed) {
      return this.captureTask
    }
    const generation = ++this.generation
    this.renderedCodec = null
    this.renderedFrames = 0
    this.clearRetry()
    this.imageAbort.abort()
    this.imageAbort = new AbortController()
    this.frameReceived = false
    this.videoReceived = false
    this.acceptingFrames = false
    this.pendingFrame = undefined
    this.resetVideo()
    // This queue coalesces local scale changes. The main process owns device
    // serialization across all clients and renderer lifetimes.
    return this.queueCapture(async () => {
      if (!this.isCurrent(generation)) return
      try {
        const sessionId = await this.getSession()
        if (!this.isCurrent(generation)) return
        this.acceptingFrames = true
        await main.startCaptureScreen(sessionId, store.scale, generation,
          this.preferVideo && typeof VideoDecoder !== 'undefined')
      } catch (error) {
        console.error(error)
        if (this.isCurrent(generation)) {
          this.acceptingFrames = false
          this.frameReceived = false
          this.pendingFrame = undefined
          this.resetVideo()
          this.imageAbort.abort()
        }
      }
      if (this.isCurrent(generation) && !this.frameReceived) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined
          if (this.isCurrent(generation)) {
            // SPS/PPS alone does not prove that this device can produce a
            // usable picture. Avoid retrying an unusable video mode forever.
            if (this.videoReceived) this.preferVideo = false
            this.start()
          }
        }, 5000)
      }
    })
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.renderedCodec = null
    this.renderedFrames = 0
    this.pendingFrame = undefined
    this.resetVideo()
    this.clearRetry()
    this.imageAbort.abort()
    this.offCaptureScreen()
    this.offPointerEvents()
    this.isTouching = false
    this.displaySize = null
    this.releaseSession()
  }
  getCaptureStats() {
    return { codec: this.renderedCodec, frames: this.renderedFrames, generation: this.generation }
  }
  private getSession() {
    if (!this.sessionPromise) {
      this.sessionPromise = main.createCaptureSession(this.connectKey).then(
        (id) => {
          this.sessionId = id
          if (this.destroyed) this.releaseSession()
          return id
        },
        (error) => {
          this.sessionPromise = undefined
          throw error
        },
      )
    }
    return this.sessionPromise
  }
  private releaseSession() {
    if (!this.sessionId || this.sessionReleased) return
    this.sessionReleased = true
    // Send immediately even while start is pending, so main can detach locally.
    // It still waits for that start before sending the device stop command.
    void main.stopCaptureScreen(this.sessionId).catch(console.error)
  }
  private queueCapture(operation: () => Promise<void>) {
    const task = this.captureTask.then(operation).catch(console.error)
    this.captureTask = task
    return task
  }
  private isCurrent(generation: number) {
    return !this.destroyed && generation === this.generation
  }
  private clearRetry() {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }
  private drawPendingFrame() {
    if (this.isDrawing) return
    const video = this.pendingVideoFrame
    if (video) {
      this.pendingVideoFrame = undefined
      this.isDrawing = true
      this.paint(video.frame, video.frame.displayWidth, video.frame.displayHeight, video.generation, 'H.264')
        .catch(console.error)
        .finally(() => {
          video.frame.close()
          this.isDrawing = false
          this.drawPendingFrame()
        })
      return
    }
    if (!this.pendingFrame) return
    const image = this.pendingFrame
    this.pendingFrame = undefined
    this.isDrawing = true
    this.draw(image)
      .catch(console.error)
      .finally(() => {
        this.isDrawing = false
        this.drawPendingFrame()
      })
  }
  private resetVideo() {
    this.videoDecoder?.destroy()
    this.videoDecoder = undefined
    this.pendingVideoFrame?.frame.close()
    this.pendingVideoFrame = undefined
  }
  private videoFrame(image: Uint8Array, metadata: CaptureFrameMetadata) {
    this.videoReceived = true
    const generation = this.generation
    const fail = () => {
      if (!this.isCurrent(generation) || !this.preferVideo) return
      console.error('Native video failed; restarting in JPEG compatibility mode')
      this.preferVideo = false
      this.start()
    }
    if (metadata.codec === 'error') {
      // Transport loss is not proof that H.264 is unsupported. Retry through
      // the owned capture queue once per client; repeated failures still fall
      // back, without an endless loop between native and JPEG capture.
      if (!this.videoRecoveryAttempted && this.preferVideo) {
        this.videoRecoveryAttempted = true
        console.warn('Native video stream interrupted; retrying H.264 once')
        this.start()
      } else fail()
      return
    }
    if (!this.videoDecoder) {
      this.videoDecoder = new H264Decoder((frame) => {
        if (!this.isCurrent(generation) || !this.acceptingFrames) { frame.close(); return }
        this.pendingVideoFrame?.frame.close()
        this.pendingVideoFrame = { frame, generation }
        this.drawPendingFrame()
      }, fail)
    }
    this.videoDecoder.push(image, { ...metadata, timestamp: metadata.timestamp || 0 })
  }
  private async draw(image: Uint8Array) {
    const generation = this.generation
    if (!this.isCurrent(generation)) return
    const blob = new Blob([image], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)
    const signal = this.imageAbort.signal
    let img: HTMLImageElement
    try {
      img = await loadImage(url, signal)
    } catch (error) {
      if (!signal.aborted) throw error
      return
    } finally {
      URL.revokeObjectURL(url)
    }
    await this.paint(img, img.naturalWidth, img.naturalHeight, generation, 'JPEG')
  }
  private async paint(img: CanvasImageSource, width: number, height: number, generation: number, codec: 'H.264' | 'JPEG') {
    if (!this.isCurrent(generation) || !this.acceptingFrames) return
    const { canvas, ctx } = this
    if (
      !this.displaySize ||
      canvas.width !== width ||
      canvas.height !== height
    ) {
      // Capture dimensions may be reduced by the device even at scale=1.
      // Read the touch coordinate space again when the frame size changes
      // (for example, after rotating the device).
      const size = await main.getDisplaySize(this.connectKey)
      if (!this.isCurrent(generation) || !this.acceptingFrames) return
      if (
        !Number.isInteger(size.width) ||
        !Number.isInteger(size.height) ||
        size.width <= 0 ||
        size.height <= 0
      ) {
        return
      }
      this.displaySize = size
    }
    if (canvas.width !== width) {
      canvas.width = width
    }
    if (canvas.height !== height) {
      canvas.height = height
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    this.renderedCodec = codec
    this.renderedFrames++
    this.frameReceived = true
    this.clearRetry()
    this.readiness.signal('captureScreen')
  }
  private getPointer(e: PointerEvent) {
    const { canvas, displaySize } = this
    if (!displaySize) {
      return null
    }
    const { clientX, clientY } = e

    const screenWidth = canvas.width
    const screenHeight = canvas.height

    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }

    const canvasRect = {
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    }
    if (screenWidth / screenHeight < rect.width / rect.height) {
      canvasRect.height = rect.height
      canvasRect.width = canvasRect.height * (screenWidth / screenHeight)
      canvasRect.x = rect.x + (rect.width - canvasRect.width) / 2
      canvasRect.y = rect.y
    } else {
      canvasRect.width = rect.width
      canvasRect.height = canvasRect.width * (screenHeight / screenWidth)
      canvasRect.x = rect.x
      canvasRect.y = rect.y + (rect.height - canvasRect.height) / 2
    }

    const percentageX = clamp((clientX - canvasRect.x) / canvasRect.width, 0, 1)
    const percentageY = clamp(
      (clientY - canvasRect.y) / canvasRect.height,
      0,
      1,
    )

    const pointerX = Math.min(
      Math.round(percentageX * displaySize.width),
      displaySize.width - 1,
    )
    const pointerY = Math.min(
      Math.round(percentageY * displaySize.height),
      displaySize.height - 1,
    )

    return { pointerX, pointerY }
  }
  private bindEvent() {
    const { canvas } = this

    this.offCaptureScreen = main.on(
      'captureScreen',
      (sessionId, generation, image, metadata?: CaptureFrameMetadata) => {
        if (
          !this.destroyed &&
          this.acceptingFrames &&
          sessionId === this.sessionId &&
          generation === this.generation
        ) {
          if (metadata) {
            this.videoFrame(image, metadata)
            return
          }
          // Keep one latest frame while decoding. Bursts must not freeze on
          // their first frame or build an increasingly stale decode queue.
          this.pendingFrame = image
          this.drawPendingFrame()
        }
      },
    )

    const onTouchStart = (e: PointerEvent) => {
      if (this.destroyed) return
      canvas.focus()
      const pointer = this.getPointer(e)
      if (!pointer) {
        return
      }
      const { pointerX, pointerY } = pointer
      main.touchDown(this.connectKey, pointerX, pointerY)
      this.isTouching = true
    }
    const onTouchMove = (e: PointerEvent) => {
      if (!this.isTouching) {
        return
      }
      const pointer = this.getPointer(e)
      if (!pointer) {
        return
      }
      const { pointerX, pointerY } = pointer
      main.touchMove(this.connectKey, pointerX, pointerY)
    }
    const onTouchEnd = (e: PointerEvent) => {
      if (!this.isTouching) {
        return
      }
      this.isTouching = false
      const pointer = this.getPointer(e)
      if (!pointer) {
        return
      }
      const { pointerX, pointerY } = pointer
      main.touchUp(this.connectKey, pointerX, pointerY)
    }
    canvas.addEventListener('pointerdown', onTouchStart)
    canvas.addEventListener('pointermove', onTouchMove)
    canvas.addEventListener('pointerup', onTouchEnd)
    canvas.addEventListener('pointerleave', onTouchEnd)
    this.offPointerEvents = () => {
      canvas.removeEventListener('pointerdown', onTouchStart)
      canvas.removeEventListener('pointermove', onTouchMove)
      canvas.removeEventListener('pointerup', onTouchEnd)
      canvas.removeEventListener('pointerleave', onTouchEnd)
    }
  }
}
