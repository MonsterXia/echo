// Synthetic regression probe for local capture ownership; not device-stop
// acceptance. All transport replies and frames are synthetic.
// Run with: node script/audit-capture-close.cjs
const assert = require('node:assert/strict')
const { screencastMain } = require('../test/helpers/screencast-main.cjs')

const flush = () => new Promise((resolve) => setImmediate(resolve))
const listeners = (h) => (h.driver._events.message || []).length
const frame = (h, session = 'session') =>
  h.driver.emit('message', session, Buffer.from([1, 2, 3]))

async function audit() {
  const report = {
    kind: 'synthetic local teardown; not device-stop acceptance',
  }
  {
    const h = screencastMain()
    h.show()
    await h.start()
    assert.equal(
      listeners(h),
      1,
      'setup must register a real UiDriver callback',
    )
    const before = h.calls.length
    h.close()
    assert.equal(listeners(h), 0)
    frame(h)
    report.completedCaptureThenClose = {
      retainedListeners: listeners(h),
      transportCallsDuringClose: h.calls.length - before,
      frameSendAttemptsAfterClose: h.attempts.length,
      framesDeliveredWithoutWindow: h.deliveries.length,
    }
    h.show()
    frame(h)
    report.reopenBeforeStartingNewCapture = {
      oldFramesDeliveredToNewWindow: h.deliveries.filter(
        (item) => item.win === h.windows[1],
      ).length,
    }
    assert.equal(h.deliveries.length, 0)
    await h.start()
    await h.stop()
    report.successfulStopControl = { remainingListeners: listeners(h) }
  }
  {
    let release
    const pending = new Promise((resolve) => {
      release = resolve
    })
    const h = screencastMain(async (_method, api) =>
      api === 'startCaptureScreen' ? pending : {},
    )
    h.show()
    const start = h.start()
    await flush()
    assert.deepEqual(h.calls, ['stopCaptureScreen', 'startCaptureScreen'])
    h.close()
    const beforeReply = listeners(h)
    release({ sessionId: 'late-session' })
    await start
    frame(h, 'late-session')
    report.startReplyAfterClose = {
      listenersBeforeReply: beforeReply,
      retainedListenersAfterReply: listeners(h),
      frameSendAttempts: h.attempts.length,
    }
    assert.equal(listeners(h), 0)
  }
  {
    let rejectStop = false
    const h = screencastMain(async (_method, api) => {
      if (rejectStop && api === 'stopCaptureScreen')
        throw new Error('synthetic stop rejection')
      return { sessionId: 'session' }
    })
    h.show()
    await h.start()
    rejectStop = true
    await assert.rejects(h.stop(), /synthetic stop rejection/)
    h.close()
    report.rejectedStopThenClose = { retainedListeners: listeners(h) }
    assert.equal(listeners(h), 0)
    rejectStop = false
    h.show()
    await h.start()
    await h.stop()
  }
  {
    const h = screencastMain()
    h.show()
    await h.start()
    const before = h.calls.length
    h.windows[0].destroy()
    report.directWindowDestruction = {
      retainedListeners: listeners(h),
      transportCallsDuringDestruction: h.calls.length - before,
    }
    assert.equal(listeners(h), 0)
    await flush()
  }
  return report
}

audit()
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
