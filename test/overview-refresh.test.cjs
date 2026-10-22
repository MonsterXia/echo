const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React

const dom = new JSDOM('<!doctype html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document
global.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = require('react-dom/client')

// Keep Overview, React hooks and MobX observer real. Control only the IPC,
// notification and native UI boundaries; no device or Electron process runs.
test('overview clears stale details after a failed refresh and recovers on retry', async (t) => {
  const requests = [], notifications = []
  const main = {
    getOverview(key) {
      assert.equal(key, 'synthetic-target')
      return new Promise((resolve, reject) => requests.push({ resolve, reject }))
    },
  }
  const h = React.createElement
  const Empty = () => null
  const mocks = {
    './Overview.module.scss': {},
    '../../store': { target: { key: 'synthetic-target', ohosVersion: '6.0', sdkVersion: '20' } },
    'common/util': { t: (key) => key },
    'share/renderer/lib/util': { notify: (...args) => notifications.push(args) },
    'share/renderer/components/ToolbarIcon': ({ icon, onClick, disabled }) =>
      h('button', { 'data-action': icon, onClick, disabled }),
    'luna-toolbar/react': {
      __esModule: true,
      default: ({ children }) => h('div', null, children),
      LunaToolbarSpace: Empty,
    },
    '../common/loading': { PannelLoading: () => h('div', { 'data-loading': true }) },
    './PortMappingModal': Empty,
    './RemoteControllerModal': Empty,
  }
  const filename = path.resolve(__dirname, '../src/renderer/main/components/overview/Overview.tsx')
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    loader: 'tsx', format: 'cjs', jsx: 'automatic',
  })
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, main, setTimeout,
    require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      if (id.startsWith('licia/') || ['react', 'react/jsx-runtime', 'mobx-react-lite'].includes(id)) return require(id)
      throw new Error(`Unexpected import: ${id}`)
    },
  }, { filename })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  const button = () => container.querySelector('[data-action="refresh"]')
  await act(async () => root.render(h(module.exports.default)))
  assert.equal(requests.length, 1)
  await act(async () => requests[0].resolve({
    name: 'old-name', brand: 'old-brand', model: 'old-model',
    serialNum: 'old-serial', kernelVersion: 'old-kernel',
    processor: 'old-processor', abi: 'old-abi', physicalResolution: 'old-resolution',
    memTotal: 1073741824,
  }))
  assert.ok(container.textContent.includes('old-name'))
  assert.ok(container.textContent.includes('old-serial'))
  await act(async () => button().click())
  assert.equal(requests.length, 2)
  assert.equal(button().disabled, true)
  await act(async () => requests[1].reject(new Error('HDC parameter command failed')))
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0][0], 'commonErr')
  assert.equal(notifications[0][1].icon, 'error')
  assert.equal(button().disabled, false)
  assert.equal(container.querySelector('[data-loading]'), null)
  assert.equal(container.textContent.includes('old-'), false, 'failed refresh must discard the previous overview')
  await act(async () => button().click())
  assert.equal(requests.length, 3)
  await act(async () => requests[2].resolve({ name: 'recovered-name', serialNum: 'recovered-serial', memTotal: 2147483648 }))
  assert.ok(container.textContent.includes('recovered-name'))
  assert.ok(container.textContent.includes('recovered-serial'))
  assert.equal(container.textContent.includes('old-'), false)
  assert.equal(button().disabled, false)
  assert.equal(notifications.length, 1)
})
