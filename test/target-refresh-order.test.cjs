const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

function load(file, imports, main) {
  const module = { exports: {} }
  const { code } = transformSync(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
    loader: file.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic',
  })
  vm.runInNewContext(code, {
    module, exports: module.exports, main,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id]
      if (id.startsWith('licia/') || ['mobx', 'react/jsx-runtime'].includes(id)) return require(id)
      throw new Error(`Unexpected import: ${id}`)
    },
  }, { filename: file })
  return module.exports
}

const target = (key) => ({ key, name: key, ohosVersion: '6.0', sdkVersion: '20' })
const copy = (value) => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(setImmediate)

// Real Store, MobX and toolbar click handler. Only IPC, persistence and UI
// widget boundaries are replaced; each request settles in an explicit order.
async function fixture({ initialize = true } = {}) {
  const requests = [], writes = [], notifications = [], events = new Map()
  const main = {
    getTargets: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    getMainStore: async () => null,
    on: (name, handler) => events.set(name, handler),
  }
  const store = load('src/renderer/main/store/index.ts', {
    '../../lib/util': { setMainStore: (name, value) => writes.push(['main', name, copy(value)]) },
    'share/renderer/store/BaseStore': class {},
    'share/renderer/lib/util': { setMemStore: (name, value) => writes.push(['mem', name, copy(value)]) },
    './settings': { Settings: class {} },
    './application': { Application: class {} },
    './process': { Process: class {} },
    './layout': { Layout: class {} },
  }, main).default
  await tick()
  assert.equal(requests.length, 1)
  if (initialize) {
    requests[0].resolve([target('initial')])
    await tick()
    assert.equal(store.ready, true)
    writes.length = 0
  }
  const Component = load('src/renderer/main/components/toolbar/Target.tsx', {
    'luna-toolbar/react': { __esModule: true, default: 'toolbar', LunaToolbarSelect: 'select' },
    './Target.module.scss': {},
    'mobx-react-lite': { observer: (component) => component },
    '../../store': { __esModule: true, default: store },
    'common/util': { t: (key) => key },
    'share/renderer/components/ToolbarIcon': 'icon',
    'share/renderer/lib/util': { notify: (...args) => notifications.push(args) },
  }, main).default
  const manual = () => Component().props.children.props.children
    .find((child) => child.props.icon === 'refresh').props.onClick()
  const event = () => events.get('changeTarget')()
  return { store, requests, writes, notifications, manual, event }
}

for (const staleFails of [false, true]) {
  for (const latestFails of [false, true]) {
    test(`late ${staleFails ? 'failure' : 'success'} cannot replace latest ${latestFails ? 'failure' : 'empty list'}`, async () => {
      const f = await fixture()
      const older = f.manual()
      const newer = f.event()
      if (latestFails) f.requests[2].reject(new Error('latest failed'))
      else f.requests[2].resolve([])
      await newer
      assert.equal(f.store.target, null)
      assert.equal(f.store.targetsError, latestFails)
      const writes = copy(f.writes)
      if (staleFails) f.requests[1].reject(new Error('obsolete failed'))
      else f.requests[1].resolve([target('obsolete')])
      await older
      assert.deepEqual(copy(f.store.targets), [])
      assert.equal(f.store.target, null)
      assert.equal(f.store.targetsError, latestFails)
      assert.deepEqual(f.writes, writes, 'obsolete results must not persist any state')
      assert.equal(f.notifications.length, 0, 'obsolete manual refresh must not notify')
    })
  }
}

test('older tracker failure cannot erase a newer successful manual refresh', async () => {
  const f = await fixture()
  const older = f.event()
  const newer = f.manual()
  f.requests[2].resolve([target('current')])
  await newer
  const writes = copy(f.writes)
  f.requests[1].reject(new Error('obsolete failed'))
  await older
  assert.deepEqual(copy(f.store.targets), [target('current')])
  assert.equal(f.store.target.key, 'current')
  assert.equal(f.store.targetsError, false)
  assert.deepEqual(f.writes, writes)
  assert.deepEqual(f.notifications.map(([, options]) => options.icon), ['success'])
})

test('superseded result is ignored even while the latest request is pending', async () => {
  const f = await fixture()
  const older = f.manual()
  const newer = f.manual()
  f.requests[1].resolve([target('obsolete')])
  await older
  assert.equal(f.store.target.key, 'initial')
  assert.equal(f.writes.length, 0)
  assert.equal(f.notifications.length, 0)
  f.requests[2].reject(new Error('latest failed'))
  await newer
  assert.equal(f.store.target, null)
  assert.equal(f.store.targetsError, true)
  assert.deepEqual(f.notifications.map(([, options]) => options.icon), ['error'])
  const retry = f.manual()
  f.requests[3].resolve([target('recovered')])
  await retry
  assert.equal(f.store.target.key, 'recovered')
  assert.equal(f.store.targetsError, false)
  assert.deepEqual(f.notifications.map(([, options]) => options.icon), ['error', 'success'])
})

test('late initialization result cannot replace a completed tracker refresh', async () => {
  const f = await fixture({ initialize: false })
  const newer = f.event()
  f.requests[1].resolve([target('current')])
  await newer
  f.requests[0].resolve([target('obsolete')])
  await tick()
  assert.equal(f.store.ready, true)
  assert.deepEqual(copy(f.store.targets), [target('current')])
  assert.equal(f.store.target.key, 'current')
})
