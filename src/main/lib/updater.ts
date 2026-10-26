import { autoUpdater } from 'electron-updater'
import isMac from 'licia/isMac'

// Called after share/main initializes its listeners and upstream feed.
export function init() {
  const channel = isMac && process.arch !== 'arm64' ? 'latest-x64' : 'latest'
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'MonsterXia',
    repo: 'scrcpy-harmony',
    channel,
  })
  // The shared updater sets this property, which takes precedence over the feed.
  autoUpdater.channel = channel
  // These channels publish stable release metadata. Setting channel also
  // enables downgrades in electron-updater, so explicitly undo that side effect.
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  // This app only checks metadata and opens Releases for manual installation.
  // The explicit feed above also works for local builds without a dev YAML file.
  autoUpdater.forceDevUpdateConfig = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
}
