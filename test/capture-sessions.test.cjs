const assert = require('node:assert/strict')
const { test } = require('node:test')
const { screencastMain } = require('./helpers/screencast-main.cjs')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const listeners = (h) => (h.driver._events.message || []).length

test('application shutdown detaches frames immediately and waits for active capture cleanup', async () => {
  const h = screencastMain()
  h.show(); await h.start()
  const stopping = deferred()
  h.driver.stopCaptureScreen = () => stopping.promise
  let done = false
  const shutdown = h.shutdown().then(() => { done = true })
  await flush()
  assert.equal(listeners(h), 0)
  assert.equal(done, false)
  stopping.resolve()
  await shutdown
  assert.equal(done, true)
})

test('click during preparation joins the device queue and adopts the prepared service once', async () => {
  const h = screencastMain()
  const ready = deferred()
  let probes = 0, starts = 0, discards = 0
  h.driver.prepareNativeCapture = async () => { probes++; await ready.promise; return true }
  h.driver.discardNativePreparation = async () => { discards++ }
  h.driver.startOwnedCapture = async () => { starts++ }
  h.driver.stopCaptureScreen = async () => {}
  const preparing = h.prepare()
  h.show()
  const starting = h.start()
  await flush()
  assert.equal(starts, 0)
  ready.resolve()
  await Promise.all([preparing, starting])
  await h.cancelPreparation()
  assert.equal(probes, 1)
  assert.equal(starts, 1)
  assert.equal(discards, 0, 'expiry must not stop a promoted active stream')
  assert.equal(await h.prepare(), false, 'active capture must not be probed again')
  await h.stop()
})

test('cancel during preparation cleans late resources and failed cleanup blocks adoption', async () => {
  const h = screencastMain()
  const ready = deferred()
  let valid = true, failCleanup = true, starts = 0
  h.driver.prepareNativeCapture = async () => { await ready.promise; return true }
  h.driver.discardNativePreparation = async () => { if (failCleanup) throw new Error('cleanup unconfirmed') }
  h.driver.startOwnedCapture = async () => { starts++ }
  const preparing = h.prepare(() => valid)
  await flush()
  valid = false
  ready.resolve()
  await assert.rejects(preparing, /cleanup unconfirmed/)
  h.show()
  await assert.rejects(h.start(), /cleanup unconfirmed/)
  assert.equal(starts, 0)
  failCleanup = false
  await h.cancelPreparation()
  await h.start()
  assert.equal(starts, 1)
  await h.stop()
})

test('control initialization reuses a responsive daemon without stopping it', async () => {
  const h = screencastMain(async () => ({ result: { width: 100, height: 200 } }))
  let stops = 0
  h.driver.stop = async () => { stops++ }
  await h.driver.initializeControl()
  assert.equal(stops, 0)
  assert.deepEqual(h.calls, ['getDisplaySize'])
})

test('control initialization rebuilds an unresponsive daemon once and propagates repeated failure', async () => {
  let queries = 0, stops = 0
  const h = screencastMain(async () => {
    queries++
    throw new Error('control unavailable')
  })
  h.driver.stop = async () => { stops++ }
  await assert.rejects(h.driver.initializeControl(), /control unavailable/)
  assert.equal(stops, 1)
  assert.equal(queries, 2)
})

test('background control initialization never stops an unresponsive existing daemon', async () => {
  const h = screencastMain(async () => { throw new Error('control unavailable') })
  let stops = 0
  h.driver.stop = async () => { stops++ }
  await assert.rejects(h.driver.initializeControl(true), /control unavailable/)
  assert.equal(stops, 0)
  assert.deepEqual(h.calls, ['getDisplaySize'])
})

test('preparing a cached driver also avoids destructive control recovery', async () => {
  const h = screencastMain(async () => { throw new Error('control unavailable') })
  let stops = 0, prepares = 0
  h.driver.stop = async () => { stops++ }
  h.driver.nativeVideo = { prepare: async () => { prepares++; return true } }
  await assert.rejects(h.driver.prepareNativeCapture(1, () => true), /control unavailable/)
  assert.equal(stops, 0)
  assert.equal(prepares, 0)
})

test('cold native start does not wait for an unrelated JPEG stop reply', async () => {
  let prepared = false
  const h = screencastMain(async (_method, api) => {
    if (api === 'stopCaptureScreen') throw new Error('Unnecessary JPEG stop')
    if (api === 'getDisplaySize') prepared = true
    return { sessionId: 'session' }
  })
  let starts = 0
  h.driver.nativeVideo = { async start() { assert.ok(prepared, 'prepare control before starting native capture'); starts++; return true }, async stop() {} }
  h.show()
  await h.start()
  await h.stop()
  await h.create()
  await h.start()
  assert.equal(starts, 2)
  assert.equal(h.calls.filter(x => x === 'stopCaptureScreen').length, 0)
})

test('failed JPEG fallback start remains uncertain until a real stop is acknowledged', async () => {
  let failStop = true
  const h = screencastMain(async (_method, api) => {
    if (api === 'startCaptureScreen') throw new Error('JPEG start result unknown')
    if (api === 'stopCaptureScreen' && failStop) throw new Error('JPEG stop unconfirmed')
    return { sessionId: 'session' }
  })
  let nativeStarts = 0
  h.driver.nativeVideo = { async start() { nativeStarts++; return false }, async stop() {} }
  h.show()
  await assert.rejects(h.start(), /JPEG start result unknown/)
  await assert.rejects(h.start(), /JPEG stop unconfirmed/)
  assert.equal(nativeStarts, 1)
  failStop = false
  await assert.rejects(h.start(), /JPEG start result unknown/)
  assert.equal(nativeStarts, 2)
})
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('window destruction immediately detaches the real capture listener', async () => {
  const h = screencastMain()
  h.show()
  await h.start()
  assert.equal(listeners(h), 1)
  h.close()
  assert.equal(listeners(h), 0)
  await flush()
})

test('old capture frames never reach a replacement window', async () => {
  const h = screencastMain()
  h.show()
  await h.start()
  h.close()
  h.show()
  h.driver.emit('message', 'session', Buffer.from([1]))
  assert.equal(h.deliveries.length, 0)
  await flush()
})

test('a start reply after destruction does not attach a capture listener', async () => {
  let resolve
  const reply = new Promise((yes) => {
    resolve = yes
  })
  const h = screencastMain(async (_method, api) =>
    api === 'startCaptureScreen' ? reply : {},
  )
  h.show()
  const pending = h.start()
  await flush()
  h.close()
  resolve({ sessionId: 'session' })
  await pending
  assert.equal(listeners(h), 0)
})

test('stop rejection still removes the local capture listener', async () => {
  let failStop = false
  const h = screencastMain(async (_method, api) => {
    if (failStop && api === 'stopCaptureScreen')
      throw new Error('synthetic stop failure')
    return { sessionId: 'session' }
  })
  h.show()
  await h.start()
  failStop = true
  await assert.rejects(h.stop(), /synthetic stop failure/)
  assert.equal(listeners(h), 0)
})

test('BrowserWindow closed releases before a later webContents destroyed event', async () => {
  const h = screencastMain()
  h.show()
  await h.start()
  let atClosed
  h.current().once('closed', () => {
    atClosed = listeners(h)
  })
  h.current().destroy()
  assert.equal(atClosed, 0)
  await flush()
})

test('stop detaches locally before its delayed transport reply confirms stopped', async () => {
  const reply = deferred()
  let delay = false
  const h = screencastMain(async (_method, api) => {
    if (delay && api === 'stopCaptureScreen') return reply.promise
    return { sessionId: 'session' }
  })
  h.show()
  await h.start()
  delay = true
  let result
  const stop = h.stop().then((value) => {
    result = value
  })
  await flush()
  assert.equal(listeners(h), 0)
  assert.equal(result, undefined)
  reply.resolve({})
  await stop
  assert.equal(result, 'stopped')
})

test('old stop cannot stop or detach a new session on the same device', async () => {
  const h = screencastMain()
  h.show()
  const old = await h.create()
  await h.startSession(old)
  const replacement = await h.create()
  await h.startSession(replacement)
  const before = h.calls.length
  assert.equal(await h.stopSession(old), 'obsolete')
  assert.equal(h.calls.length, before)
  h.driver.emit('message', 'session', Buffer.from([1]))
  assert.deepEqual(
    h.deliveries.map((item) => item.args.slice(0, 3)),
    [['captureScreen', replacement, 1]],
  )
  await assert.rejects(h.startSession(old, 0.5, 2), /no longer active/)
  await h.stopSession(replacement)
})

test('navigation blocks the departing document and rejects its tokens after commit', async () => {
  const h = screencastMain()
  h.show()
  const old = await h.create()
  await h.startSession(old)
  const wc = h.current().webContents
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.equal(listeners(h), 0)
  await assert.rejects(h.create(), /active screencast document/)
  await assert.rejects(
    h.startSession(old, 0.5, 2),
    /active screencast document/,
  )
  wc.mainFrame = { send: (...args) => h.deliveries.push({ args }) }
  wc.emit('did-navigate')
  await assert.rejects(h.startSession(old, 0.5, 2), /no longer active/)
  const replacement = await h.create()
  await h.startSession(replacement)
  assert.equal(await h.stopSession(old), 'obsolete')
  await h.stopSession(replacement)
})

test('same-document and child-frame navigation preserve the active main-frame session', async () => {
  const h = screencastMain()
  h.show()
  await h.start()
  h.current().webContents.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: true,
  })
  h.current().webContents.emit('did-start-navigation', {
    isMainFrame: false,
    isSameDocument: false,
  })
  assert.equal(listeners(h), 1)
  await h.stop()
})

test('renderer crash invalidates and detaches even if the BrowserWindow survives', async () => {
  const h = screencastMain()
  h.show()
  await h.start()
  h.current().webContents.emit('render-process-gone', {}, { reason: 'crashed' })
  assert.equal(listeners(h), 0)
  await assert.rejects(h.create(), /active screencast document/)
  await flush()
})

test('forged sender, subframe and null senderFrame cannot create or use sessions', async () => {
  const h = screencastMain()
  h.show()
  const id = await h.create()
  const foreign = { webContents: { isDestroyed: () => false, mainFrame: {} } }
  await assert.rejects(
    h.invoke('createCaptureSession', ['synthetic-target'], foreign),
    /active screencast document/,
  )
  await assert.rejects(
    h.invoke('startCaptureScreen', [id, 0.5, 1], h.current(), {}),
    /active screencast document/,
  )
  await assert.rejects(
    h.invoke('stopCaptureScreen', [id], h.current(), null),
    /active screencast document/,
  )
  assert.deepEqual(h.calls, [])
})

test('invalid scale and stale generation cannot issue device commands', async () => {
  const h = screencastMain()
  h.show()
  const id = await h.create()
  for (const scale of [0, -1, NaN, Infinity, 2, '0.5']) {
    await assert.rejects(h.startSession(id, scale), /Invalid capture/)
  }
  await h.startSession(id, 0.5, 2)
  const before = h.calls.length
  await assert.rejects(h.startSession(id, 0.5, 1), /Invalid capture/)
  assert.equal(h.calls.length, before)
  await h.stopSession(id)
})

test('stop rejection blocks new starts until a subsequent actual stop succeeds', async () => {
  let failStop = false,
    starts = 0
  const h = screencastMain(async (_method, api) => {
    if (api === 'stopCaptureScreen' && failStop)
      throw new Error('stop unconfirmed')
    if (api === 'startCaptureScreen') starts++
    return { sessionId: 'session' }
  })
  h.show()
  await h.start()
  failStop = true
  await assert.rejects(h.stop(), /stop unconfirmed/)
  const replacement = await h.create()
  await assert.rejects(h.startSession(replacement), /stop unconfirmed/)
  assert.equal(starts, 1)
  assert.equal(listeners(h), 0)
  failStop = false
  await h.startSession(replacement, 0.5, 2)
  assert.equal(starts, 2)
  assert.equal(listeners(h), 1)
  await h.stopSession(replacement)
})

test('releasing an unstarted token does not claim that a failed old lease stopped', async () => {
  let failStop = false
  const h = screencastMain(async (_method, api) => {
    if (api === 'stopCaptureScreen' && failStop)
      throw new Error('stop unconfirmed')
    return { sessionId: 'session' }
  })
  h.show()
  await h.start()
  failStop = true
  await assert.rejects(h.stop(), /stop unconfirmed/)
  const unused = await h.create()
  const before = h.calls.length
  assert.equal(await h.stopSession(unused), 'released')
  assert.equal(h.calls.length, before)
})

test('an unsettled stop blocks only its device and cannot be bypassed by a new owner', async () => {
  const pending = deferred()
  let delay = false,
    starts = 0
  const h = screencastMain(async (_method, api) => {
    if (api === 'stopCaptureScreen' && delay) return pending.promise
    if (api === 'startCaptureScreen') starts++
    return { sessionId: 'session' }
  })
  h.addDriver('second-target', async () => ({ sessionId: 'second-session' }))
  h.show()
  await h.start()
  delay = true
  const stopping = h.stop()
  await flush()
  const replacement = await h.create()
  let settled = false
  const starting = h.startSession(replacement).then(() => {
    settled = true
  })
  const other = await h.create('second-target')
  await h.startSession(other)
  await flush()
  assert.equal(settled, false)
  assert.equal(starts, 1)
  assert.equal(listeners(h), 0)
  delay = false
  pending.resolve({})
  await Promise.all([stopping, starting])
  assert.equal(starts, 2)
  await h.stopSession(replacement)
  await h.stopSession(other)
})

test('a late start is compensated before replacement start is sent', async () => {
  const pending = deferred()
  const apis = []
  let starts = 0
  const h = screencastMain(async (_method, api) => {
    apis.push(api)
    if (api === 'startCaptureScreen' && ++starts === 1) return pending.promise
    return { sessionId: 'session' }
  })
  h.show()
  const oldStart = h.start()
  await flush()
  h.close()
  h.show()
  const newStart = h.start()
  await flush()
  assert.deepEqual(apis, ['stopCaptureScreen', 'startCaptureScreen'])
  pending.resolve({ sessionId: 'old-session' })
  await Promise.all([oldStart, newStart])
  assert.deepEqual(apis, [
    'stopCaptureScreen',
    'startCaptureScreen',
    'stopCaptureScreen',
    'stopCaptureScreen',
    'startCaptureScreen',
  ])
  h.driver.emit('message', 'old-session', Buffer.from([1]))
  assert.equal(h.deliveries.length, 0)
  await h.stop()
})

test('public Emitter cleanup preserves unrelated listeners registered during pending start', async () => {
  const pending = deferred()
  const h = screencastMain(async (_method, api) =>
    api === 'startCaptureScreen' ? pending.promise : {},
  )
  h.show()
  const starting = h.start()
  await flush()
  let observed = 0
  const unrelated = () => observed++
  h.driver.on('message', unrelated)
  pending.resolve({ sessionId: 'session' })
  await starting
  assert.equal(listeners(h), 2)
  h.close()
  assert.equal(listeners(h), 1)
  h.driver.emit('message', 'session', Buffer.from([1]))
  assert.equal(observed, 1)
  h.driver.off('message', unrelated)
  await flush()
})

test('capture and display queries share a single pending UiDriver initialization', async () => {
  const initialized = deferred()
  const h = screencastMain(async () => ({ sessionId: 'session' }), {
    initialize: () => initialized.promise,
  })
  h.evictDriver()
  h.show()
  const starting = h.start()
  const display = h.invoke('getDisplaySize', ['synthetic-target'])
  await flush()
  assert.deepEqual(h.initialization(), {
    targetRequests: 1,
    initializationStops: 0,
    initializationQueries: 1,
  })
  initialized.resolve()
  await Promise.all([starting, display])
  assert.deepEqual(h.initialization(), {
    targetRequests: 1,
    initializationStops: 0,
    initializationQueries: 1,
  })
  await h.stop()
})

test('failed UiDriver initialization releases singleflight for a later retry', async () => {
  let fail = true
  const h = screencastMain(async () => ({ sessionId: 'session' }), {
    getTarget() {
      if (fail) throw new Error('synthetic lookup failure')
    },
  })
  h.evictDriver()
  h.show()
  await assert.rejects(h.start(), /synthetic lookup failure/)
  fail = false
  await h.start()
  assert.equal(h.initialization().targetRequests, 2)
  await h.stop()
})

test('native frames retain generation ownership and closing during start compensates stop', async () => {
  const pending = deferred()
  const h = screencastMain()
  let receive, stops = 0
  h.driver.nativeVideo = {
    async start(_scale, callback) { receive = callback; return pending.promise },
    async stop() { stops++ },
  }
  h.show()
  const starting = h.start()
  await flush()
  receive({ data: Buffer.from([1]), timestamp: 42, config: false, keyFrame: true })
  assert.equal(h.deliveries.length, 1)
  assert.equal(h.deliveries[0].args[4].codec, 'h264')
  h.close()
  receive({ data: Buffer.from([2]), timestamp: 43 })
  assert.equal(h.deliveries.length, 1)
  pending.resolve(true)
  await starting
  await flush()
  assert.equal(stops, 1)
})

test('native unavailable falls back to JPEG while explicit compatibility skips native', async () => {
  const h = screencastMain()
  let starts = 0
  h.driver.nativeVideo = { async start() { starts++; return false }, async stop() {} }
  h.show()
  await h.start()
  assert.equal(starts, 1)
  assert.equal(listeners(h), 1)
  await h.invoke('startCaptureScreen', [h.session(), 0.5, 2, false])
  assert.equal(starts, 1)
  assert.equal(listeners(h), 1)
  await h.stop()
})

test('unconfirmed native cleanup blocks JPEG fallback and subsequent start', async () => {
  const h = screencastMain()
  let starts = 0
  h.driver.nativeVideo = {
    async start() { starts++; throw new Error('native cleanup unconfirmed') },
    async stop() { throw new Error('native cleanup unconfirmed') },
  }
  h.show()
  await assert.rejects(h.start(), /cleanup unconfirmed/)
  await assert.rejects(h.invoke('startCaptureScreen', [h.session(), 0.5, 2, false]), /cleanup unconfirmed/)
  assert.equal(starts, 1)
  assert.equal(listeners(h), 0)
})
