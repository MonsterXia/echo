import { autoUpdater } from 'electron-updater'
import * as window from './window'
import isMac from 'licia/isMac'
import pkg from '../../../../package.json'
import { BrowserWindow, dialog, shell } from 'electron'
import { t } from '../../common/i18n'

autoUpdater.autoDownload = false
let checking: Promise<void> | undefined
let errorReported = false
let notification: Promise<void> = Promise.resolve()

export function checkUpdate() {
  if (checking) return checking
  errorReported = false
  const task = (async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result) reportError()
    } catch {
      // electron-updater emits an error AND rejects. Consume the rejection
      // without showing a second dialog; also cover synchronous setup errors.
      reportError()
    }
    await notification
  })()
  checking = task
  void task.then(() => { if (checking === task) checking = undefined })
  return task
}

function notify(channel: string) {
  notification = showResult(channel).catch(error => console.error('Update result could not be shown:', error))
}

async function showResult(channel: string) {
  // Parent the system dialog to the active window, including pinned capture
  // windows. A renderer modal in main can remain behind always-on-top windows.
  const win = BrowserWindow.getFocusedWindow() || window.getWin('main')
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  const available = channel === 'updateAvailable'
  const { response } = await dialog.showMessageBox(win, {
    type: channel === 'updateError' ? 'error' : 'info',
    title: t('checkUpdate'),
    message: t(channel === 'updateError' ? 'updateErr' : channel),
    buttons: available ? [t('updateOpenReleases'), t('updateLater')] : [t('updateOK')],
    defaultId: available ? 1 : 0,
    cancelId: available ? 1 : 0,
    noLink: true,
  })
  if (available && response === 0) {
    const releases = new URL(pkg.homepage)
    releases.hash = ''
    releases.search = ''
    releases.pathname = `${releases.pathname.replace(/\/$/, '')}/releases`
    await shell.openExternal(releases.href)
  }
}

function reportError() {
  if (errorReported) return
  errorReported = true
  notify('updateError')
}

export function init() {
  autoUpdater.setFeedURL(`https://release.liriliri.io/${pkg.name}/`)
  autoUpdater.channel = `${pkg.productName}-latest`
  if (isMac && process.arch !== 'arm64') {
    autoUpdater.channel = `${pkg.productName}-latest-x64`
  }

  autoUpdater.on('update-not-available', () => {
    notify('updateNotAvailable')
  })
  autoUpdater.on('update-available', () => {
    notify('updateAvailable')
  })
  autoUpdater.on('error', reportError)
}
