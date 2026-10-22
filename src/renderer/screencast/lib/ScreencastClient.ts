import types from 'licia/types'
import noop from 'licia/noop'
import Readiness from 'licia/Readiness'
import { loadImage } from './util'
import clamp from 'licia/clamp'
import store from '../store'

export default class ScreencastClient {
  private static captureTasks = new Map<string, Promise<void>>()
  canvas = document.createElement('canvas')
  ctx = this.canvas.getContext('2d')!
  ready: Promise<void>
  private connectKey: string
  private offCaptureScreen: types.AnyFn = noop
  private offPointerEvents: types.AnyFn = noop
  private destroyed = false
  private generation = 0
  private captureTask: Promise<void> = Promise.resolve()
  private retryTimer?: ReturnType<typeof setTimeout>
  private frameReceived = false
  private acceptingFrames = false
  private imageAbort = new AbortController()
  private readiness = new Readiness()
  private isTouching = false
  private isDrawing = false
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
    this.clearRetry()
    this.imageAbort.abort()
    this.imageAbort = new AbortController()
    this.frameReceived = false
    this.acceptingFrames = false
    // Scale changes and retries share a queue: a late start must finish before
    // the next stop/start (or final stop) can run.
    return this.queueCapture(async () => {
      if (!this.isCurrent(generation)) return
      try {
        await main.stopCaptureScreen(this.connectKey)
        if (!this.isCurrent(generation)) return
        this.acceptingFrames = true
        await main.startCaptureScreen(this.connectKey, store.scale)
      } catch (error) {
        console.error(error)
        if (this.isCurrent(generation)) {
          this.acceptingFrames = false
          this.frameReceived = false
          this.imageAbort.abort()
        }
      }
      if (this.isCurrent(generation) && !this.frameReceived) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined
          if (this.isCurrent(generation)) this.start()
        }, 5000)
      }
    })
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.clearRetry()
    this.imageAbort.abort()
    this.offCaptureScreen()
    this.offPointerEvents()
    this.isTouching = false
    this.displaySize = null
    this.queueCapture(() => main.stopCaptureScreen(this.connectKey))
  }
  private queueCapture(operation: () => Promise<void>) {
    // A replacement client for the same target must wait for the old final
    // stop. Different targets remain independent; completed queues are removed.
    const tasks = ScreencastClient.captureTasks
    const previous = tasks.get(this.connectKey) || Promise.resolve()
    const task = previous.then(operation).catch(console.error)
    tasks.set(this.connectKey, task)
    task.then(() => {
      if (tasks.get(this.connectKey) === task) tasks.delete(this.connectKey)
    })
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
  private async draw(image: Uint8Array) {
    const generation = this.generation
    if (!this.isCurrent(generation)) return
    const { canvas, ctx } = this
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
    if (!this.isCurrent(generation) || !this.acceptingFrames) return
    const width = img.naturalWidth
    const height = img.naturalHeight
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
      1
    )

    const pointerX = Math.min(
      Math.round(percentageX * displaySize.width),
      displaySize.width - 1
    )
    const pointerY = Math.min(
      Math.round(percentageY * displaySize.height),
      displaySize.height - 1
    )

    return { pointerX, pointerY }
  }
  private bindEvent() {
    const { canvas } = this

    this.offCaptureScreen = main.on('captureScreen', (connectKey, image) => {
      if (
        !this.destroyed &&
        this.acceptingFrames &&
        connectKey === this.connectKey &&
        !this.isDrawing
      ) {
        // Do not let a later frame overtake a pending display-size lookup.
        this.isDrawing = true
        this.draw(image)
          .catch(console.error)
          .finally(() => (this.isDrawing = false))
      }
    })

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
