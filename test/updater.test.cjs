const assert = require('node:assert/strict')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')

for (const [mac, arch, channel] of [[false, 'x64', 'latest'], [true, 'arm64', 'latest'], [true, 'x64', 'latest-x64']]) {
  test(`project update feed: mac=${mac}, arch=${arch}`, () => {
    let feed
    const autoUpdater = {
      channel: 'ECHO-latest',
      setFeedURL(value) { feed = value },
    }
    const source = fs.readFileSync('src/main/lib/updater.ts', 'utf8')
    const { code } = transformSync(source, { loader: 'ts', format: 'cjs' })
    const module = { exports: {} }
    vm.runInNewContext(code, {
      module, exports: module.exports, process: { arch },
      require(id) {
        if (id === 'electron-updater') return { autoUpdater }
        if (id === 'licia/isMac') return mac
        throw new Error(`Unexpected import: ${id}`)
      },
    })
    module.exports.init()
    assert.equal(feed.provider, 'github')
    assert.equal(feed.owner, 'MonsterXia')
    assert.equal(feed.repo, 'scrcpy-harmony')
    assert.equal(feed.channel, channel)
    assert.equal(autoUpdater.channel, channel)
  })
}
