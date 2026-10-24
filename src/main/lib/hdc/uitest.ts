import { Client } from 'hdckit'
import { ipcMain } from 'electron'
import each from 'licia/each'
import {
  IpcDumpWindowHierarchy,
  IpcGetDisplaySize,
} from 'common/types'
import { getTargetStore, setTargetStore } from './base'
import { getUserDataPath, handleEvent, resolveResources } from 'share/main/lib/util'
import { CaptureUiDriver } from './captureDriver'
import { initCaptureIpc, prepareCapture, withCaptureInput, withCaptureTouch } from './captureSessions'
import { sendScreencastInput, validateScreencastInput } from './screencastInput'
export { cancelCapturePreparation, shutdownCaptures } from './captureSessions'
import { NativeVideo } from './nativeVideo'

let client: Client

const initializingDrivers = new Map<string, Promise<CaptureUiDriver>>()

function nativeOptions(connectKey: string) {
  return {
    ...client.options, connectKey,
    resourcesDir: resolveResources('native-video'),
    cacheDir: getUserDataPath('data/native-video'),
  }
}

export function prepareTarget(connectKey: string, scale: number, valid: () => boolean) {
  return prepareCapture(connectKey, scale, valid, key => getUiDriver(key, true),
    () => new NativeVideo(nativeOptions(connectKey)).available())
}

async function getUiDriver(connectKey: string, background = false): Promise<CaptureUiDriver> {
  let uiDriver = getTargetStore(connectKey, 'uiDriver')
  if (uiDriver) return uiDriver
  const pending = initializingDrivers.get(connectKey)
  if (pending) return pending
  const initializing = (async () => {
    const target = await client.getTarget(connectKey)
    uiDriver = new CaptureUiDriver(
      target,
      resolveResources('uitestkit_sdk/uitest_agent_v1.1.0.so'),
      '1.1.0',
    )
    await uiDriver.initializeControl(background)
    uiDriver.nativeVideo = new NativeVideo(nativeOptions(connectKey))
    setTargetStore(connectKey, 'uiDriver', uiDriver)
    return uiDriver
  })()
  initializingDrivers.set(connectKey, initializing)
  try {
    return await initializing
  } finally {
    if (initializingDrivers.get(connectKey) === initializing) {
      initializingDrivers.delete(connectKey)
    }
  }
}

const dumpWindowHierarchy: IpcDumpWindowHierarchy = async function (
  connectKey,
) {
  const uiDriver = await getUiDriver(connectKey)
  const layout = await uiDriver.captureLayout()
  return toHierarchyXml(layout)
}

function toHierarchyXml(json: any) {
  const { attributes, children } = json
  let xml = ''

  const tagName = attributes.type
  delete attributes.type
  xml += `<${tagName || 'Layout'}`
  each(attributes, (val, key) => {
    xml += ` ${key}="${val}"`
  })
  xml += '>'

  each(children, (child) => {
    xml += toHierarchyXml(child)
  })

  return xml + `</${tagName || 'Layout'}>`
}

const getDisplaySize: IpcGetDisplaySize = async function (connectKey) {
  const uiDriver = await getUiDriver(connectKey)
  return uiDriver.getDisplaySize()
}

export function init(c: Client) {
  client = c

  handleEvent('dumpWindowHierarchy', dumpWindowHierarchy)
  handleEvent('getDisplaySize', getDisplaySize)
  initCaptureIpc(getUiDriver)
  for (const channel of ['touchDown', 'touchMove', 'touchUp'] as const) {
    ipcMain.handle(channel, (event, key, x, y) => {
      if (![x, y].every(value => Number.isInteger(value) && value >= 0 && value <= 16384)) {
        throw new Error('Invalid touch coordinates')
      }
      return withCaptureTouch(event, key, channel, x, y)
    })
  }
  // Input contents must not be recorded by the generic handleEvent logger.
  ipcMain.handle('screencastInput', (event, id, action) => {
    validateScreencastInput(action)
    return withCaptureInput(event, id, (key, signal) => sendScreencastInput(key, action, client.options, signal))
  })
}
