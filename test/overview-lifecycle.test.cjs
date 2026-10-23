const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync, buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { observable, runInAction } = require('mobx')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document
global.getComputedStyle = dom.window.getComputedStyle
global.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} })
const { createRoot } = require('react-dom/client')
const widgetContext = vm.createContext({
  require, window, document, navigator: window.navigator, console, setTimeout, clearTimeout,
})
vm.runInContext(buildSync({
  entryPoints: [require.resolve('luna-toolbar/react')], bundle: true,
  platform: 'browser', format: 'iife', globalName: 'Widgets', write: false,
  external: ['react', 'react/jsx-runtime'],
}).outputFiles[0].text, widgetContext)
const widgets = widgetContext.Widgets
const target = key => ({ key, ohosVersion: '6.0', sdkVersion: '20' })
const details = name => ({
  name, brand: `${name}-brand`, model: `${name}-model`, serialNum: `${name}-serial`,
  kernelVersion: `${name}-kernel`, processor: `${name}-processor`, abi: 'arm64',
  physicalResolution: '1080x1920', memTotal: 1073741824,
})

// Real Overview, React hooks, MobX observer and Luna widgets. Only external
// IPC/notifications and unrelated modals are controlled. ToolbarIcon's thin
// presentation adapter keeps this runnable in CI without src/share.
async function fixture(t, { strict = false } = {}) {
  const store = observable({ target: target('synthetic-a') })
  const requests = [], notifications = []
  const h = React.createElement
  let onClick
  const mocks = {
    './Overview.module.scss': {}, '../../store': store,
    'common/util': { t: key => key },
    'share/renderer/lib/util': { notify: (...args) => notifications.push(args) },
    'share/renderer/components/ToolbarIcon': props => {
      if (props.icon === 'refresh') onClick = props.onClick
      return h(widgets.LunaToolbarButton,
        { onClick: props.onClick, disabled: props.disabled },
        h('span', { className: `icon-${props.icon}` }))
    },
    'luna-toolbar/react': widgets,
    '../common/loading': { PannelLoading: () => h('div', { 'data-loading': true }) },
    './PortMappingModal': () => null, './RemoteControllerModal': () => null,
  }
  const filename = path.resolve(__dirname, '../src/renderer/main/components/overview/Overview.tsx')
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync(filename, 'utf8'), {
    loader: 'tsx', format: 'cjs', jsx: 'automatic',
  }).code, {
    module, exports: module.exports, setTimeout,
    main: { getOverview(key) {
      return new Promise((resolve, reject) => requests.push({ key, resolve, reject }))
    } },
    require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      if (id.startsWith('licia/') || ['react', 'react/jsx-runtime', 'mobx-react-lite'].includes(id)) return require(id)
      throw new Error(`Unexpected import: ${id}`)
    },
  }, { filename })
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
  t.after(async () => { await unmount(); container.remove() })
  await act(async () => root.render(h(strict ? React.StrictMode : React.Fragment,
    null, h(module.exports.default))))
  return {
    requests, notifications, unmount, store,
    text: () => container.textContent,
    loading: () => !!container.querySelector('[data-loading]'),
    busy: () => container.querySelector('.icon-refresh').closest('.luna-toolbar-item')
      .classList.contains('luna-toolbar-disabled'),
    click: () => container.querySelector('.icon-refresh').closest('button').click(),
    invoke: () => onClick(),
    change: next => act(async () => runInAction(() => { store.target = next })),
  }
}

for (const strict of [false, true]) {
  test(`same-tick refresh callbacks issue only one request (strict=${strict})`, async t => {
    const f = await fixture(t, { strict })
    await act(async () => f.requests.at(-1).resolve(details('initial')))
    const count = f.requests.length
    await act(async () => { f.invoke(); f.invoke() })
    assert.equal(f.requests.length, count + 1)
    assert.equal(f.busy(), true)
    await act(async () => f.requests.at(-1).resolve(details('fresh')))
    assert.ok(f.text().includes('fresh'))
    assert.equal(f.busy(), false)
  })
}

for (const replacement of ['synthetic-b', 'synthetic-a']) {
  for (const outcome of ['resolve', 'reject']) {
    test(`target replacement ${replacement} ignores old ${outcome} and preserves new loading`, async t => {
      const f = await fixture(t)
      const old = f.requests[0]
      await f.change(target(replacement))
      assert.equal(f.requests.length, 2, 'replacement must start its own read')
      assert.equal(f.requests[1].key, replacement)
      await act(async () => old[outcome](outcome === 'resolve' ? details('obsolete') : new Error('obsolete')))
      assert.equal(f.loading(), true)
      assert.equal(f.busy(), true)
      assert.equal(f.notifications.length, 0)
      await act(async () => f.requests[1].resolve(details('current')))
      assert.ok(f.text().includes('current'))
      assert.equal(f.text().includes('obsolete'), false)
      assert.equal(f.busy(), false)
    })
  }
}

test('disconnect clears details, suppresses late failure, and reconnect can read again', async t => {
  const f = await fixture(t)
  await act(async () => f.requests[0].resolve(details('previous')))
  await act(async () => f.click())
  const old = f.requests[1]
  await f.change(null)
  assert.ok(f.text().includes('targetNotConnected'))
  await act(async () => old.reject(new Error('disconnected')))
  assert.equal(f.notifications.length, 0)
  await f.change(target('synthetic-a'))
  assert.equal(f.requests.length, 3)
  await act(async () => f.requests[2].reject(new Error('current failure')))
  assert.equal(f.text().includes('previous'), false)
  assert.equal(f.notifications.length, 1)
  assert.equal(f.busy(), false)
  await act(async () => f.click())
  await act(async () => f.requests[3].resolve(details('recovered')))
  assert.ok(f.text().includes('recovered'))
})

test('unmounted overview consumes late rejection without a notification', async t => {
  const f = await fixture(t)
  await f.unmount()
  await act(async () => f.requests[0].reject(new Error('late failure')))
  assert.equal(f.notifications.length, 0)
})

test('StrictMode discarded initial read cannot overwrite the active read', async t => {
  const f = await fixture(t, { strict: true })
  assert.equal(f.requests.length, 2)
  await act(async () => f.requests[1].resolve(details('current')))
  await act(async () => f.requests[0].resolve(details('obsolete')))
  assert.ok(f.text().includes('current'))
  assert.equal(f.text().includes('obsolete'), false)
})
