const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')

function fixture(check) {
  const states = [], opened = []
  const autoUpdater = new EventEmitter()
  let checks = 0, action, closes = 0, cancellations = 0, focused = 0
  autoUpdater.setFeedURL = () => {}
  autoUpdater.checkForUpdates = () => { checks++; return check(autoUpdater) }
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('src/share/main/lib/updater.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, process: { arch: 'arm64' }, console, URL,
    require(id) {
      if (id === 'electron') return { shell: { openExternal: async url => { opened.push(url) } } }
      if (id === 'electron-updater') return { autoUpdater }
      if (id.endsWith('/window/update')) return {
        showUpdateWindow: (state, callback) => { states.push(state); action = callback },
        setUpdateState: state => states.push(state),
        closeUpdateWindow: () => { closes++; action('close') },
        focusUpdateWindow: () => focused++,
      }
      if (id.endsWith('/ReleaseProvider')) return { beginReleaseCheck: () => () => {}, cancelReleaseChecks: () => cancellations++ }
      if (id === 'semver') return require('semver')
      if (id === 'licia/isMac') return true
      if (id.endsWith('package.json')) return require('../package.json')
      throw new Error(`Unexpected import ${id}`)
    },
  })
  module.exports.init()
  return { api: module.exports, states, opened, action: value => action(value), checks: () => checks, closes: () => closes, cancellations: () => cancellations, focused: () => focused }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const result = (available = false) => ({ isUpdateAvailable: available, updateInfo: { version: available ? '1.0.5-rc.1' : require('../package.json').version, tag: available ? 'v1.0.5-rc.1' : 'v1.0.4-dev.0' } })

for (const [available, status] of [[false, 'upToDate'], [true, 'available']]) {
  test(`immediate progress is replaced by ${status} in the same presentation`, async () => {
    let resolve
    const f = fixture(() => new Promise(yes => { resolve = yes }))
    const task = f.api.checkUpdate()
    assert.equal(f.states[0].status, 'checking', 'progress must appear before the network completes')
    resolve(result(available)); await flush()
    assert.equal(f.states.at(-1).status, status)
    assert.equal(f.states.at(-1).latestVersion, available ? '1.0.5-rc.1' : require('../package.json').version)
    f.action('close'); await task
    assert.equal(f.closes(), 1)
  })
}

test('cancel terminates the request and suppresses late results', async () => {
  let resolve
  const f = fixture(() => new Promise(yes => { resolve = yes }))
  const task = f.api.checkUpdate()
  f.action('cancel')
  assert.equal(f.cancellations(), 1)
  assert.equal(f.closes(), 1)
  resolve(result()); await task
  assert.deepEqual(f.states.map(s => s.status), ['checking'])
})

test('closing while checking suppresses late error events and permits another check', async () => {
  let reject
  const f = fixture(updater => new Promise((_resolve, no) => { reject = () => { updater.emit('error', new Error('late')); no(new Error('late')) } }))
  const task = f.api.checkUpdate()
  f.action('close'); reject(); await task
  assert.deepEqual(f.states.map(s => s.status), ['checking'])
  const next = f.api.checkUpdate()
  assert.equal(f.checks(), 2)
  f.action('cancel'); reject(); await next
})

test('repeated checks share one request and focus the existing window', async () => {
  const f = fixture(async () => result())
  const first = f.api.checkUpdate(), second = f.api.checkUpdate()
  assert.equal(f.checks(), 1)
  assert.equal(f.focused(), 1)
  await flush(); f.action('close'); await Promise.all([first, second])
})

for (const check of [() => { throw new Error('setup') }, async () => null, async updater => { const e = new Error('network'); updater.emit('error', e); throw e }]) {
  test('skipped or failed check becomes one inline error rather than a delayed native dialog', async () => {
    const f = fixture(check)
    const task = f.api.checkUpdate()
    await flush()
    assert.deepEqual(f.states.map(s => s.status), ['checking', 'error'])
    f.action('close'); await task
  })
}

test('only the available action opens the exact selected release', async () => {
  let resolve
  const f = fixture(() => new Promise(yes => { resolve = yes }))
  const task = f.api.checkUpdate()
  await f.action('openRelease')
  assert.deepEqual(f.opened, [])
  resolve(result(true)); await flush()
  await f.action('openRelease'); await task
  assert.deepEqual(f.opened, ['https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.5-rc.1'])
})


test('cancel resolves the UI immediately while a slow initialization drains before the next check', async () => {
  const resolves = []
  const f = fixture(() => new Promise(resolve => resolves.push(resolve)))
  const first = f.api.checkUpdate()
  f.action('cancel')
  await first
  const second = f.api.checkUpdate()
  assert.equal(f.states.at(-1).status, 'checking')
  assert.equal(f.checks(), 1)
  resolves[0](result()); await flush()
  assert.equal(f.checks(), 2)
  resolves[1](result()); await flush()
  f.action('close'); await second
})

test('a newer but incompatible or staged-out release is not described as no newer version', async () => {
  const f = fixture(async () => ({ ...result(true), isUpdateAvailable: false }))
  const task = f.api.checkUpdate(); await flush()
  assert.equal(f.states.at(-1).status, 'unavailable')
  f.action('close'); await task
})
