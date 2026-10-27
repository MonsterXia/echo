const assert = require('node:assert/strict')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<body></body>')
global.window = dom.window; global.document = dom.window.document
const notifications = [], installs = []
const moduleBox = { exports: {} }
vm.runInNewContext(transformSync(fs.readFileSync('src/renderer/lib/util.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
  module: moduleBox, exports: moduleBox.exports, document, window,
  preload: { getPathForFile: f => { if (f.unreadable) throw Error('unreadable'); return f.path } },
  main: { installBundle: async (...args) => { installs.push(args) } },
  require: name => name === 'common/util' ? { t: (key, args) => key + (args?.path || '') }
    : name === 'share/renderer/lib/util' ? { notify: (...args) => notifications.push(args) } : require(name),
})
const util = moduleBox.exports

test('dropped HAPs accept mixed-case extensions and spaces, ignore other files and install each once', async () => {
  installs.length = notifications.length = 0
  await util.installDroppedBundles('device', [{ path: '/tmp/a b.HAP' }, { path: '/tmp/readme.txt' }, { path: '/tmp/upgrade.hap' }])
  assert.deepEqual(installs, [['device', '/tmp/a b.HAP'], ['device', '/tmp/upgrade.hap']])
})
test('an unreadable drop does not prevent the next valid HAP, and reports the failure', async () => {
  installs.length = notifications.length = 0
  await util.installDroppedBundles('device', [{ unreadable: true }, { path: '/tmp/good.hap' }])
  assert.equal(installs.length, 1)
  assert.ok(notifications.some(([text]) => text === 'installDropReadFailed'))
})
test('unsupported drops and missing target have feedback without starting installation', async () => {
  installs.length = notifications.length = 0
  await util.installDroppedBundles(undefined, [{ path: '/tmp/a.hap' }])
  await util.installDroppedBundles('device', [{ path: '/tmp/a.txt' }])
  assert.equal(installs.length, 0)
  assert.ok(notifications.some(([text]) => text === 'installDropNoDevice'))
  assert.ok(notifications.some(([text]) => text === 'installDropUnsupported'))
})

test('notifications follow fullscreen entry and exit, including first notification while fullscreen', () => {
  const box = { exports: {} }
  let fullscreen = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
  const host = document.createElement('div'); document.body.append(host)
  class Notification {
    constructor(el) { this.el = el; el.className = 'test-notifications' }
    notify(text) { this.el.textContent = text }
  }
  vm.runInNewContext(transformSync(fs.readFileSync('src/share/renderer/lib/util.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: box, exports: box.exports, document, window,
    require: name => name === 'luna-notification' ? Notification : require(name),
  })
  fullscreen = host
  box.exports.notify('first')
  const el = document.querySelector('.test-notifications')
  assert.equal(el.parentElement, host)
  fullscreen = null; document.dispatchEvent(new dom.window.Event('fullscreenchange'))
  assert.equal(el.parentElement, document.body)
  fullscreen = host; document.dispatchEvent(new dom.window.Event('fullscreenchange'))
  assert.equal(el.parentElement, host)
  host.remove()
})

test('file names are rendered as text in installation notifications', async () => {
  installs.length = notifications.length = 0
  await util.installDroppedBundles('device', [{ path: '/tmp/<test> & spaced.HAP' }])
  const success = notifications.find(([, options]) => options.icon === 'success')[0]
  assert.ok(success.includes('&lt;test&gt; &amp; spaced.HAP'))
  assert.ok(!success.includes('<test>'))
})

test('window drop listener handles toolbar/empty descendants once and releases listeners on cleanup', () => {
  const calls = []; let cleanup
  const box = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('src/renderer/lib/useHapDrop.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: box, exports: box.exports, document,
    require: name => name === 'react' ? { useEffect: fn => { cleanup = fn() } }
      : name === './util' ? { installDroppedBundles: (...args) => calls.push(args) } : require(name),
  })
  box.exports.default('first-device')
  const child = document.createElement('div'); document.body.appendChild(child)
  const fire = (type, handled = false) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [{ name: 'a.hap' }] } })
    if (handled) event.preventDefault()
    child.dispatchEvent(event)
    return event
  }
  assert.ok(fire('dragover').defaultPrevented)
  assert.ok(fire('drop').defaultPrevented)
  assert.equal(calls.length, 1)
  fire('drop', true)
  assert.equal(calls.length, 1)
  cleanup(); fire('drop')
  assert.equal(calls.length, 1)
  box.exports.default('second-device'); fire('drop')
  assert.equal(calls[1][0], 'second-device')
  cleanup(); child.remove()
})
