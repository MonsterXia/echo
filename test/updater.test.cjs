const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')

function load(file, deps = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, process, URL, setTimeout, clearTimeout, ...globals,
    require: id => Object.hasOwn(deps, id) ? deps[id] : require(id),
  })
  return module.exports
}
const { ReleaseProvider } = load('src/main/lib/ReleaseProvider.ts', { './releasePage': load('src/main/lib/releasePage.ts') })
function configure(updater, mac, arch, beta = false) {
  const store = new EventEmitter()
  store.get = () => beta
  load('src/main/lib/updater.ts', {
    'electron-updater': { autoUpdater: updater },
    'licia/isMac': mac,
    './ReleaseProvider': { ReleaseProvider },
    './store': { getSettingsStore: () => store },
  }, { process: { arch } }).init()
  return store
}

for (const [mac, arch, channel] of [[false, 'x64', 'latest'], [true, 'arm64', 'latest'], [true, 'x64', 'latest-x64']]) {
  test(`project update feed: mac=${mac}, arch=${arch}`, () => {
    let feed
    const updater = { channel: 'ECHO-latest', allowPrerelease: true, allowDowngrade: true, setFeedURL(value) { feed = value } }
    const settings = configure(updater, mac, arch)
    assert.equal(feed.provider, 'custom')
    assert.equal(feed.updateProvider, ReleaseProvider)
    assert.equal(updater.channel, channel)
    assert.equal(updater.forceDevUpdateConfig, true)
    assert.equal(updater.allowPrerelease, false)
    assert.equal(updater.allowDowngrade, false)
    assert.equal(updater.autoDownload, false)
    assert.equal(updater.autoInstallOnAppQuit, false)
    settings.emit('change', 'betaUpdate', true)
    assert.equal(updater.allowPrerelease, true)
    assert.equal(updater.allowDowngrade, false)
    settings.emit('change', 'betaUpdate', false)
    assert.equal(updater.allowPrerelease, false)
  })
}

test('real updater chooses stable or all prereleases from the saved preference without downgrading', async () => {
  const { AppUpdater } = require('electron-updater/out/AppUpdater')
  const updater = new AppUpdater(undefined, { version: '1.0.4-dev.0', isPackaged: false })
  updater.logger = { info() {}, warn() {}, error() {} }
  const requests = []
  updater.httpExecutor = { request: async options => {
    requests.push(options.path)
    if (options.hostname === 'api.github.com') return JSON.stringify([
      { tag_name: 'v1.0.5-rc.1', prerelease: true, draft: false },
      { tag_name: 'v1.0.3', prerelease: false, draft: false },
    ])
    const version = options.path.includes('/v1.0.3/') ? '1.0.3' : '1.0.5-rc.1'
    return `version: ${version}\nfiles:\n  - url: app.dmg\n    sha512: fixture\n`
  } }
  const settings = configure(updater, process.platform === 'darwin', process.arch, true)
  assert.equal(updater.isUpdaterActive(), true)
  const provider = await updater.clientPromise
  const preview = await provider.getLatestVersion()
  assert.equal(preview.version, '1.0.5-rc.1')
  assert.equal(await updater.isUpdateAvailable(preview), true)
  settings.emit('change', 'betaUpdate', false)
  const stable = await provider.getLatestVersion()
  assert.equal(stable.version, '1.0.3')
  assert.equal(await updater.isUpdateAvailable(stable), false)
  assert.ok(requests.at(-1).includes('/download/v1.0.3/latest'))
})


test('Beta Update is off in a fresh settings store and survives immediate write/reload', async () => {
  const os = require('node:os'), path = require('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-beta-settings-'))
  fs.mkdirSync(path.join(root, 'data'))
  const read = () => load('src/main/lib/store.ts', {
    './SettingsStore': load('src/main/lib/SettingsStore.ts'),
    'share/main/lib/util': { getUserDataPath: name => path.join(root, name) },
  }).getSettingsStore()
  try {
    let store = read()
    assert.equal(store.get('betaUpdate'), false)
    for (const value of [true, false]) {
      store.set('betaUpdate', value)
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/settings.json'), 'utf8')).betaUpdate, value)
      store = read()
      assert.equal(store.get('betaUpdate'), value)
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
