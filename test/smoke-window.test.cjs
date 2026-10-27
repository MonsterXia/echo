const assert = require('node:assert/strict')
const { test } = require('node:test')

// Only replace the cross-process Electron handle; execute the real wait logic.
function windowHandle(state) {
  return { evaluate: async callback => callback({
    isVisible: () => state.visible,
    isDestroyed: () => !!state.destroyed,
    show: () => { throw Error('The smoke check must not show the window itself') },
  }) }
}

test('smoke check waits for a delayed native show after the DOM is ready', async t => {
  const { waitForWindowVisible } = await import('../script/lib/smoke-window.mjs')
  const state = { visible: false }
  const timer = setTimeout(() => { state.visible = true }, 25)
  t.after(() => clearTimeout(timer))
  await waitForWindowVisible(windowHandle(state), { timeoutMs: 2000, intervalMs: 5 })
  assert.equal(state.visible, true)
})

test('smoke check rejects a window that remains hidden within the deadline', async () => {
  const { waitForWindowVisible } = await import('../script/lib/smoke-window.mjs')
  const started = performance.now()
  await assert.rejects(waitForWindowVisible(windowHandle({ visible: false }), {
    timeoutMs: 20, intervalMs: 5,
  }), /window.*visible.*20 ms/i)
  assert.ok(performance.now() - started >= 20, 'Must allow the visibility deadline to elapse')
})

test('smoke check fails if the native window is destroyed before showing', async () => {
  const { waitForWindowVisible } = await import('../script/lib/smoke-window.mjs')
  await assert.rejects(waitForWindowVisible(windowHandle({ visible: false, destroyed: true })), /destroyed/i)
})
