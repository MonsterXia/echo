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
}
interface Lease {
  session: Session
  driver: CaptureUiDriver
  scope: CaptureScope
}
interface Device {
  tail: Promise<void>
  pending: number
  lease?: Lease
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
    if (!device.pending && !device.lease && devices.get(key) === device) {
      devices.delete(key)
    }
  })
  return task
}

async function stopLease(device: Device, lease: Lease) {
  if (device.lease !== lease) return
  lease.scope.dispose()
  // Do not release the device slot until the actual stop settles successfully.
  // On rejection the detached lease remains as unconfirmed device state.
  await lease.driver.stopCaptureScreen()
  if (device.lease === lease) device.lease = undefined
}

function endSession(session: Session) {
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
    }
    sessions.set(session.id, session)
    owner.sessions.add(session)
    return session.id
  })

  ipcMain.handle(
    'startCaptureScreen',
    (event, id: string, scale: number, generation: number) => {
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
        !Number.isSafeInteger(generation) ||
        generation <= session.generation
      ) {
        throw new Error('Invalid capture scale or generation')
      }
      session.generation = generation
      const device = deviceFor(session.connectKey)
      device.lease?.scope.dispose()
      return enqueue(session.connectKey, device, async () => {
        if (!current(session, generation)) return
        const driver = await getUiDriver(session.connectKey)
        if (!current(session, generation)) return
        if (device.lease) await stopLease(device, device.lease)
        else await driver.stopCaptureScreen()
        if (!current(session, generation)) return
        const scope = new CaptureScope((image) => {
          const activeOwner = session.owner
          if (
            current(session, generation) &&
            activeOwner &&
            !activeOwner.contents.isDestroyed()
          ) {
            session.frame?.send('captureScreen', id, generation, image)
          }
        })
        const lease = { session, driver, scope }
        device.lease = lease
        try {
          await driver.startOwnedCapture(scope, scale)
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
}
