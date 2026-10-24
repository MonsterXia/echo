import {
  ipcMain,
  IpcMainInvokeEvent,
  WebContents,
  WebFrameMain,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { CaptureScope, CaptureUiDriver } from './captureDriver'

interface Owner {
  contents: WebContents
  ready: boolean
  sessions: Set<Session>
}
interface Session {
  id: string
  connectKey: string
  owner?: Owner
  frame?: WebFrameMain
  generation: number
  inputAbort: AbortController
}
interface Lease {
  session: Session
  driver: CaptureUiDriver
  scope: CaptureScope
  touch?: { x: number; y: number }
}
interface Device {
  tail: Promise<void>
  pending: number
  lease?: Lease
  prepared?: { driver: CaptureUiDriver; ready: boolean }
}

let registered: Owner | undefined
const sessions = new Map<string, Session>()
const devices = new Map<string, Device>()

function deviceFor(key: string) {
  let device = devices.get(key)
  if (!device) {
    device = { tail: Promise.resolve(), pending: 0 }
    devices.set(key, device)
  }
  return device
}

function enqueue<T>(key: string, device: Device, operation: () => Promise<T>) {
  device.pending++
  const task = device.tail.then(operation)
  device.tail = task.then(
    () => {},
    () => {},
  )
  void device.tail.then(() => {
    device.pending--
    if (!device.pending && !device.lease && !device.prepared && devices.get(key) === device) {
      devices.delete(key)
    }
  })
  return task
}

async function discardPrepared(device: Device) {
  const prepared = device.prepared
  if (!prepared) return
  prepared.ready = false
  await prepared.driver.discardNativePreparation()
  if (device.prepared === prepared) device.prepared = undefined
}

export function prepareCapture(key: string, scale: number, valid: () => boolean,
  getDriver: (key: string) => Promise<CaptureUiDriver>, available = async () => true) {
  const device = deviceFor(key)
  return enqueue(key, device, async () => {
    if (!valid() || device.lease) return false
    if (device.prepared?.ready) return true
    await discardPrepared(device)
    // Do not initialize/recover the control daemon while another tool owns
    // the video socket. Foreground capture keeps its existing fallback path.
    if (!await available() || !valid()) return false
    const driver = await getDriver(key)
    if (!valid()) return false
    const prepared = { driver, ready: false }
    device.prepared = prepared
    try {
      prepared.ready = await driver.prepareNativeCapture(scale, valid)
      if (!prepared.ready || !valid()) { await discardPrepared(device); return false }
      return true
    } catch (error) {
      await discardPrepared(device)
      throw error
    }
  })
}

export function cancelCapturePreparation(key: string) {
  const device = devices.get(key)
  if (!device) return Promise.resolve()
  if (device.prepared) device.prepared.ready = false
  return enqueue(key, device, () => discardPrepared(device))
}

export async function shutdownCaptures() {
  if (registered) invalidate(registered)
  await Promise.all([...devices].map(([key, device]) => enqueue(key, device, async () => {
    if (device.lease) await stopLease(device, device.lease)
    await discardPrepared(device)
  })))
}

async function stopLease(device: Device, lease: Lease) {
  if (device.lease !== lease) return
  lease.scope.dispose()
  // Cancellation invalidates ordinary queued input, but an already dispatched
  // touchDown may still be held. Cleanup belongs to the lease, not its document.
  // Retain unknown touch state on failure and block a replacement capture.
  if (lease.touch) {
    await lease.driver.touchUp(lease.touch.x, lease.touch.y)
    lease.touch = undefined
  }
  // Do not release the device slot until the actual stop settles successfully.
  // On rejection the detached lease remains as unconfirmed device state.
  await lease.driver.stopCaptureScreen()
  if (device.lease === lease) device.lease = undefined
}

function endSession(session: Session) {
  session.inputAbort.abort()
  session.owner?.sessions.delete(session)
  session.owner = undefined
  session.frame = undefined
  sessions.delete(session.id)
  const device = devices.get(session.connectKey)
  const lease = device?.lease
  if (lease?.session === session) lease.scope.dispose()
  return { device, lease: lease?.session === session ? lease : undefined }
}

function invalidate(owner: Owner) {
  owner.ready = false
  for (const session of [...owner.sessions]) {
    const { device, lease } = endSession(session)
    if (device && lease) {
      void enqueue(session.connectKey, device, () =>
        stopLease(device, lease),
      ).catch(() =>
        console.error('Capture cleanup failed; device stop is unconfirmed'),
      )
    }
  }
}

// Register before loadPage, so even navigation before the first capture IPC is
// observed. In particular, the departing document cannot acquire a new owner
// between navigation start and commit.
export function registerCaptureWindow(contents: WebContents) {
  if (registered) invalidate(registered)
  const owner: Owner = { contents, ready: false, sessions: new Set() }
  registered = owner
  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) invalidate(owner)
  })
  contents.on('did-navigate', () => {
    if (registered === owner && !contents.isDestroyed()) owner.ready = true
  })
  contents.on('render-process-gone', () => invalidate(owner))
  contents.once('destroyed', () => {
    invalidate(owner)
    if (registered === owner) registered = undefined
  })
  return () => invalidate(owner)
}

function sender(event: IpcMainInvokeEvent) {
  const owner = registered
  if (
    !owner ||
    !owner.ready ||
    owner.contents !== event.sender ||
    event.sender.isDestroyed() ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Capture requires the active screencast document')
  }
  return owner
}

function current(session: Session, generation: number) {
  return (
    !!session.owner?.ready &&
    session.owner === registered &&
    session.generation === generation
  )
}

export function withCaptureInput<T>(event: IpcMainInvokeEvent, id: string,
  operation: (connectKey: string, signal: AbortSignal, lease: Lease) => Promise<T>, releaseTouch = false) {
  const owner = sender(event)
  const session = sessions.get(id)
  if (!session || session.owner !== owner || session.frame !== event.senderFrame) {
    throw new Error('Input requires the active capture session')
  }
  const generation = session.generation
  const signal = session.inputAbort.signal
  const device = deviceFor(session.connectKey)
  // Dropping a release under backpressure would leave the device finger held.
  if (device.pending >= 64 && !releaseTouch) throw new Error('Input queue is full')
  return enqueue(session.connectKey, device, async () => {
    const lease = device.lease
    if (!current(session, generation) || lease?.session !== session || !lease.scope.active) {
      throw new Error('Input capture session is no longer active')
    }
    return operation(session.connectKey, signal, lease)
  })
}

export function withCaptureTouch(event: IpcMainInvokeEvent, key: string,
  type: 'touchDown' | 'touchMove' | 'touchUp', x: number, y: number) {
  const owner = sender(event)
  const session = [...owner.sessions].find(session => session.connectKey === key)
  if (!session) throw new Error('Touch requires an active capture session')
  return withCaptureInput(event, session.id, async (_key, signal, lease) => {
    signal.throwIfAborted()
    // Record before dispatch: a timeout does not prove that the device ignored
    // a press or move. Only an acknowledged release clears this obligation.
    if (type === 'touchDown' || lease.touch) lease.touch = { x, y }
    await lease.driver[type](x, y)
    if (type === 'touchUp') lease.touch = undefined
  }, type === 'touchUp')
}

export function initCaptureIpc(
  getUiDriver: (key: string) => Promise<CaptureUiDriver>,
) {
  ipcMain.handle('createCaptureSession', (event, connectKey: string) => {
    const owner = sender(event)
    if (
      typeof connectKey !== 'string' ||
      !connectKey ||
      connectKey.length > 1024
    ) {
      throw new Error('Invalid capture target')
    }
    for (const previous of [...owner.sessions]) {
      if (previous.connectKey !== connectKey) continue
      const { device, lease } = endSession(previous)
      if (device && lease) {
        void enqueue(connectKey, device, () => stopLease(device, lease)).catch(
          () =>
            console.error('Capture cleanup failed; device stop is unconfirmed'),
        )
      }
    }
    const session: Session = {
      id: randomUUID(),
      connectKey,
      owner,
      frame: event.senderFrame!,
      generation: 0,
      inputAbort: new AbortController(),
    }
    sessions.set(session.id, session)
    owner.sessions.add(session)
    return session.id
  })

  ipcMain.handle(
    'startCaptureScreen',
    (event, id: string, scale: number, generation: number, preferVideo = true) => {
      const owner = sender(event)
      const session = sessions.get(id)
      if (
        !session ||
        session.owner !== owner ||
        session.frame !== event.senderFrame
      ) {
        throw new Error('Capture session is no longer active')
      }
      if (
        !Number.isFinite(scale) ||
        scale <= 0 ||
        scale > 1 ||
        typeof preferVideo !== 'boolean' ||
        !Number.isSafeInteger(generation) ||
        generation <= session.generation
      ) {
        throw new Error('Invalid capture scale or generation')
      }
      session.inputAbort.abort()
      session.inputAbort = new AbortController()
      session.generation = generation
      const device = deviceFor(session.connectKey)
      device.lease?.scope.dispose()
      return enqueue(session.connectKey, device, async () => {
        if (!current(session, generation)) return
        const driver = await getUiDriver(session.connectKey)
        if (!current(session, generation)) return
        if (device.prepared && (!device.prepared.ready || device.prepared.driver !== driver)) await discardPrepared(device)
        if (device.lease) await stopLease(device, device.lease)
        else if (!device.prepared) await driver.stopCaptureScreen()
        if (!current(session, generation)) return
        const scope = new CaptureScope((image, metadata) => {
          const activeOwner = session.owner
          if (
            current(session, generation) &&
            activeOwner &&
            !activeOwner.contents.isDestroyed()
          ) {
            if (metadata) session.frame?.send('captureScreen', id, generation, image, metadata)
            else session.frame?.send('captureScreen', id, generation, image)
          }
        })
        const lease = { session, driver, scope }
        device.prepared = undefined // transfer ownership without an async gap
        device.lease = lease
        try {
          await driver.startOwnedCapture(scope, scale, preferVideo)
        } catch (error) {
          scope.dispose()
          try {
            await stopLease(device, lease)
          } catch {
            // Keep the lease: a later attempt must confirm stop before starting.
          }
          throw error
        }
        if (!current(session, generation)) await stopLease(device, lease)
      })
    },
  )

  ipcMain.handle('stopCaptureScreen', (event, id: string) => {
    const owner = sender(event)
    const session = sessions.get(id)
    if (!session) return 'obsolete'
    if (session.owner !== owner || session.frame !== event.senderFrame) {
      throw new Error('Capture session belongs to another document')
    }
    const { device, lease } = endSession(session)
    if (!device) return 'released'
    return enqueue(session.connectKey, device, async () => {
      if (lease) await stopLease(device, lease)
      return lease ? 'stopped' : 'released'
    })
  })

  for (const name of ['retryCaptureVideo', 'finishCaptureVideo'] as const) {
    ipcMain.handle(name, async (event, id: string, generation: number, promotion: number, commit?: boolean) => {
      const owner = sender(event)
      const session = sessions.get(id)
      if (!session || session.owner !== owner || session.frame !== event.senderFrame || !current(session, generation)) {
        throw new Error('Video promotion requires the active capture generation')
      }
      if (!Number.isSafeInteger(promotion) || promotion <= 0 ||
        (name === 'finishCaptureVideo' && typeof commit !== 'boolean')) throw new Error('Invalid video promotion')
      const device = deviceFor(session.connectKey)
      // Queue acquisition only: native startup must not delay touch or keyboard.
      // The driver owns pending work and stop waits for it before releasing lease.
      const result = await enqueue(session.connectKey, device, async () => {
        const lease = device.lease
        if (!current(session, generation) || lease?.session !== session || !lease.scope.active) {
          throw new Error('Video promotion requires an active capture')
        }
        const task = name === 'retryCaptureVideo'
          ? lease.driver.retryCaptureVideo(lease.scope, promotion)
          : lease.driver.finishCaptureVideo(lease.scope, promotion, commit!)
        // Attach a rejection observer before returning the non-awaiting wrapper.
        void task.catch(() => {})
        return { task }
      })
      return result.task
    })
  }
}
