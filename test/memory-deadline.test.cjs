const assert = require('node:assert/strict')
const { test } = require('node:test')
const { once } = require('node:events')
const { createRequire } = require('node:module')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const KEY = 'SYNTHETIC_TARGET'
const READY = 'shell echo ready\n'
const MEMORY = 'shell cat /proc/meminfo'
const INFO = 'shell SP_daemon -deviceinfo\necho "echo_separator"\nuname -a'
const SCREEN = 'shell hidumper -s RenderService -a screen'
function frame(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const size = Buffer.alloc(4); size.writeUInt32BE(body.length)
  return Buffer.concat([size, body])
}
function load(file, imports = {}, globals = {}) {
  const filename = path.resolve(ROOT, file), localRequire = createRequire(filename)
  const module = { exports: {} }
  let code = fs.readFileSync(filename, 'utf8')
  if (/\.tsx?$/.test(file)) code = transformSync(code, { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code
  vm.runInNewContext(code, {
    module, exports: module.exports, Buffer, AbortController, setTimeout, clearTimeout,
    require(id) { return Object.hasOwn(imports, id) ? imports[id] : localRequire(id) },
    ...globals,
  }, { filename })
  return module.exports
}
const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }))
async function bounded(promise, ms = 1200) {
  let timer
  try { return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve({ pending: true }), ms) })]) }
  finally { clearTimeout(timer) }
}

// Production handlers, base, parameters, finiteShell and installed hdckit all run.
// Only TCP endpoints, Electron registration, tracker and other module init are
// isolated. Every socket is remapped to this fixture's random loopback listener.
async function fixture(t, { wallClock = false, envPort, expectedPort = 8710 } = {}) {
  const state = { stall: '', mem: 'MemTotal: 8192 kB\nMemFree: 1024 kB\nMemAvailable: 3072 kB\n', requests: [], deadlines: [] }
  const clients = [], peers = [], handlers = new Map(), initOptions = []
  let stopping = false, sequence = 0
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('error', () => {})
    if (stopping) { socket.destroy(); return }
    peers.push(socket)
    const index = ++sequence
    // Each overview has two preceding commands, each with ready + command.
    const memoryProbe = index === 5
    if (!(state.stall === 'handshake' && memoryProbe)) {
      // Synthetic payload with the 44-byte length observed on a real server.
      const hello = Buffer.alloc(44); hello.write('OHOS HDC'); socket.write(frame(hello))
    }
    let buffer = Buffer.alloc(0), handshaken = false
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE(0) + 4) {
        const size = buffer.readUInt32BE(0), data = buffer.subarray(4, size + 4)
        buffer = buffer.subarray(size + 4)
        if (!handshaken) { handshaken = true; assert.equal(data.subarray(12).toString().replace(/\0.*$/s, ''), KEY); continue }
        const command = data.toString()
        state.requests.push(command)
        if (command === READY) {
          if (state.stall === 'ready' && memoryProbe) return
          socket.end(frame('ready\n'))
        } else if (command === 'shell param get') {
          socket.end(frame('const.product.name = Synthetic\nconst.product.cpu.abilist = arm64\n'))
        } else if (command === INFO) {
          socket.end(frame('sn: SYNTHETIC\ndeviceTypeName: TestCPU\necho_separator\nLinux synthetic #1'))
        } else if (command === MEMORY) {
          if (state.stall === 'read') { socket.write(frame('MemTotal: 1 kB\n')); return }
          if (state.stall === 'reset') { socket.resetAndDestroy(); return }
          if (state.stall === 'truncated') { socket.end(Buffer.from([0, 0, 0, 5, 65])); return }
          socket.end(frame(state.mem))
        } else if (command === SCREEN) socket.end(frame('physical screen resolution: 1080x1920'))
        else if (command === 'shell uinput -K -d 3 -u 3') socket.end(frame(''))
        else throw new Error(`Unexpected command: ${command}`)
      }
    })
  })
  t.after(async () => {
    stopping = true
    const done = server.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve()
    const sockets = [...clients, ...peers]
    const closes = sockets.filter((s) => !s.closed).map((s) => new Promise((resolve) => s.once('close', resolve)))
    for (const s of sockets) s.destroy(new Error('fixture teardown'))
    await Promise.all([...closes, done])
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  function scoped(kind) {
    class Socket extends net.Socket {
      constructor() { super(); this.kind = kind; clients.push(this); this.on('error', () => {}) }
      connect(options) {
        assert.equal(stopping, false)
        assert.equal(options.host, '127.0.0.1')
        assert.equal(options.port, expectedPort)
        return super.connect({ host: '127.0.0.1', port: address.port })
      }
    }
    return { Socket, isIP: net.isIP, connect: (options) => new Socket().connect(options) }
  }
  const dir = path.dirname(require.resolve('hdckit'))
  const Connection = load(path.join(dir, 'hdc/Connection.js'), {
    'node:net': scoped('legacy'),
    'node:child_process': { execFile() { throw new Error('Real HDC start forbidden') } },
  })
  const { default: Client } = load(path.join(dir, 'hdc/Client.js'), { './Connection': Connection })
  const processEnv = { env: { OHOS_HDC_SERVER_PORT: envPort } }
  const { default: Hdc } = load(path.join(dir, 'Hdc.js'), { './hdc/Client': Client }, { process: processEnv })
  const util = { handleEvent: (name, handler) => handlers.set(name, handler), resolveResources: (name) => name }
  const logger = () => ({ debug() {}, info() {}, warn() {}, error() {} })
  const base = load('src/main/lib/hdc/base.ts', { 'share/main/lib/util': util, 'share/common/log': logger })
  const finite = load('src/main/lib/hdc/finiteShell.ts', { 'node:net': scoped('finite') }, {
    setTimeout(callback, ms) { state.deadlines.push(ms); return setTimeout(callback, wallClock ? ms : 100) },
  })
  const imports = {
    hdckit: { createClient(options) {
      initOptions.push(options)
      const client = Hdc.createClient(options)
      client.trackTargets = async () => ({ on() {} })
      client.kill = () => { throw new Error('Real HDC kill forbidden') }
      return client
    } },
    electron: { app: { on() {} } },
    'share/main/lib/util': util, 'share/common/log': logger,
    'share/main/lib/window': { sendTo() {} },
    './store': { getSettingsStore: () => ({ get: () => '' }) },
    './hdc/base': base,
    './hdc/parameters': load('src/main/lib/hdc/parameters.ts'),
    './hdc/finiteShell': finite,
    'node:process': processEnv,
    'node:child_process': { spawn() { throw new Error('process forbidden') }, exec() { throw new Error('process forbidden') } },
  }
  for (const name of ['bundle', 'shell', 'port', 'uitest', 'hilog', 'webview']) imports[`./hdc/${name}`] = { init() {} }
  await load('src/main/lib/hdc.ts', imports).init()
  return { state, clients, peers, initOptions, overview: () => handlers.get('getOverview')(KEY), input: () => handlers.get('inputKey')(KEY, 3) }
}

test('overview routes only memory through finite transport and retains memory/overview fields', async (t) => {
  const f = await fixture(t)
  const result = await f.overview()
  assert.equal(result.memTotal, 8388608)
  assert.equal(result.memUsed, 5242880)
  assert.equal(result.name, 'Synthetic')
  assert.equal(result.kernelVersion, 'Linux synthetic ')
  assert.equal(result.physicalResolution, '1080x1920')
  assert.equal(f.clients.filter((s) => s.kind === 'finite').length, 2)
  assert.deepEqual(f.state.deadlines, [10000])
  assert.equal(f.initOptions[0].host, '127.0.0.1')
  assert.equal(f.initOptions[0].port, 8710)
  assert.deepEqual(f.state.requests, [READY, 'shell param get', READY, INFO, READY, MEMORY, READY, SCREEN])
  await f.input()
  assert.deepEqual(f.state.requests.slice(-2), [READY, 'shell uinput -K -d 3 -u 3'])
  assert.equal(f.clients.filter((s) => s.kind === 'finite').length, 2)
})

for (const [envPort, expectedPort] of [
  ['18710', 18710], [' 23456 ', 23456], ['23456suffix', 23456],
  ['', 8710], ['not-a-port', 8710], ['   ', 8710],
]) {
  test(`real factory and finite memory share env port ${JSON.stringify(envPort)}`, async (t) => {
    const f = await fixture(t, { envPort, expectedPort })
    assert.equal((await f.overview()).memTotal, 8388608)
    assert.equal(f.initOptions[0].port, expectedPort)
    assert.equal(f.clients.filter((s) => s.kind === 'finite').length, 2)
  })
}

for (const envPort of ['0', '-1', '65536']) {
  test(`invalid numeric env port ${envPort} rejects before any connection`, async (t) => {
    await assert.rejects(fixture(t, { envPort }), /Invalid OHOS_HDC_SERVER_PORT/)
  })
}

for (const [mem, total, used] of [
  ['MemTotal: 8192 kB\nMemFree: 1024 kB\n', 8388608, 7340032],
  ['MemTotal: 8192 kB\nMemAvailable: 0 kB\n', 8388608, 8388608],
  ['unrelated field\n', 0, 0],
]) {
  test(`memory parser preserves compatibility: ${JSON.stringify(mem)}`, async (t) => {
    const f = await fixture(t); f.state.mem = mem
    const result = await f.overview()
    assert.equal(result.memTotal, total); assert.equal(result.memUsed, used)
  })
}

for (const phase of ['handshake', 'ready', 'read']) {
  test(`overview rejects stalled memory ${phase}, closes sockets, ignores late output and recovers`, { timeout: 4000 }, async (t) => {
    const f = await fixture(t); f.state.stall = phase
    const result = await bounded(outcome(f.overview()))
    assert.equal(result.error?.code, 'HDC_COMMAND_TIMEOUT')
    assert.equal(result.error.stage, phase)
    assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
    assert.equal(f.state.requests.includes(SCREEN), false)
    assert.equal(f.state.requests.filter((x) => x === MEMORY).length, phase === 'read' ? 1 : 0)
    const count = f.clients.length
    f.peers.at(-1).end(frame('MemTotal: 100 kB\nMemFree: 50 kB\n'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(f.clients.length, count, 'no retry after timeout')
    f.state.stall = ''
    assert.equal((await f.overview()).memTotal, 8388608)
  })
}

for (const mode of ['reset', 'truncated']) {
  test(`memory ${mode} rejects overview without retry or fallback`, async (t) => {
    const f = await fixture(t); f.state.stall = mode
    const result = await outcome(f.overview())
    assert.equal(result.error?.code, mode === 'reset' ? 'ECONNRESET' : 'HDC_COMMAND_PROTOCOL')
    assert.equal(f.state.requests.filter((x) => x === MEMORY).length, 1)
    assert.equal(f.state.requests.includes(SCREEN), false)
    assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
  })
}

for (const text of ['[Fail] cat denied', '[E000001] failed', 'error: failed']) {
  test(`explicit memory command failure rejects overview: ${text}`, async (t) => {
    const f = await fixture(t); f.state.mem = text
    const result = await outcome(f.overview())
    assert.match(result.error?.message ?? '', /memory command failed/)
    assert.equal(f.state.requests.includes(SCREEN), false)
    assert.equal(f.state.requests.filter((x) => x === MEMORY).length, 1)
  })
}

test('production ten-second memory deadline expires on the real clock', { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { wallClock: true }); f.state.stall = 'read'
  const started = performance.now()
  const result = await bounded(outcome(f.overview()), 12000)
  const elapsed = performance.now() - started
  assert.equal(result.error?.code, 'HDC_COMMAND_TIMEOUT')
  assert.ok(elapsed >= 9900 && elapsed < 12000, `elapsed ${elapsed}`)
  assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
})

test('real memory timeout clears Overview details and permits UI retry', { timeout: 5000 }, async (t) => {
  const { JSDOM } = require('jsdom'), React = require('react')
  const { act } = React, h = React.createElement, Empty = () => null
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  global.window = dom.window; global.document = dom.window.document
  global.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const f = await fixture(t), notifications = []
  let pending
  const main = { getOverview() { pending = outcome(f.overview()); return pending.then(({ value, error }) => { if (error) throw error; return value }) } }
  const Component = load('src/renderer/main/components/overview/Overview.tsx', {
    './Overview.module.scss': {},
    '../../store': { target: { key: KEY, ohosVersion: '6.0', sdkVersion: '20' } },
    'common/util': { t: (key) => key },
    'share/renderer/lib/util': { notify: (...args) => notifications.push(args) },
    'share/renderer/components/ToolbarIcon': ({ icon, onClick, disabled }) => h('button', { 'data-action': icon, onClick, disabled }),
    'luna-toolbar/react': { __esModule: true, default: ({ children }) => h('div', null, children), LunaToolbarSpace: Empty },
    '../common/loading': { PannelLoading: () => h('div', { 'data-loading': true }) },
    './PortMappingModal': Empty, './RemoteControllerModal': Empty,
  }, { main }).default
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); delete global.window; delete global.document; delete global.IS_REACT_ACT_ENVIRONMENT })
  const button = () => container.querySelector('[data-action="refresh"]')
  await act(async () => root.render(h(Component)))
  await act(async () => { await pending })
  assert.ok(container.textContent.includes('Synthetic'))
  f.state.stall = 'read'
  await act(async () => button().click())
  assert.equal(button().disabled, true)
  await act(async () => { assert.equal((await pending).error?.code, 'HDC_COMMAND_TIMEOUT') })
  assert.equal(container.textContent.includes('Synthetic'), false)
  assert.equal(container.querySelector('[data-loading]'), null)
  assert.equal(button().disabled, false)
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0][1].icon, 'error')
  f.state.stall = ''
  await act(async () => button().click())
  await act(async () => { await pending })
  assert.ok(container.textContent.includes('Synthetic'))
  assert.equal(button().disabled, false)
  assert.equal(notifications.length, 1)
})
