import { autoUpdater } from 'electron-updater'
import isMac from 'licia/isMac'
import { ReleaseProvider } from './ReleaseProvider'
import { getSettingsStore } from './store'

// Called after share/main initializes its listeners and upstream feed.
export function init() {
  const channel = isMac && process.arch !== 'arm64' ? 'latest-x64' : 'latest'
  // channel also enables downgrades; undo that side effect below.
  autoUpdater.channel = channel
  autoUpdater.setFeedURL({ provider: 'custom', updateProvider: ReleaseProvider })
  const settings = getSettingsStore()
  autoUpdater.allowPrerelease = settings.get('betaUpdate') === true
  settings.on('change', (name, value) => {
    if (name === 'betaUpdate') autoUpdater.allowPrerelease = value === true
  })
  autoUpdater.allowDowngrade = false
  // This app only checks metadata and opens Releases for manual installation.
  // The explicit feed above also works for local builds without a dev YAML file.
  autoUpdater.forceDevUpdateConfig = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
}
