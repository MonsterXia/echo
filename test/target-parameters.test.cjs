const assert = require('node:assert/strict')
const { test, mock } = require('node:test')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { once } = require('node:events')
const { transformSync } = require('esbuild')

// Install before loading hdckit: even an unexpected ECONNREFUSED must never
// start a real HDC server. Each Node test file has its own process.
const execFile = mock.method(require('node:child_process'), 'execFile', () => {
  throw new Error('M2-5 fixture forbids starting external processes')
})
const Hdc = require('hdckit').default
const ROOT = path.resolve(__dirname, '..')
const KEY = '127.0.0.1:45678' // A label only; never used as a socket destination.
const OTHER = '127.0.0.1:45679'
const PARAMS = 'const.product.name = Synthetic network target\n' +
  'const.product.software.version = 6.0.0.1\nconst.ohos.apiversion = 20\n'

function loadSource(file, imports, globals = {}) {
  const module = { exports: {} }
  const { code } = transformSync(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
    loader: file.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic',
  })
  vm.runInNewContext(code, {
    module, exports: module.exports, ...globals,
    require(id) {
      if (id === './hdc/parameters') return loadSource('src/main/lib/hdc/parameters.ts', {})
      if (Object.hasOwn(imports, id)) return imports[id]
      if (id.startsWith('licia/') || ['node:os', 'node:path', 'fs-extra',
        'mobx', 'react/jsx-runtime'].includes(id)) return require(id)
      throw new Error(`Unmocked import: ${id}`)
    },
  }, { filename: file })
  return module.exports
}

// Minimal host-side HDC framing, not a device or a daemon implementation.
// The actual installed hdckit performs handshake, parsing and target commands.
async function fixture(t) {
  const state = { keys: [KEY], badHello: false, parameters: new Map(), requests: [] }
  const sockets = new Set()
  const errors = []
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', (error) => errors.push(error))
    const send = (text) => {
      const body = Buffer.isBuffer(text) ? text : Buffer.from(text)
      const size = Buffer.alloc(4)
      size.writeUInt32BE(body.length)
      socket.write(Buffer.concat([size, body]))
    }
    const hello = Buffer.alloc(16)
    hello.write(state.badHello ? 'BAD SERVER' : 'OHOS HDC')
    send(hello)
    let buffered = Buffer.alloc(0)
    let key
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length >= 4) {
        const size = buffered.readUInt32BE(0)
        if (size > 4096) {
          errors.push(new Error('Unexpected fixture frame size'))
          socket.destroy()
          return
        }
        if (buffered.length < size + 4) return
        const body = buffered.subarray(4, size + 4)
        buffered = buffered.subarray(size + 4)
        if (key === undefined) {
          key = body.subarray(12).toString().replace(/\0.*$/s, '')
          continue
        }
        const command = body.toString()
        state.requests.push({ key, command })
        if (command === 'list targets') {
          send(state.keys.length ? state.keys.join('\n') + '\n' : '[Empty]')
        } else if (command === 'shell echo ready\n') {
          send('ready\n')
        } else if (command === 'shell param get') {
          send(state.parameters.get(key) ?? PARAMS)
        } else {
          errors.push(new Error(`Unexpected fixture command: ${command}`))
        }
        socket.end()
      }
    })
  })
  // Explicit IPv4 loopback and OS-assigned port; no shared 8710 listener.
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve()))
    assert.deepEqual(errors, [])
    assert.equal(execFile.mock.callCount(), 0, 'No HDC executable may be started')
  })
  const client = Hdc.createClient({
    host: '127.0.0.1', port: server.address().port,
    bin: path.join(ROOT, 'test', '__forbidden_hdc_executable__'),
  })
  const handlers = new Map()
  const logs = []
  const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(
    (level) => [level, (...args) => logs.push({ level, args })]))
  const imports = {
    hdckit: { createClient: () => {
      // Tracker polling/lifecycle is outside this fixture's manual-refresh scope.
      client.trackTargets = async () => ({ on() {} })
      return client
    } },
    electron: { app: { on() {} } },
    'share/main/lib/util': {
      handleEvent: (name, handler) => handlers.set(name, handler),
      resolveResources: (name) => name,
    },
    'share/common/log': () => logger,
    'share/main/lib/window': { sendTo() {} },
    './store': { getSettingsStore: () => ({ get: () => '' }) },
    'node:child_process': {},
  }
  for (const name of ['base', 'bundle', 'shell', 'port', 'uitest', 'hilog', 'webview']) {
    imports[`./hdc/${name}`] = { init() {} }
  }
  await loadSource('src/main/lib/hdc.ts', imports).init()
  const getTargets = handlers.get('getTargets')
  const events = new Map()
  const main = { getTargets, getMainStore: async () => null,
    on: (name, handler) => events.set(name, handler) }
  const store = loadSource('src/renderer/main/store/index.ts', {
    '../../lib/util': { setMainStore() {} },
    'share/renderer/store/BaseStore': class {},
    'share/renderer/lib/util': { setMemStore() {} },
    './settings': { Settings: class {} },
    './application': { Application: class {} },
    './process': { Process: class {} },
    './layout': { Layout: class {} },
  }, { main }).default
  // Await the real constructor, with a bound that also stops the polling loop.
  const deadline = Date.now() + 3000
  while (!store.ready) {
    if (Date.now() > deadline || t.signal.aborted) throw new Error('Store initialization timed out')
    await new Promise(setImmediate)
  }
  function toolbar() {
    const notifications = []
    const Component = loadSource('src/renderer/main/components/toolbar/Target.tsx', {
      'luna-toolbar/react': { __esModule: true, default: 'toolbar', LunaToolbarSelect: 'select' },
      './Target.module.scss': {},
      'mobx-react-lite': { observer: (component) => component },
      '../../store': { __esModule: true, default: store },
      'common/util': { t: (key) => key },
      'share/renderer/components/ToolbarIcon': 'icon',
      'share/renderer/lib/util': { notify: (...args) => notifications.push(args) },
    }, { main }).default
    const children = Component().props.children.props.children
    return { notifications, select: children[0].props,
      refresh: children.find((child) => child.props.icon === 'refresh').props.onClick }
  }
  return { state, logs, getTargets, store, toolbar, events }
}

test('network keys survive real hdckit, getTargets, selection and toolbar options', { timeout: 5000 }, async (t) => {
  const { state, store, toolbar } = await fixture(t)
  state.keys = [KEY, OTHER]
  await store.refreshTargets()
  store.selectTarget(OTHER)
  assert.equal(store.target.key, OTHER)
  assert.deepEqual(Array.from(store.targets, (target) => target.key), [KEY, OTHER])
  assert.equal(toolbar().select.value, OTHER)
  assert.equal(toolbar().select.options[`Synthetic network target (${OTHER})`], OTHER)
  assert.ok(state.requests.some(({ key, command }) => key === OTHER && command === 'shell param get'))
})

test('empty network list clears selection; a new port can be selected after recovery', { timeout: 5000 }, async (t) => {
  const { state, store, toolbar, events } = await fixture(t)
  state.keys = []
  await events.get('changeTarget')()
  assert.equal(store.target, null)
  assert.equal(toolbar().select.disabled, true)
  state.keys = [OTHER]
  await store.refreshTargets()
  assert.equal(store.target.key, OTHER)
  assert.equal(toolbar().select.disabled, false)
})

test('host handshake failure is diagnosed and manual refresh recovers', { timeout: 5000 }, async (t) => {
  const { state, logs, store } = await fixture(t)
  state.badHello = true
  await store.refreshTargets()
  assert.equal(store.target, null)
  assert.ok(logs.some(({ level, args }) => level === 'error' && args[0] === 'Failed to list HDC targets'))
  state.badHello = false
  await store.refreshTargets()
  assert.equal(store.target.key, KEY)
})

test('parameter error text cannot create a selectable target and recovery works', { timeout: 5000 }, async (t) => {
  const { state, store } = await fixture(t)
  state.parameters.set(KEY, '[Fail]Failed to communicate with daemon.\n')
  await store.refreshTargets()
  assert.equal(store.targets.length, 0)
  assert.equal(store.target, null)
  state.parameters.delete(KEY)
  await store.refreshTargets()
  assert.equal(store.target.key, KEY)
})

test('parameter failure is isolated from a healthy peer', { timeout: 5000 }, async (t) => {
  const { state, store } = await fixture(t)
  state.keys = [KEY, OTHER]
  state.parameters.set(KEY, PARAMS + '[Fail][E000003] User denied access\n')
  await store.refreshTargets()
  assert.deepEqual(Array.from(store.targets, (target) => target.key), [OTHER])
})

test('error-looking parameter values and missing optional fields are accepted', { timeout: 5000 }, async (t) => {
  const { state, store } = await fixture(t)
  state.parameters.set(KEY, 'const.product.name = [Fail] synthetic label\r\n')
  await store.refreshTargets()
  assert.equal(store.targets[0].name, '[Fail] synthetic label')
  assert.equal(store.targets[0].sdkVersion, '')
  assert.equal(store.targets[0].ohosVersion, '')
})

test('parameter reader rejects explicit error prefixes and releases the connection', async () => {
  const { getTargetParameters } = loadSource('src/main/lib/hdc/parameters.ts', {})
  for (const output of ['[Fail]denied\n', '[E000003] denied\r\n', '  error: denied\n']) {
    let ended = 0
    const target = { async shell(command) {
      assert.equal(command, 'param get')
      return { readAll: async () => Buffer.from(output), end: () => ended++ }
    } }
    await assert.rejects(getTargetParameters(target), /HDC parameter command failed/)
    assert.equal(ended, 1)
  }
})

test('parameter reader preserves valid values and releases successful or failed reads', async () => {
  const { getTargetParameters } = loadSource('src/main/lib/hdc/parameters.ts', {})
  let ended = 0
  const result = await getTargetParameters({ async shell() {
    return { readAll: async () => Buffer.from('empty = \r\nlabel = error: x = y\r\n'), end: () => ended++ }
  } })
  assert.equal(result.empty, '')
  assert.equal(result.label, 'error: x = y')
  assert.equal(ended, 1)
  await assert.rejects(getTargetParameters({ async shell() {
    return { readAll: async () => { throw new Error('read failed') }, end: () => ended++ }
  } }), /read failed/)
  assert.equal(ended, 2)
})
