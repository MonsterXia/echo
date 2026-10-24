const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync, buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { observable } = require('mobx')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document
global.getComputedStyle = dom.window.getComputedStyle
global.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
})
const { createRoot } = require('react-dom/client')
const widgetContext = vm.createContext({
  require,
  window,
  document,
  navigator: window.navigator,
  console,
  setTimeout,
  clearTimeout,
})
vm.runInContext(
  buildSync({
    entryPoints: [require.resolve('luna-toolbar/react')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'Widgets',
    write: false,
    external: ['react', 'react/jsx-runtime'],
  }).outputFiles[0].text,
  widgetContext,
)
const widgets = widgetContext.Widgets

function load(file, mocks, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(
    transformSync(
      fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'),
      {
        loader: 'tsx',
        format: 'cjs',
        jsx: 'automatic',
      },
    ).code,
    {
      module,
      exports: module.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      ...globals,
    },
  )
  return module.exports.default
}
// Actual Toolbar, React hooks, MobX observer and installed Luna widgets.
// The shared icon's presentation-only forwarding is adapted below so this
// fixture also runs in CI's checkout without submodules. Timers and capture
// stats are controlled; no device access.
async function fixture(
  t,
  { strict = false, target = { key: 'synthetic-a' }, captureClient } = {},
) {
  const store = observable({ target, scale: 1, alwaysOnTop: false, screencastClient: captureClient })
  const timers = new Map()
  let clock = 0, nextTimer = 0
  const Toolbar = load(
    'src/renderer/screencast/components/Toolbar.tsx',
    {
      '../store': store,
      './Toolbar.module.scss': {},
      'common/util': { t: (key) => key },
      'luna-toolbar/react': widgets,
      'share/renderer/components/ToolbarIcon': (props) => {
        return React.createElement(
          widgets.LunaToolbarButton,
          { onClick: props.onClick, disabled: props.disabled, state: props.state },
          React.createElement('span', { className: `icon-${props.icon}` }),
        )
      },
      'licia/fullscreen': {},
      'licia/download': {},
    },
    {
      document,
      performance: { now: () => clock },
      setInterval: (fn, delay) => {
        const id = ++nextTimer
        timers.set(id, { fn, at: clock + delay, interval: delay })
        return id
      },
      clearInterval: (id) => timers.delete(id),
      setTimeout: (fn, delay) => {
        const id = ++nextTimer
        timers.set(id, { fn, at: clock + delay })
        return id
      },
      clearTimeout: (id) => timers.delete(id),
    },
  )
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let mounted = true
  const unmount = async () => {
    if (mounted) {
      await act(async () => root.unmount())
      mounted = false
    }
  }
  t.after(async () => {
    await unmount()
    container.remove()
  })
  await act(async () =>
    root.render(
      React.createElement(
        strict ? React.StrictMode : React.Fragment,
        null,
        React.createElement(Toolbar),
      ),
    ),
  )
  return {
    container: document.body,
    timers,
    tick: async (ms) => {
      clock += ms
      await act(async () => {
        for (const [id, timer] of timers) {
          if (timer.at <= clock) {
            if (timer.interval) timer.at = clock + timer.interval
            else timers.delete(id)
            timer.fn()
          }
        }
      })
    },
    unmount,
    button: () => document.body.querySelector('.icon-power').closest('button'),
  }
}

test('capture status measures elapsed paint rate, resets on restart, and stops sampling when hidden', async (t) => {
  let stats = { codec: null, frames: 0, generation: 1 }
  const f = await fixture(t, { strict: true, captureClient: { getCaptureStats: () => ({ ...stats }) } })
  const toggle = f.container.querySelector('[aria-controls]')
  const status = () => f.container.querySelector('[data-capture-status]').textContent
  const intervals = () => [...f.timers.values()].filter(timer => timer.interval).length
  assert.equal(intervals(), 0)
  await act(async () => { toggle.click(); toggle.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })) })
  assert.match(status(), /screencastWaiting/)
  assert.equal(intervals(), 1)
  stats = { codec: 'H.264', frames: 60, generation: 1 }
  await f.tick(1000)
  assert.match(status(), /H\.26460\.0 FPS/)
  stats.frames += 40
  await f.tick(2000)
  assert.match(status(), /20\.0 FPS/)
  await f.tick(1000)
  assert.match(status(), /0\.0 FPS/)
  stats = { codec: null, frames: 0, generation: 2 }
  await f.tick(1000)
  assert.match(status(), /screencastWaiting— FPS/)
  stats = { codec: 'JPEG', frames: 10, generation: 2 }
  await f.tick(1000)
  assert.match(status(), /JPEG10\.0 FPS/)
  await act(async () => toggle.click())
  assert.equal(intervals(), 0)
  stats.frames += 1000
  await act(async () => toggle.click())
  assert.match(status(), /JPEG— FPS/, 'reopening must not average time hidden')
  await f.unmount()
  assert.equal(f.timers.size, 0)
})

test('tools start hidden, reveal on demand and Escape restores focus', async (t) => {
  const f = await fixture(t)
  const toggle = f.container.querySelector('[aria-controls="screencast-tools"]')
  const panel = f.container.querySelector('#screencast-tools')
  assert.equal(panel.hasAttribute('inert'), true)
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  await act(async () => toggle.click())
  assert.equal(panel.hasAttribute('inert'), false)
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  await act(async () => f.button().focus())
  await act(async () => f.button().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(panel.hasAttribute('inert'), true)
  assert.equal(document.activeElement, toggle)
  assert.equal(f.container.querySelector('.icon-text'), null)
  await act(async () => toggle.click())
  await act(async () => toggle.click())
  assert.equal(panel.hasAttribute('inert'), true)
})

for (const strict of [false, true]) {
  test(`titlebar entry reveals the idle button without expanding tools; hiding does not block later use (strict=${strict})`, async (t) => {
    const f = await fixture(t, { strict })
    const toggle = f.container.querySelector('[aria-controls]')
    const panel = f.container.querySelector('#screencast-tools')
    const move = (inside) => act(async () => toggle.parentElement.dispatchEvent(new window.MouseEvent(inside ? 'mouseover' : 'mouseout', { bubbles: true, relatedTarget: document.body })))
    await f.tick(1999)
    assert.equal(toggle.dataset.visible, 'true')
    await f.tick(1)
    assert.equal(toggle.dataset.visible, 'false')
    await move(false)
    assert.equal(toggle.dataset.visible, 'false', 'other video regions do not reveal the button')
    await move(true)
    assert.equal(toggle.dataset.visible, 'true')
    assert.equal(panel.hasAttribute('inert'), true, 'hover only reveals the entry')
    await f.tick(5000)
    assert.equal(toggle.dataset.visible, 'true', 'stationary pointer in titlebar entry keeps it visible')
    await act(async () => toggle.click())
    await move(false)
    await f.tick(2000)
    assert.equal(panel.hasAttribute('inert'), true)
    assert.equal(toggle.dataset.visible, 'true', 'entry gets its own grace period after panel closes')
    await f.tick(2000)
    assert.equal(toggle.dataset.visible, 'false')
    await act(async () => toggle.focus())
    assert.equal(toggle.dataset.visible, 'true', 'keyboard focus can recover the hidden entry')
    await f.unmount()
    assert.equal(f.timers.size, 0)
    await move(true)
    assert.equal(f.timers.size, 0, 'unmounted portal cannot rearm timers')
  })

  test(`auto hides after leaving, cancels on return and cleans up timers (strict=${strict})`, async (t) => {
    const f = await fixture(t, { strict })
    const toggle = f.container.querySelector('[aria-controls="screencast-tools"]')
    const panel = f.container.querySelector('#screencast-tools')
    const enter = () => act(async () => toggle.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
    const leave = () => act(async () => toggle.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    await enter()
    await act(async () => toggle.click())
    await f.tick(3000)
    assert.equal(panel.hasAttribute('inert'), false, 'hovering keeps tools visible')
    await leave()
    await f.tick(1999)
    assert.equal(panel.hasAttribute('inert'), false)
    await enter()
    await f.tick(1000)
    assert.equal(panel.hasAttribute('inert'), false, 'return cancels the pending hide')
    await leave()
    await f.tick(2000)
    assert.equal(panel.hasAttribute('inert'), true)
    await act(async () => toggle.click())
    assert.equal(f.timers.size, 1)
    await f.unmount()
    assert.equal(f.timers.size, 0)
  })


}

test('select and keyboard focus protect editing; ordinary mouse button focus does not pin the toolbar', async (t) => {
  const f = await fixture(t)
  const toggle = f.container.querySelector('[aria-controls]')
  const panel = f.container.querySelector('#screencast-tools')
  await act(async () => { toggle.focus(); toggle.click() })
  await f.tick(2000)
  assert.equal(panel.hasAttribute('inert'), true, 'mouse focus on toggle must not defeat auto hide')
  await act(async () => toggle.click())
  const select = panel.querySelector('select')
  await act(async () => select.focus())
  await f.tick(5000)
  assert.equal(panel.hasAttribute('inert'), false)
  await act(async () => select.blur())
  await f.tick(2000)
  assert.equal(panel.hasAttribute('inert'), true)
  await act(async () => {
    toggle.focus()
    toggle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    toggle.click()
  })
  await f.tick(5000)
  assert.equal(panel.hasAttribute('inert'), false)
  await act(async () => toggle.blur())
  await f.tick(2000)
  assert.equal(panel.hasAttribute('inert'), true)
})
