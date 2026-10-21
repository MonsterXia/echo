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
}
