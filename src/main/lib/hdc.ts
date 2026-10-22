import {
  IpcGetOverview,
  IpcGetTargets,
  IpcInputKey,
  IpcScreencap,
  ITarget,
} from 'common/types'
import { handleEvent, resolveResources } from 'share/main/lib/util'
import Hdc, { Client } from 'hdckit'
import log from 'share/common/log'
import startWith from 'licia/startWith'
import trim from 'licia/trim'
import os from 'node:os'
import { shell } from './hdc/base'
import * as shellHdc from './hdc/shell'
import * as base from './hdc/base'
import * as bundle from './hdc/bundle'
import * as port from './hdc/port'
import * as webview from './hdc/webview'
import * as uitest from './hdc/uitest'
import * as hilog from './hdc/hilog'
import fs from 'fs-extra'
import path from 'node:path'
import isWindows from 'licia/isWindows'
import isStrBlank from 'licia/isStrBlank'
import { getSettingsStore } from './store'
import { app } from 'electron'
import * as window from 'share/main/lib/window'
import isMac from 'licia/isMac'
import childProcess from 'node:child_process'

const logger = log('hdc')

const settingsStore = getSettingsStore()

let client: Client

const getTargets: IpcGetTargets = async function () {
  let connectKeys: string[]
  try {
    connectKeys = await client.listTargets()
  } catch (error) {
    logger.error('Failed to list HDC targets', error)
    return []
  }

  if (connectKeys.length === 0) {
    logger.info('No HDC targets connected')
    return []
  }

  const results = await Promise.all(
    connectKeys.map(async (connectKey) => {
      try {
        const parameters = await client.getTarget(connectKey).getParameters()
        const softwareVersion = parameters['const.product.software.version']
        // Accept bare versions and product prefixes; a build suffix is optional.
        const ohosVersion =
          parameterString(softwareVersion).match(
            /(?:^|\s)(\d+(?:\.\d+)+)(?=\s|\(|$)/
          )?.[1] || ''
        if (!ohosVersion) {
          logger.warn(
            'Missing or unrecognized software version',
            connectKey,
            softwareVersion
          )
        }

        return {
          name: parameterString(parameters['const.product.name']) || connectKey,
          key: connectKey,
          ohosVersion,
          sdkVersion: parameterString(parameters['const.ohos.apiversion']),
        }
      } catch (error) {
        logger.warn('Failed to read HDC target parameters', connectKey, error)
        return null
      }
    })
  )
  const targets = results.filter((target): target is ITarget => target !== null)
  if (targets.length === 0) {
    logger.warn('No HDC target parameters could be read', connectKeys.length)
  }
  return targets
}

function parameterString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const getOverview: IpcGetOverview = async function (connectKey) {
  const target = client.getTarget(connectKey)

  const parameters = await target.getParameters()
  const [deviceInfo, kernelVersion] = await shell(connectKey, [
    'SP_daemon -deviceinfo',
    'uname -a',
  ])

  return {
    name: parameters['const.product.name'],
    brand: parameters['const.product.brand'],
    model: parameters['const.product.model'],
    abi: parameters['const.product.cpu.abilist'],
    serialNum: getPropValue('sn', deviceInfo),
    kernelVersion: kernelVersion.slice(0, kernelVersion.indexOf('#')),
    processor: getPropValue('deviceTypeName', deviceInfo),
    ...(await getMemory(connectKey)),
    ...(await getScreen(connectKey)),
  }
}

async function getScreen(connectKey: string) {
  const screen = await shell(connectKey, 'hidumper -s RenderService -a screen')

  let physicalResolution = ''
  let physicalResolutionMatch = screen.match(
    /physical screen resolution: ((\d+)x(\d+))/
  )
  if (!physicalResolutionMatch) {
    // For OpenHarmony 6.x
    physicalResolutionMatch = screen.match(/physical resolution=((\d+)x(\d+))/)
  }
  if (physicalResolutionMatch) {
    physicalResolution = physicalResolutionMatch[1]
  }

  return {
    physicalResolution,
  }
}

async function getMemory(connectKey: string) {
  const memInfo = await shell(connectKey, 'cat /proc/meminfo')
  let memTotal = 0
  let memFree = 0

  const totalMatch = getPropValue('MemTotal', memInfo)
  let freeMatch = getPropValue('MemAvailable', memInfo)
  if (!freeMatch) {
    freeMatch = getPropValue('MemFree', memInfo)
  }
  if (totalMatch && freeMatch) {
    memTotal = parseInt(totalMatch, 10) * 1024
    memFree = parseInt(freeMatch, 10) * 1024
  }

  return {
    memTotal,
    memUsed: memTotal - memFree,
  }
}

function getPropValue(key: string, str: string) {
  const lines = str.split('\n')
  for (let i = 0, len = lines.length; i < len; i++) {
    const line = trim(lines[i])
    if (startWith(line, key)) {
      return trim(line.replace(/.*:/, ''))
    }
  }

  return ''
}

const inputKey: IpcInputKey = async function (connectKey, keyCode) {
  await shell(connectKey, `uinput -K -d ${keyCode} -u ${keyCode}`)
}

const screencap: IpcScreencap = async function (connectKey) {
  const name = 'echo_screen.jpeg'
  const p = `/data/local/tmp/${name}`
  await shell(connectKey, [`rm -r ${p}`, `snapshot_display -i 0 -f ${p}`])

  const target = client.getTarget(connectKey)
  const dest = path.resolve(os.tmpdir(), name)
  await target.recvFile(p, dest)
  const buf = await fs.readFile(dest)

  return buf.toString('base64')
}

async function openHdcCli() {
  let cwd = resolveResources('hdc')
  const hdcPath = settingsStore.get('hdcPath')
  if (!isStrBlank(hdcPath) && fs.existsSync(hdcPath)) {
    cwd = path.dirname(hdcPath)
  }

  if (isMac) {
    const child = childProcess.spawn('open', ['-a', 'Terminal', cwd], {
      stdio: 'ignore',
    })
    child.unref()
  } else {
    const child = childProcess.exec('start cmd', {
      cwd,
    })
    child.unref()
  }
}

export async function init() {
  logger.info('init')

  let bin = isWindows
    ? resolveResources('hdc/hdc.exe')
    : resolveResources('hdc/hdc')
  const hdcPath = settingsStore.get('hdcPath')
  if (hdcPath === 'hdc' || (!isStrBlank(hdcPath) && fs.existsSync(hdcPath))) {
    bin = hdcPath
  }

  app.on('before-quit', async () => {
    if (settingsStore.get('killHdcWhenExit')) {
      logger.info('kill hdc')
      await client.kill()
    }
  })

  client = Hdc.createClient({
    bin,
  })
  client.trackTargets().then((tracker) => {
    tracker.on('add', onTargetChange)
    tracker.on('remove', onTargetChange)
  })
  function onTargetChange() {
    logger.info('target change')
    setTimeout(() => window.sendTo('main', 'changeTarget'), 2000)
  }

  base.init(client)
  bundle.init(client)
  shellHdc.init(client)
  port.init(client)
  uitest.init(client)
  hilog.init(client)
  webview.init()

  handleEvent('getTargets', getTargets)
  handleEvent('getOverview', getOverview)
  handleEvent('inputKey', inputKey)
  handleEvent('screencap', screencap)
  handleEvent('openHdcCli', openHdcCli)
}
