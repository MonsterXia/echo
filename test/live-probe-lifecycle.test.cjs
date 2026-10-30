const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { spawn } = require('node:child_process')
const helpers = import('../script/lib/live-probe-lifecycle.mjs')

test('probe deadline cancels a wait without resuming verification after cleanup', async () => {
  const { runLiveProbe } = await helpers
  let lateChange = false, cleaned = false
  const result = await runLiveProbe({ timeoutMs: 10,
    verify: async ({ step }) => { await step(() => delay(40)); lateChange = true },
    cleanup: async () => { cleaned = true },
  })
  assert.equal(result.passed, false)
  assert.equal(cleaned, true)
  await delay(50)
  assert.equal(lateChange, false)
})

test('a resource acquired after timeout is released before the probe returns', async () => {
  const { runLiveProbe } = await helpers
  const events = []
  const result = await runLiveProbe({ timeoutMs: 10, verify: async ({ acquire }) => {
    await acquire(async () => { await delay(40); events.push('created'); return 'resource' },
      async resource => { assert.equal(resource, 'resource'); events.push('released') })
    events.push('resumed')
  } })
  assert.equal(result.passed, false)
  assert.equal(result.cleanupPassed, true)
  assert.deepEqual(events, ['created', 'released'])
})

test('cleanup failure fails the probe and still releases other owned resources', async () => {
  const { runLiveProbe } = await helpers
  const events = []
  const result = await runLiveProbe({ verify: async ({ acquire }) => {
    await acquire(async () => 'first', async () => events.push('first released'))
    await acquire(async () => 'second', async () => { throw Error('cleanup failure') })
  } })
  assert.equal(result.passed, false)
  assert.equal(result.cleanupPassed, false)
  assert.match(result.errors[0].message, /cleanup failure/)
  assert.deepEqual(events, ['first released'])
})

test('failed application close kills only its owned process and waits for exit', async () => {
  const { closeOwnedApplication, runLiveProbe } = await helpers
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const result = await runLiveProbe({ verify: async ({ acquire }) => {
    await acquire(async () => ({ process: () => child, close: async () => { throw Error('close failed') } }), closeOwnedApplication)
  } })
  assert.equal(result.passed, false)
  assert.equal(result.cleanupPassed, false)
  assert.notEqual(child.signalCode, null, 'owned process must exit before returning')
})

test('a close result alone does not count as process exit', async () => {
  const { closeOwnedApplication } = await helpers
  const child = new EventEmitter()
  child.exitCode = null; child.signalCode = null
  child.kill = () => { setTimeout(() => { child.signalCode = 'SIGKILL'; child.emit('exit') }, 5); return true }
  await assert.rejects(closeOwnedApplication({ process: () => child, close: async () => {} }, 15), /exit deadline/)
  assert.equal(child.signalCode, 'SIGKILL')
  assert.equal(child.listenerCount('exit'), 0)
})

test('a clean application exit and cleanup produce a passing probe', async () => {
  const { closeOwnedApplication, runLiveProbe } = await helpers
  const child = new EventEmitter()
  child.exitCode = null; child.signalCode = null
  const result = await runLiveProbe({ verify: async ({ acquire }) => {
    await acquire(async () => ({ process: () => child, close: async () => { child.exitCode = 0; child.emit('exit') } }), closeOwnedApplication)
  } })
  assert.equal(result.passed, true)
  assert.equal(result.cleanupPassed, true)
})

test('a hung application close forces exit and cannot leave a successful report', async () => {
  const { closeOwnedApplication, runLiveProbe } = await helpers
  const child = new EventEmitter()
  child.exitCode = null; child.signalCode = null
  child.kill = () => { setImmediate(() => { child.signalCode = 'SIGKILL'; child.emit('exit') }); return true }
  const result = await runLiveProbe({ verify: async ({ acquire }) => {
    await acquire(async () => ({ process: () => child, close: () => new Promise(() => {}) }),
      app => closeOwnedApplication(app, 10))
  } })
  assert.equal(result.passed, false)
  assert.equal(child.signalCode, 'SIGKILL')
  assert.match(result.errors[0].message, /close deadline/)
})

test('failure to confirm a killed process exit is reported', async () => {
  const { closeOwnedApplication } = await helpers
  const child = new EventEmitter()
  child.exitCode = null; child.signalCode = null
  child.kill = () => false
  await assert.rejects(closeOwnedApplication({ process: () => child, close: async () => { throw Error('close failed') } }, 10), /Killed application did not exit/)
  assert.equal(child.listenerCount('exit'), 0)
})
