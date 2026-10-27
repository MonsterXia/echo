import {
  IBundleInfo,
  IpcCleanBundleCache,
  IpcCleanBundleData,
  IpcGetBundleInfos,
  IpcGetBundles,
  IpcGetTopBundle,
  IpcInstallBundle,
  IpcStartBundle,
  IpcStopBundle,
  IpcUninstallBundle,
} from 'common/types'
import { Client } from 'hdckit'
import { handleEvent } from 'share/main/lib/util'
import { shell } from './base'
import trim from 'licia/trim'
import axios from 'axios'
import types from 'licia/types'
import log from 'share/common/log'
import map from 'licia/map'
import startWith from 'licia/startWith'
import filter from 'licia/filter'
import contain from 'licia/contain'
import { sendAll } from 'share/main/lib/window'

const logger = log('hdcBundle')

let client: Client

const getBundles: IpcGetBundles = async (connectKey, system = true) => {
  const result = await shell(connectKey, 'bm dump -a')
  const bundles = map(trim(result).split('\n').slice(1), (line) => trim(line))

  return system ? bundles : filter(bundles, (bundle) => !isSystemBundle(bundle))
}

function isSystemBundle(bundle: string) {
  const sysBundlePrefixs = [
    'com.huawei.hmos',
    'com.huawei.hms',
    'com.huawei.msdp',
    'com.ohos',
  ]
  for (let i = 0, len = sysBundlePrefixs.length; i < len; i++) {
    if (startWith(bundle, sysBundlePrefixs[i])) {
      return true
    }
  }

  if (
    contain(
      [
        'ohos.global.systemres',
        'com.huawei.associateassistant',
        'com.huawei.batterycare',
        'com.huawei.shell_assistant',
        'com.usb.right',
      ],
      bundle
    )
  ) {
    return true
  }

  return false
}

const getBundleInfos: IpcGetBundleInfos = async (connectKey, bundleNames) => {
  const result: IBundleInfo[] = []
  // Probe the connected device, not the app's target API. Keep this scoped to
  // one request so reconnects and system updates cannot leave stale support.
  let supportsLabel: boolean | undefined

  for (const bundleName of bundleNames) {
    try {
      // Keep transport, parsing and metadata tied to this bundle. The shared
      // batch shell framing cannot isolate transport failures or delimiter text.
      const dump = (await shell(connectKey, `bm dump -n ${bundleName}`)).trim()
      let json = dump
      if (!dump.startsWith('{')) {
        const newline = dump.indexOf('\n')
        if (newline === -1 || dump.slice(0, newline).trim() !== `${bundleName}:`) {
          throw new Error(
            `Unexpected bm dump header or command error: ${dump.slice(0, 160)}`
          )
        }
        json = dump.slice(newline + 1)
      }
      const info = JSON.parse(json)
      const applicationInfo = info?.applicationInfo
      if (
        !applicationInfo ||
        typeof applicationInfo !== 'object' ||
        Array.isArray(applicationInfo)
      ) {
        throw new Error('Missing or invalid applicationInfo')
      }
      if (
        (info.name !== undefined && info.name !== bundleName) ||
        (applicationInfo.bundleName !== undefined &&
          applicationInfo.bundleName !== bundleName)
      ) {
        throw new Error('bm dump bundle name does not match the requested bundle')
      }

      const bundleInfo: IBundleInfo = {
        bundleName,
        label: bundleName,
        icon: '',
        system: applicationInfo.isSystemApp === true,
        versionName:
          typeof applicationInfo.versionName === 'string'
            ? applicationInfo.versionName
            : '',
        apiTargetVersion:
          typeof applicationInfo.apiTargetVersion === 'number'
            ? applicationInfo.apiTargetVersion
            : 0,
        vendor:
          typeof applicationInfo.vendor === 'string' ? applicationInfo.vendor : '',
        installTime: typeof info.installTime === 'number' ? info.installTime : 0,
        releaseType: typeof info.releaseType === 'string' ? info.releaseType : '',
      }

      if (info.mainEntry) {
        const index = Array.isArray(info.hapModuleNames)
          ? info.hapModuleNames.indexOf(info.mainEntry)
          : -1
        const mainModuleInfo = Array.isArray(info.hapModuleInfos)
          ? info.hapModuleInfos[index]
          : undefined
        const ability =
          mainModuleInfo?.mainAbility || mainModuleInfo?.abilityInfos?.[0]?.name
        if (typeof ability === 'string' && ability) {
          bundleInfo.mainAbility = ability
        } else {
          logger.warn('Missing main ability for bundle', connectKey, bundleName)
        }
      }

      let localLabel = displayableLabel(applicationInfo.label)
      if (localLabel) {
        bundleInfo.label = localLabel
      } else {
        if (supportsLabel === undefined) {
          supportsLabel = false
          try {
            const help = await shell(connectKey, 'bm dump -h')
            supportsLabel = /^\s*-l,\s*--label\b/m.test(help)
          } catch (error) {
            logger.warn('Failed to check bundle label support', connectKey, error)
          }
        }
        if (supportsLabel) {
          try {
            const label = displayableLabel(
              await shell(connectKey, `bm dump -n ${bundleName} -l`)
            )
            if (!label) {
              throw new Error('Empty, unresolved or invalid bundle label response')
            }
            bundleInfo.label = label
            localLabel = label
          } catch (error) {
            logger.warn('Failed to read bundle label', connectKey, bundleName, error)
          }
        }
      }

      if (!bundleInfo.system && !startWith(bundleName, 'com.huawei')) {
        try {
          const onlineInfo = await getOnlineBundleInfo(bundleName)
          if (!localLabel && onlineInfo.name) {
            bundleInfo.label = onlineInfo.name
          }
          if (onlineInfo.icon) {
            bundleInfo.icon = onlineInfo.icon
          }
        } catch (error) {
          logger.warn(
            'Failed to read online bundle info',
            connectKey,
            bundleName,
            error
          )
        }
      }
      result.push(bundleInfo)
    } catch (error) {
      logger.warn('Failed to read bundle info', connectKey, bundleName, error)
    }
  }

  return result
}

function displayableLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  const label = value.trim()
  if (
    !label ||
    label.startsWith('$') ||
    Array.from(label).some((char) => char.charCodeAt(0) < 32) ||
    /^(error|usage)\s*:/i.test(label)
  ) {
    return ''
  }
  return label
}

const INFO_URL = 'https://web-drcn.hispace.dbankcloud.com/edge/webedge/appinfo'
const onlineInfos: types.PlainObj<any> = {}
async function getOnlineBundleInfo(bundleName: string) {
  if (onlineInfos[bundleName]) {
    return onlineInfos[bundleName]
  }

  logger.info('get online bundle info', bundleName)
  const { data } = await axios.post(INFO_URL, {
    pkgName: bundleName,
    appId: bundleName,
    locale: 'zh_CN',
    countryCode: 'CN',
    orderApp: 1,
  })
  onlineInfos[bundleName] = data

  return data
}

const installBundle: IpcInstallBundle = async (connectKey, hap) => {
  const target = await client.getTarget(connectKey)
  await target.install(hap)
  try {
    sendAll('bundleInstalled', connectKey)
  } catch (error) {
    // A closing window must not turn a completed installation into a failure.
    logger.warn('Failed to notify windows after installation', error)
  }
}

const startBundle: IpcStartBundle = async (connectKey, bundleName, ability) => {
  await shell(connectKey, `aa start -a ${ability} -b ${bundleName}`)
}

const stopBundle: IpcStopBundle = async (connectKey, bundleName) => {
  await shell(connectKey, `aa force-stop ${bundleName}`)
}

const cleanBundleData: IpcCleanBundleData = async (connectKey, bundleName) => {
  await shell(connectKey, `bm clean -n ${bundleName} -d`)
}

const cleanBundleCache: IpcCleanBundleCache = async (
  connectKey,
  bundleName
) => {
  await shell(connectKey, `bm clean -n ${bundleName} -c`)
}

const uninstallBundle: IpcUninstallBundle = async (connectKey, bundleName) => {
  const target = await client.getTarget(connectKey)
  await target.uninstall(bundleName)
}

const getTopBundle: IpcGetTopBundle = async (connectKey) => {
  const abilityInfo = await shell(connectKey, 'aa dump -a')
  const lines = map(abilityInfo.split('\n'), (line) => trim(line))

  let name = ''
  let pid = 0
  let state = ''
  for (let i = 0, len = lines.length; i < len; i++) {
    const line = lines[i]
    if (startWith(line, 'process name')) {
      name = line.slice('process name ['.length, -1)
    } else if (startWith(line, 'pid')) {
      const pidMatch = line.match(/pid #(\d+)/)
      if (pidMatch) {
        pid = parseInt(pidMatch[1], 10)
      }
    } else if (startWith(line, 'state')) {
      if (line === 'state #FOREGROUND' && !isSystemBundle(name)) {
        state = 'foreground'
        break
      }
    }
  }
  if (state !== 'foreground') {
    return {
      name: '',
      pid: 0,
    }
  }

  return {
    name,
    pid,
  }
}

export async function init(c: Client) {
  client = c

  handleEvent('getBundles', getBundles)
  handleEvent('installBundle', installBundle)
  handleEvent('getBundleInfos', getBundleInfos)
  handleEvent('startBundle', startBundle)
  handleEvent('stopBundle', stopBundle)
  handleEvent('cleanBundleData', cleanBundleData)
  handleEvent('cleanBundleCache', cleanBundleCache)
  handleEvent('uninstallBundle', uninstallBundle)
  handleEvent('getTopBundle', getTopBundle)
}
