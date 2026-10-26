const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')

function fixture(check) {
  const events = [], shown = [], opened = [], dialogs = []
  const autoUpdater = new EventEmitter()
  let checks = 0, destroyed = false, response = 1
  autoUpdater.setFeedURL = () => {}
  autoUpdater.checkForUpdates = () => { checks++; return check(autoUpdater) }
  const win = { isDestroyed: () => destroyed, isMinimized: () => true,
    restore: () => shown.push('restore'), show: () => shown.push('show'), focus: () => shown.push('focus') }
  const source = fs.readFileSync('src/share/main/lib/updater.ts', 'utf8')
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, process: { arch: 'arm64' }, console, URL,
    require(id) {
      if (id === 'electron') return { BrowserWindow: { getFocusedWindow: () => win }, dialog: { showMessageBox: async (parent, options) => { assert.equal(parent, win, 'native dialog must be parented to active/pinned window'); dialogs.push(options); events.push(['main', options.message === 'updateErr' ? 'updateError' : options.message]); return { response } } }, shell: { openExternal: async url => { opened.push(url) } } }
      if (id === '../../common/i18n') return { t: key => key }
      if (id === 'electron-updater') return { autoUpdater }
      if (id === './window') return { getWin: () => ({ ...win }), sendTo: (...args) => events.push(args) }
      if (id === 'licia/isMac') return true
      if (id.endsWith('package.json')) return require('../package.json')
      throw new Error(`Unexpected import ${id}`)
    },
  })
  module.exports.init()
  return { api: module.exports, events, shown, opened, dialogs, respond: value => { response = value }, checks: () => checks, destroy: () => { destroyed = true } }
}

for (const [event, channel] of [['update-not-available', 'updateNotAvailable'], ['update-available', 'updateAvailable']]) {
  test(`manual ${event} result reaches a visible main window`, async () => {
    const f = fixture(async updater => { updater.emit(event); return {} })
    await f.api.checkUpdate()
    assert.deepEqual(f.events, [['main', channel]])
    assert.equal(f.dialogs.length, 1)
    assert.deepEqual(f.shown, ['restore', 'show', 'focus'])
  })
}

test('failed check consumes its rejection and reports one visible error, then can retry', async () => {
  let failed = true
  const f = fixture(async updater => {
    if (failed) { const e = new Error('network failure'); updater.emit('error', e); throw e }
    updater.emit('update-not-available'); return {}
  })
  await f.api.checkUpdate()
  assert.deepEqual(f.events, [['main', 'updateError']])
  failed = false
  await f.api.checkUpdate()
  assert.equal(f.checks(), 2)
  assert.deepEqual(f.events.at(-1), ['main', 'updateNotAvailable'])
})

test('synchronous checker failure also produces one error without escaping the menu handler', async () => {
  const f = fixture(() => { throw new Error('setup failure') })
  await f.api.checkUpdate()
  assert.deepEqual(f.events, [['main', 'updateError']])
})

test('a skipped check is reported as unavailable instead of claiming no updates', async () => {
  const f = fixture(async () => null)
  await f.api.checkUpdate()
  assert.deepEqual(f.events, [['main', 'updateError']])
})

test('repeated clicks share one in-flight check', async () => {
  let resolve
  const pending = new Promise(yes => { resolve = yes })
  const f = fixture(() => pending)
  const a = f.api.checkUpdate(), b = f.api.checkUpdate()
  assert.equal(f.checks(), 1)
  resolve({})
  await Promise.all([a, b])
})

test('late update events cannot revive a destroyed window', async () => {
  let complete
  const f = fixture(updater => new Promise(resolve => { complete = () => { updater.emit('update-not-available'); resolve({}) } }))
  const task = f.api.checkUpdate()
  f.destroy(); complete()
  await task
  assert.deepEqual(f.shown, [])
  assert.deepEqual(f.events, [])
})

for (const response of [0, 1]) {
  test(`native update prompt opens Releases only on explicit acceptance (${response})`, async () => {
    const f = fixture(async updater => { updater.emit('update-available'); return {} })
    f.respond(response)
    await f.api.checkUpdate()
    assert.deepEqual(f.opened, response === 0 ? ['https://github.com/MonsterXia/scrcpy-harmony/releases'] : [])
  })
}
