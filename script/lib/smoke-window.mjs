import { setTimeout as delay } from 'node:timers/promises'

export async function waitForWindowVisible(browserWindow, { timeoutMs = 20_000, intervalMs = 100 } = {}) {
  const deadline = performance.now() + timeoutMs
  while (true) {
    const state = await browserWindow.evaluate(win => {
      const destroyed = win.isDestroyed()
      return { destroyed, visible: !destroyed && win.isVisible() }
    })
    if (state.destroyed) throw Error('Application window was destroyed before becoming visible')
    if (state.visible) return
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw Error(`Application window did not become visible within ${timeoutMs} ms`)
    await delay(Math.min(intervalMs, remaining))
  }
}
