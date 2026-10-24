const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

function fixture() {
  const calls = [], frames = new Map(), observers = []
  let next = 0
  const canvas = { width: 2412, height: 1084, style: {} }
  const rect = { width: 500, height: 579 }
  const context = {
    module: { exports: {} }, exports: {}, console,
    window: { innerHeight: 640 },
    document: { fullscreenElement: null, addEventListener() {}, removeEventListener() {} },
    main: { fitScreencast: async (...args) => calls.push(args) },
    requestAnimationFrame(fn) { frames.set(++next, fn); return next },
    cancelAnimationFrame(id) { frames.delete(id) },
  }
  class Observer {
    constructor(fn) { this.notify = fn; observers.push(this) }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  context.ResizeObserver = context.MutationObserver = Observer
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/screencast/lib/fitWindow.ts'), 'utf8')
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context)
  const dispose = context.module.exports.fitWindow(canvas, { getBoundingClientRect: () => rect })
  function flush() {
    for (const [id, fn] of frames) { frames.delete(id); fn() }
  }
  function notify() { observers.forEach(o => o.notify()); flush() }
  return { calls, canvas, rect, context, observers, flush, notify, dispose }
}

test('fits first frame and rotation but not subsequent frames, scaling or manual resize', () => {
  const f = fixture()
  f.flush()
  assert.deepEqual(f.calls, [[2412, 1084, 61]])
  f.notify()
  f.canvas.width /= 2; f.canvas.height /= 2
  f.notify()
  f.rect.width = 800
  f.notify()
  assert.equal(f.calls.length, 1)
  assert.equal(parseFloat(f.canvas.style.width), 800, 'low-resolution video expands to the available width')
  assert.ok(Math.abs(parseFloat(f.canvas.style.width) / parseFloat(f.canvas.style.height) - 2412 / 1084) < 1e-6)
  f.canvas.width = 1084; f.canvas.height = 2412
  f.notify()
  assert.equal(f.calls.length, 2)
  assert.equal(parseFloat(f.canvas.style.height), 579)
  f.rect.height = 548
  f.notify()
  assert.deepEqual(f.calls[2], [1084, 2412, 92], 'wrapped toolbar height is measured after fitting')
})

test('manual height changes do not refit when chrome remains constant and disposal cancels pending work', () => {
  const f = fixture()
  f.flush()
  f.context.window.innerHeight = 500; f.rect.height = 439
  f.notify()
  assert.equal(f.calls.length, 1)
  f.canvas.width = 1084; f.canvas.height = 2412
  f.observers[0].notify()
  f.dispose()
  f.flush()
  f.notify()
  assert.equal(f.calls.length, 1)
  assert.ok(f.observers.every(o => o.disconnected))
})

test('HTML fullscreen defers auto fitting until the normal video viewport returns', () => {
  const f = fixture()
  f.flush()
  f.context.document.fullscreenElement = f.canvas
  f.canvas.width = 1084; f.canvas.height = 2412
  f.notify()
  assert.equal(f.calls.length, 1)
  f.context.document.fullscreenElement = null
  f.notify()
  assert.equal(f.calls.length, 2)
})
