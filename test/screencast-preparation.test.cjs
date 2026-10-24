const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { build } = require('esbuild')
const vm = require('node:vm')
async function fixture() {
  const code = (await build({ entryPoints: ['src/main/lib/screencastPreparation.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'boundaries', setup(b) { b.onResolve({ filter: /^(electron|\.\/hdc|\.\/store|\.\/hdc\/uitest)$/ }, args => ({ path: args.path, external: true })) } }],
  })).outputFiles[0].text
  const store = new EventEmitter(), scale = new EventEmitter(), events = new EventEmitter(), app = new EventEmitter()
  let selected = { key: 'saved-device' }, size = 1, quits = 0, shutdowns = 0, release
  store.get = () => selected; scale.get = () => size
  const starts = [], stops = []
  // Match the existing optional HDC shutdown handler's event guard.
  app.on('before-quit', event => { if (!event.defaultPrevented) shutdowns++ })
  const quit = () => { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }; app.emit('before-quit', event) }
  app.quit = () => { quits++; quit() }
  const modules = {
    electron: { app }, './hdc': { deviceEvents: events }, './store': { getMainStore: () => store, getScreencastStore: () => scale },
    './hdc/uitest': {
      prepareTarget: async (key, value, valid) => { starts.push({ key, scale: value, valid }); await new Promise(resolve => { release = resolve }); return true },
      cancelCapturePreparation: async key => { stops.push(key) },
      shutdownCaptures: async () => {},
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: id => modules[id] || require(id), setTimeout, clearTimeout, console })
  module.exports.init()
  return { starts, stops, events, quit, release: () => release(), counts: () => ({ quits, shutdowns }),
    select(key) { selected = key ? { key } : null; store.emit('change', 'target', selected) },
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
test('stored target waits for online evidence; quit cancels and waits before allowing HDC shutdown', async () => {
  const f = await fixture()
  assert.equal(f.starts.length, 0)
  f.events.emit('targets', ['other-device', 'saved-device'])
  assert.equal(f.starts.length, 1)
  f.quit()
  await flush()
  assert.equal(f.starts[0].valid(), false)
  assert.deepEqual(f.counts(), { quits: 0, shutdowns: 0 })
  f.release()
  await flush()
  assert.deepEqual(f.counts(), { quits: 1, shutdowns: 1 })
  assert.deepEqual(f.stops, ['saved-device'])
})
test('tracker remove invalidates immediately without waiting for the renderer refresh', async () => {
  const f = await fixture()
  f.events.emit('add', 'saved-device')
  f.events.emit('remove', 'saved-device')
  assert.equal(f.starts[0].valid(), false)
  assert.deepEqual(f.stops, ['saved-device'])
  f.release()
  await flush()
  f.quit()
  await flush()
})
