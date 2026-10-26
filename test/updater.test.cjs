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
      allowPrerelease: true,
      allowDowngrade: true,
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
    assert.equal(autoUpdater.forceDevUpdateConfig, true, 'local builds must perform the explicitly configured check')
    assert.equal(autoUpdater.allowPrerelease, false, 'latest channels select published stable releases')
    assert.equal(autoUpdater.allowDowngrade, false, 'a development build must not offer an older stable version')
    assert.equal(autoUpdater.autoDownload, false)
    assert.equal(autoUpdater.autoInstallOnAppQuit, false)
  })
}

test('real updater selects stable metadata for a dev build without offering a downgrade', async () => {
  const { AppUpdater } = require('electron-updater/out/AppUpdater')
  const updater = new AppUpdater(undefined, { version: '1.0.4-dev.0', isPackaged: false })
  updater.logger = { info() {}, warn() {}, error() {} }
  const requests = []
  updater.httpExecutor = { request: async options => {
    requests.push(options.path)
    if (options.path.endsWith('.atom')) return '<feed><entry><title>Preview</title><link href="https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.4-dev.0"/></entry><entry><title>Stable</title><link href="https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.3"/></entry></feed>'
    if (options.path.endsWith('/latest')) return JSON.stringify({ tag_name: 'v1.0.3' })
    if (options.path.endsWith('.yml')) return 'version: 1.0.3\nfiles:\n  - url: app.dmg\n    sha512: fixture\n'
    throw new Error(`Unexpected request ${options.path}`)
  } }
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('src/main/lib/updater.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, process: { arch: process.arch },
    require(id) {
      if (id === 'electron-updater') return { autoUpdater: updater }
      if (id === 'licia/isMac') return process.platform === 'darwin'
      throw new Error(`Unexpected import ${id}`)
    },
  })
  module.exports.init()
  assert.equal(updater.isUpdaterActive(), true)
  const info = await (await updater.clientPromise).getLatestVersion()
  assert.equal(info.version, '1.0.3')
  assert.ok(requests.some(path => path.endsWith('/latest')))
  assert.ok(requests.at(-1).includes('/download/v1.0.3/latest'))
  assert.equal(await updater.isUpdateAvailable(info), false)
  assert.equal(await updater.isUpdateAvailable({ version: '1.0.4' }), true)
})
