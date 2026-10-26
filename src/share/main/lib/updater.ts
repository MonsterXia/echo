import { autoUpdater } from 'electron-updater'
import isMac from 'licia/isMac'
import pkg from '../../../../package.json'
import { shell } from 'electron'
import type { UpdateInfo } from 'builder-util-runtime'
import type { UpdateState } from 'common/types'
import { gt } from 'semver'
import { beginReleaseCheck, cancelReleaseChecks } from '../../../main/lib/ReleaseProvider'
import {
  showUpdateWindow,
  setUpdateState,
  closeUpdateWindow,
  focusUpdateWindow,
} from '../../../main/window/update'

type ReleaseInfo = UpdateInfo & { tag?: string }
autoUpdater.autoDownload = false
let checking: Promise<void> | undefined
let pendingCheck: ReturnType<typeof autoUpdater.checkForUpdates> | undefined

export function checkUpdate() {
  if (checking) {
    focusUpdateWindow()
    return checking
  }
  let closed = false
  let selected: ReleaseInfo | undefined
  let status: UpdateState['status'] = 'checking'
  let dismiss!: () => void
  const dismissed = new Promise<void>((resolve) => { dismiss = resolve })
  const state = (): UpdateState => ({
    status,
    productName: pkg.productName,
    currentVersion: pkg.version,
    latestVersion: selected?.version,
  })
  const close = () => {
    if (closed) return
    closed = true
    cancelReleaseChecks()
    closeUpdateWindow()
    dismiss()
  }
  showUpdateWindow(state(), async (action) => {
    if (closed) return
    if (action === 'cancel' || action === 'close') {
      close()
    } else if (action === 'openRelease' && status === 'available' && selected) {
      try {
        const releases = new URL(pkg.homepage)
        releases.hash = ''
        releases.search = ''
        const tag = selected.tag ? `/tag/${encodeURIComponent(selected.tag)}` : ''
        releases.pathname = `${releases.pathname.replace(/\/$/, '')}/releases${tag}`
        await shell.openExternal(releases.href)
        close()
      } catch {
        if (!closed) { status = 'error'; setUpdateState(state()) }
      }
    }
  })
  const request = async () => {
    // A cancelled AppUpdater may still be finishing filesystem initialization.
    // Show the new progress UI immediately, but drain that operation before
    // starting another so the library cannot reuse its cancelled Promise.
    if (pendingCheck) await pendingCheck.catch(() => {})
    if (closed) return null
    const end = beginReleaseCheck()
    let result: ReturnType<typeof autoUpdater.checkForUpdates>
    try { result = autoUpdater.checkForUpdates() }
    catch (error) { end(); throw error }
    const operation = result.finally(() => {
      end()
      if (pendingCheck === operation) pendingCheck = undefined
    })
    pendingCheck = operation
    return operation
  }
  const task = (async () => {
    try {
      const result = await Promise.race([request(), dismissed.then(() => null)])
      if (!closed) {
        selected = result?.updateInfo
        status = !selected ? 'error' : result?.isUpdateAvailable ? 'available'
          : gt(selected.version, pkg.version) ? 'unavailable' : 'upToDate'
        setUpdateState(state())
      }
    } catch {
      if (!closed) { status = 'error'; setUpdateState(state()) }
    }
    await dismissed
  })()
  checking = task
  void task.then(() => { if (checking === task) checking = undefined })
  return task
}

export function init() {
  autoUpdater.setFeedURL(`https://release.liriliri.io/${pkg.name}/`)
  autoUpdater.channel = `${pkg.productName}-latest`
  if (isMac && process.arch !== 'arm64') {
    autoUpdater.channel = `${pkg.productName}-latest-x64`
  }
  // The request Promise owns presentation, including cancellation. Listening
  // prevents EventEmitter's error throw without displaying duplicate/late UI.
  autoUpdater.on('error', () => {})
}
