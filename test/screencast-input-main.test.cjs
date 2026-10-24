const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const { transformSync } = require('esbuild')
const { screencastMain } = require('./helpers/screencast-main.cjs')

test('input validates payload before transport and quotes text as a single shell argument', async () => {
  assert.ok(fs.existsSync('src/main/lib/hdc/screencastInput.ts'), 'focused input handler exists')
  const calls = [], module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('src/main/lib/hdc/screencastInput.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code,
    { module, exports: module.exports, Buffer, require: id => {
      if (id === './finiteShell') return { runFiniteShell: async (...args) => { calls.push(args); return 'No Error\r\n\nSH_INPUT_EXIT:0\n' } }
      throw new Error(id)
    } })
  const input = module.exports.sendScreencastInput
  await input('synthetic', { type: 'text', text: "中\n'\"$();&🙂 " }, { host: '127.0.0.1', port: 8710 })
  assert.equal(calls.length, 1)
  assert.match(calls[0][1], /^uitest uiInput text '中\n'"'"'"\$\(\);&🙂 '/)
  assert.equal(calls[0][2].timeoutMs, 10000)
  for (const payload of [null, {}, { type: 'text', text: '\0' }, { type: 'text', text: 'a'.repeat(65537) },
    { type: 'keys', keys: [] }, { type: 'keys', keys: [2072, '2019;reboot'] },
    { type: 'keys', keys: [2072, 2045, 2047, 2019] }, { type: 'keys', keys: [18] }]) {
    await assert.rejects(() => input('synthetic', payload, { host: '127.0.0.1', port: 8710 }))
  }
  assert.equal(calls.length, 1)
})

test('keyboard IPC is owned by the active capture and is cancelled when it closes', async () => {
  const h = screencastMain()
  h.show(); const id = await h.create(); await h.invoke('startCaptureScreen', [id, 1, 1])
  assert.ok(h.hasHandler('screencastInput'), 'session-scoped keyboard IPC exists')
  await assert.rejects(h.invoke('screencastInput', [id, { type: 'keys', keys: [2054] }], h.windows[0], {}), /active|document|session/)
  h.windows[0].close()
  await assert.rejects(h.invoke('screencastInput', [id, { type: 'keys', keys: [2054] }], h.windows[0]), /active|document|session/)
})

test('closing capture cancels a pending HDC readiness wait before it can send input', async () => {
  let signal, finish
  const h = screencastMain(undefined, { inputShell: async (_key, _command, options) => {
    signal = options.signal
    await new Promise(resolve => { finish = resolve })
    return '\nSH_INPUT_EXIT:0\n'
  } })
  h.show(); const id = await h.create(); await h.invoke('startCaptureScreen', [id, 1, 1])
  const input = h.invoke('screencastInput', [id, { type: 'text', text: 'synthetic' }])
  await new Promise(r => setImmediate(r))
  h.windows[0].close()
  try { assert.equal(signal?.aborted, true) } finally { finish(); await input }
})

test('touch waits for in-flight text so focus cannot change ahead of that text', async () => {
  let finish
  const order = []
  const h = screencastMain(async (_module, api) => { if (api === 'touchDown') order.push('touch'); return {} },
    { inputShell: async () => { order.push('text'); await new Promise(resolve => { finish = resolve }); return '\nSH_INPUT_EXIT:0\n' } })
  h.show(); const id = await h.create(); await h.invoke('startCaptureScreen', [id, 1, 1])
  const input = h.invoke('screencastInput', [id, { type: 'text', text: 'synthetic' }])
  await new Promise(r => setImmediate(r))
  const touch = h.invoke('touchDown', ['synthetic-target', 1, 2])
  await new Promise(r => setImmediate(r))
  try { assert.deepEqual(order, ['text']) } finally { finish(); await Promise.all([input, touch]) }
  assert.deepEqual(order, ['text', 'touch'])
})

test('a full input queue still releases a held touch', async () => {
  let finish
  const calls = []
  const h = screencastMain(async (_module, api) => { calls.push(api); return {} },
    { inputShell: async () => { await new Promise(resolve => { finish = resolve }); return '\nSH_INPUT_EXIT:0\n' } })
  h.show(); const id = await h.create(); await h.invoke('startCaptureScreen', [id, 1, 1])
  await h.invoke('touchDown', ['synthetic-target', 1, 2])
  const input = h.invoke('screencastInput', [id, { type: 'text', text: 'synthetic' }])
  await new Promise(r => setImmediate(r))
  const moves = Array.from({ length: 80 }, () => h.invoke('touchMove', ['synthetic-target', 1, 2]))
  const released = h.invoke('touchUp', ['synthetic-target', 1, 2])
  const settled = Promise.allSettled([...moves, released])
  finish(); await input
  const results = await settled
  assert.equal(results.at(-1).status, 'fulfilled')
  assert.equal(calls.at(-1), 'touchUp')
})

test('closing a session releases its held touch even when its queued release is cancelled', async () => {
  const calls = []
  const h = screencastMain(async (_module, api, args) => { calls.push([api, args]); return {} },
    { inputShell: async (_key, _command, { signal }) => {
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
      throw new Error('cancelled input')
    } })
  h.show(); const id = await h.create(); await h.startSession(id)
  await h.invoke('touchDown', ['synthetic-target', 10, 20])
  await h.invoke('touchMove', ['synthetic-target', 30, 40])
  const input = h.invoke('screencastInput', [id, { type: 'text', text: 'synthetic' }])
  await new Promise(r => setImmediate(r))
  const release = h.invoke('touchUp', ['synthetic-target', 30, 40])
  const settled = Promise.allSettled([input, release])
  await h.stopSession(id)
  await settled
  assert.deepEqual(calls.slice(-2), [['touchUp', { x: 30, y: 40 }], ['stopCaptureScreen', {}]])
})

test('generation change releases a touchDown which completes after invalidation', async () => {
  let finish
  const calls = []
  const h = screencastMain(async (_module, api) => {
    calls.push(api)
    if (api === 'touchDown') await new Promise(resolve => { finish = resolve })
    return {}
  })
  h.show(); const id = await h.create(); await h.startSession(id)
  const down = h.invoke('touchDown', ['synthetic-target', 10, 20])
  await new Promise(r => setImmediate(r))
  const restart = h.startSession(id, 0.5, 2)
  await new Promise(r => setImmediate(r))
  finish(); await Promise.all([down, restart])
  assert.deepEqual(calls.slice(-4), ['touchDown', 'touchUp', 'stopCaptureScreen', 'startCaptureScreen'])
})

test('failed touch cleanup retains the lease and blocks another capture until release succeeds', async () => {
  let releaseFails = true
  const calls = []
  const h = screencastMain(async (_module, api) => {
    calls.push(api)
    if (api === 'touchUp' && releaseFails) throw new Error('release unconfirmed')
    return {}
  })
  h.show(); const id = await h.create(); await h.startSession(id)
  await h.invoke('touchDown', ['synthetic-target', 10, 20])
  await assert.rejects(h.stopSession(id), /release unconfirmed/)
  const replacement = await h.create()
  await assert.rejects(h.startSession(replacement), /release unconfirmed/)
  assert.equal(calls.filter(call => call === 'startCaptureScreen').length, 1)
  releaseFails = false
  await h.startSession(replacement, 0.5, 2)
  assert.deepEqual(calls.slice(-3), ['touchUp', 'stopCaptureScreen', 'startCaptureScreen'])
})
