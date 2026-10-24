const { test } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const { buildSync } = require('esbuild')
const vm = require('node:vm')
const fs = require('node:fs')
const tick = () => new Promise(r => setImmediate(r))

function fixture(send, readHost = async () => 'desktop before copy', timers = {}) {
  const dom = new JSDOM('<div><canvas></canvas><button>tool</button></div>')
  const sends = [], errors = []
  const module = { exports: {} }
  if (!fs.existsSync('src/renderer/screencast/lib/ScreencastInput.ts')) {
    return { missing: true }
  }
  vm.runInNewContext(buildSync({ entryPoints: ['src/renderer/screencast/lib/ScreencastInput.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false }).outputFiles[0].text,
  { module, exports: module.exports, document: dom.window.document, console, setTimeout, clearTimeout, ...timers })
  const canvas = dom.window.document.querySelector('canvas')
  const input = new module.exports.default(canvas, async action => { sends.push(action); await send?.(action) }, () => errors.push(true), readHost)
  input.mount(canvas.parentElement)
  input.focus()
  const area = dom.window.document.querySelector('textarea')
  const key = (key, options = {}) => area.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
  const text = (value, options = {}) => { area.value = value; area.dispatchEvent(new dom.window.InputEvent('input', { data: value, bubbles: true, ...options })) }
  return { dom, input, area, key, text, sends, errors }
}

function paste(f, text) {
  const e = new f.dom.window.Event('paste', { cancelable: true })
  Object.defineProperty(e, 'clipboardData', { value: { getData: () => text } })
  f.area.dispatchEvent(e)
}

test('ordinary paste after phone copy uses phone clipboard, then switches to changed desktop text', async () => {
  const f = fixture()
  f.key('c', { ctrlKey: true }); paste(f, 'desktop before copy')
  await tick()
  paste(f, 'new desktop text'); await tick()
  paste(f, 'desktop before copy'); await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)), [
    { type: 'keys', keys: [2072, 2019] }, { type: 'keys', keys: [2072, 2038] },
    { type: 'text', text: 'new desktop text' }, { type: 'text', text: 'desktop before copy' },
  ])
})

test('cut followed immediately by paste waits for the clipboard snapshot and cut completion', async () => {
  let resolve
  const f = fixture(undefined, () => new Promise(yes => { resolve = yes }))
  f.key('x', { ctrlKey: true }); paste(f, '')
  await tick(); assert.equal(f.sends.length, 0)
  resolve(''); await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)), [
    { type: 'keys', keys: [2072, 2040] }, { type: 'keys', keys: [2072, 2038] },
  ])
})

test('manual paste sources override automatic selection without changing desktop clipboard', async () => {
  const f = fixture()
  f.key('c', { ctrlKey: true }); await tick()
  f.input.paste('host'); await tick()
  f.input.paste('phone'); await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)).slice(1), [
    { type: 'text', text: 'desktop before copy' }, { type: 'keys', keys: [2072, 2038] },
  ])
})

test('a late clipboard read cannot send copy into a departed field', async () => {
  let resolve
  const f = fixture(undefined, () => new Promise(yes => { resolve = yes }))
  f.key('c', { ctrlKey: true }); await tick()
  f.dom.window.document.querySelector('button').focus()
  resolve('old'); await tick()
  assert.equal(f.sends.length, 0)
})

test('clipboard read failure still permits phone copy and ordinary phone paste', async () => {
  const f = fixture(undefined, async () => { throw new Error('denied') })
  f.key('c', { ctrlKey: true }); paste(f, 'host'); await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)).map(a => a.keys), [[2072, 2019], [2072, 2038]])
  f.input.paste('host'); await tick()
  assert.equal(f.errors.length, 1)
})

test('Ctrl+V works after phone copy even when the desktop clipboard is empty', async () => {
  const f = fixture(undefined, async () => '')
  f.key('c', { ctrlKey: true }); f.key('v', { ctrlKey: true }); await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)).map(a => a.keys), [[2072, 2019], [2072, 2038]])
})

test('native select-all and delete edit the phone only when the keyboard owns focus', async () => {
  const f = fixture()
  assert.equal(f.input.edit('selectAll'), true)
  assert.equal(f.input.edit('delete'), true)
  await tick()
  f.dom.window.document.querySelector('button').focus()
  assert.equal(f.input.edit('selectAll'), false)
  assert.equal(f.input.edit('delete'), false)
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)), [
    { type: 'keys', keys: [2072, 2017] }, { type: 'keys', keys: [2071] },
  ])
})

test('right-click keeps keyboard focus and does not cancel queued text for the same field', async () => {
  let resolve
  const f = fixture(() => new Promise(yes => { resolve = yes }))
  f.text('first'); f.text('second'); await tick()
  const event = new f.dom.window.MouseEvent('pointerdown', { button: 2, cancelable: true })
  f.dom.window.document.querySelector('canvas').dispatchEvent(event)
  assert.equal(event.defaultPrevented, true, 'prevent the right-click default blur before opening the native menu')
  assert.equal(f.dom.window.document.activeElement, f.area)
  resolve(); await tick()
  assert.equal(f.sends.length, 2)
  resolve(); await tick(); f.input.destroy()
})

test('leaving a pending clipboard read releases the queue for a new input focus', async () => {
  const f = fixture(undefined, () => new Promise(() => {}))
  f.key('c', { ctrlKey: true }); await tick()
  f.dom.window.document.querySelector('button').focus()
  f.input.focus(); f.text('new field'); await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)), [{ type: 'text', text: 'new field' }])
  f.input.destroy()
})

test('clipboard read has a deadline and late completion cannot change later paste routing', async () => {
  const timers = new Map(); let nextTimer = 0, resolve
  const f = fixture(undefined, () => new Promise(yes => { resolve = yes }), {
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer },
    clearTimeout: id => timers.delete(id),
  })
  f.key('c', { ctrlKey: true }); f.text('after copy'); await tick()
  assert.equal(timers.size, 1, 'clipboard deadline must exist')
  for (const fn of [...timers.values()]) fn()
  await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)), [
    { type: 'keys', keys: [2072, 2019] }, { type: 'text', text: 'after copy' },
  ])
  resolve('late host text'); await tick()
  paste(f, 'host'); await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends.at(-1))), { type: 'keys', keys: [2072, 2038] })
  assert.equal(timers.size, 0)
  f.input.destroy()
})

test('focused screencast sends text, special keys and shift selection in order', async () => {
  const f = fixture(); assert.ok(!f.missing, 'screencast keyboard input is implemented')
  f.text('a'); f.key('ArrowLeft', { shiftKey: true }); f.key('Backspace'); f.key('Enter')
  await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)), [
    { type: 'text', text: 'a' }, { type: 'keys', keys: [2047, 2014] },
    { type: 'keys', keys: [2055] }, { type: 'keys', keys: [2054] },
  ])
  f.input.destroy()
})

test('IME composition is committed once and never forwards composing Enter', async () => {
  const f = fixture(); assert.ok(!f.missing)
  f.area.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart'))
  f.text('ni', { isComposing: true }); f.key('Enter', { isComposing: true, keyCode: 229 })
  f.area.value = '你好'
  f.area.dispatchEvent(new f.dom.window.CompositionEvent('compositionend', { data: '你好' }))
  f.area.dispatchEvent(new f.dom.window.InputEvent('input', { data: '你好' }))
  await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)), [{ type: 'text', text: '你好' }])
})

test('copy and device clipboard shortcuts are distinct; plain text paste preserves content', async () => {
  const f = fixture(); assert.ok(!f.missing)
  f.key('c', { ctrlKey: true }); f.key('v', { ctrlKey: true, shiftKey: true })
  const e = new f.dom.window.Event('paste', { cancelable: true })
  Object.defineProperty(e, 'clipboardData', { value: { getData: () => '中\n文\t🙂' } })
  f.area.dispatchEvent(e)
  await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends)), [{ type: 'keys', keys: [2072, 2019] }, { type: 'keys', keys: [2072, 2038] }, { type: 'text', text: '中\n文\t🙂' }])
  assert.equal(e.defaultPrevented, true)
})

test('local controls and destroyed input never send device actions', async () => {
  const f = fixture(); assert.ok(!f.missing)
  f.dom.window.document.querySelector('button').focus()
  f.key('Enter'); f.text('local')
  f.input.destroy(); f.key('Backspace')
  await tick()
  assert.equal(f.sends.length, 0)
  assert.equal(f.dom.window.document.querySelector('textarea'), null)
})

test('a failed input cancels queued edits without automatic replay; new user input recovers', async () => {
  let reject
  let first = true
  const f = fixture(() => { if (first) { first = false; return new Promise((_resolve, no) => { reject = no }) } })
  f.text('first'); f.key('Backspace'); f.text('later')
  await tick(); reject(new Error('unknown device outcome'))
  await tick()
  assert.equal(f.sends.length, 1)
  assert.equal(f.errors.length, 1)
  f.text('new'); await tick()
  assert.equal(f.sends.length, 2)
})

test('destroy cancels pending edits and consumes a late rejection', async () => {
  let reject
  const f = fixture(() => new Promise((_resolve, no) => { reject = no }))
  f.text('first'); f.text('later')
  await tick(); f.input.destroy(); reject(new Error('late'))
  await tick()
  assert.equal(f.sends.length, 1)
  assert.equal(f.errors.length, 0)
})

test('clicking the device again discards edits queued for the previous input field', async () => {
  let resolve
  const f = fixture(() => new Promise(yes => { resolve = yes }))
  f.text('in flight'); f.text('old field')
  await tick()
  f.dom.window.document.querySelector('canvas').dispatchEvent(new f.dom.window.MouseEvent('pointerdown', { button: 0, cancelable: true }))
  resolve(); await tick()
  assert.equal(f.sends.length, 1)
})
