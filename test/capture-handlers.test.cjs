const assert = require('node:assert/strict')
const { test } = require('node:test')
const { captureHandlers } = require('./helpers/capture-handlers.cjs')

const flush = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

test('capture start handler waits for UiDriver stop before sending start and resolves after registration', async () => {
  const stop = deferred(),
    start = deferred(),
    calls = []
  const h = captureHandlers(async (method, api, args) => {
    calls.push([method, api, args])
    return api === 'stopCaptureScreen' ? stop.promise : start.promise
  })
  let settled = false
  const operation = h.start().then(() => {
    settled = true
  })
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'stopCaptureScreen')
  assert.equal(settled, false)
  stop.resolve({})
  await flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[1][0], 'Captures')
  assert.equal(calls[1][1], 'startCaptureScreen')
  assert.equal(calls[1][2].options.scale, 0.5)
  assert.equal(settled, false)
  start.resolve({ sessionId: 'synthetic-session' })
  await operation
  const bytes = Buffer.from([1, 2, 3])
  h.driver.emit('message', 'synthetic-session', bytes)
  assert.deepEqual(h.frames, [
    ['screencast', 'captureScreen', h.session(), 1, bytes],
  ])
})

test('capture stop handler remains pending until UiDriver removes the frame callback', async () => {
  const stop = deferred()
  let delayStop = false
  const h = captureHandlers(async (_method, api) => {
    if (api === 'stopCaptureScreen' && delayStop) return stop.promise
    return { sessionId: 'synthetic-session' }
  })
  await h.start()
  await flush()
  delayStop = true
  let settled = false
  const operation = h.stop().then(() => {
    settled = true
  })
  await flush()
  assert.equal(settled, false)
  h.driver.emit('message', 'synthetic-session', Buffer.from([1]))
  assert.equal(h.frames.length, 0)
  stop.resolve({})
  await operation
  h.driver.emit('message', 'synthetic-session', Buffer.from([2]))
  assert.equal(h.frames.length, 0)
})

for (const api of ['startCaptureScreen', 'stopCaptureScreen']) {
  test(`${api} handler propagates the real UiDriver transport rejection`, async () => {
    const failure = new Error(`synthetic ${api} failure`)
    let fail = api === 'startCaptureScreen'
    const h = captureHandlers(async (_method, operation) => {
      if (fail && operation === api) throw failure
      return {}
    })
    if (api === 'stopCaptureScreen') await h.start()
    fail = true
    await assert.rejects(
      api === 'startCaptureScreen' ? h.start() : h.stop(),
      (error) => error === failure,
    )
  })
}

test('start handler propagates its prerequisite stop failure without sending start', async () => {
  const calls = []
  const failure = new Error('synthetic prerequisite stop failure')
  const h = captureHandlers(async (_method, api) => {
    calls.push(api)
    if (api === 'stopCaptureScreen') throw failure
    return { sessionId: 'synthetic-session' }
  })
  await assert.rejects(h.start(), (error) => error === failure)
  assert.deepEqual(calls, ['stopCaptureScreen'])
})
