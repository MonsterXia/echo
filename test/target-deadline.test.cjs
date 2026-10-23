const assert = require('node:assert/strict')
const { test } = require('node:test')
const net = require('node:net')
const path = require('node:path')
const { once } = require('node:events')
const { AsyncLocalStorage } = require('node:async_hooks')
const { load, frame, outcome, bounded } = require('./helpers/overview-fixture.cjs')

const BAD = 'SYNTHETIC_STALLED', GOOD = '127.0.0.1:45678', LAST = 'SYNTHETIC_LAST'
const READY = 'shell echo ready\n', PARAM = 'shell param get'
const PARAMETERS = 'const.product.name = Synthetic\nconst.product.software.version = OpenHarmony 6.0.0.1\nconst.ohos.apiversion = 20\n'

async function fixture(t, { wallClock = false, envPort = '18710' } = {}) {
  const state = { keys: [BAD, GOOD, LAST], mode: '', badKeys: new Set([BAD]), output: PARAMETERS, hostBadHello: false, requests: [], budgets: [], writes: [], peers: [] }
  const context = new AsyncLocalStorage(), clients = [], timers = new Set(), logs = [], handlers = new Map()
  let stopping = false, endpoint
  const silent = net.createServer((socket) => { socket.on('error', () => {}); state.peers.push(socket); if (stopping) socket.destroy() })
  const server = net.createServer((socket) => {
    socket.on('error', () => {}); state.peers.push(socket)
    if (stopping) { socket.destroy(); return }
    const hello = Buffer.alloc(44); hello.write(state.hostBadHello ? 'BAD SERVER' : 'OHOS HDC'); socket.write(frame(hello))
    let buffered = Buffer.alloc(0), key
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length >= 4 && buffered.length >= buffered.readUInt32BE(0) + 4) {
        const length = buffered.readUInt32BE(0), data = buffered.subarray(4, length + 4)
        buffered = buffered.subarray(length + 4)
        if (key === undefined) { key = data.subarray(12).toString().replace(/\0.*$/s, ''); socket.key = key; continue }
        const command = data.toString(), bad = state.badKeys.has(key)
        state.requests.push({ key, command })
        if (command === 'list targets') socket.end(frame(state.keys.length ? state.keys.join('\n') + '\n' : '[Empty]'))
        else if (command === READY) {
          if (!(bad && state.mode === 'ready')) socket.end(frame('ready\n'))
        } else if (command === PARAM) {
          if (bad && state.mode === 'read') { socket.write(frame('const.product.name = Partial\n')); continue }
          if (bad && state.mode === 'reset') { socket.resetAndDestroy(); continue }
          if (bad && state.mode === 'truncated') { socket.end(Buffer.from([0, 0, 0, 5, 65])); continue }
          socket.end(frame(bad ? state.output : PARAMETERS))
        } else throw new Error(`Unexpected synthetic command: ${command}`)
      }
    })
  })
  t.after(async () => {
    stopping = true
    const closed = [server, silent].map((s) => s.listening ? new Promise((resolve) => s.close(resolve)) : Promise.resolve())
    const sockets = [...clients, ...state.peers]
    const socketCloses = sockets.filter((s) => !s.closed).map((s) => new Promise((resolve) => s.once('close', resolve)))
    for (const s of sockets) s.destroy()
    await Promise.all([...closed, ...socketCloses])
  })
  for (const s of [server, silent]) { s.listen(0, '127.0.0.1'); await once(s, 'listening') }
  function scoped(kind) {
    class Socket extends net.Socket {
      constructor() { super(); this.kind = kind; this.key = context.getStore(); clients.push(this); this.on('error', () => {}) }
      connect(options) {
        assert.equal(stopping, false); assert.equal(options.host, endpoint.host); assert.equal(options.port, endpoint.port)
        const bad = kind === 'finite' && state.badKeys.has(this.key)
        if (bad && state.mode === 'connect') return this
        return super.connect({ host: '127.0.0.1', port: (bad && state.mode === 'handshake' ? silent : server).address().port })
      }
      _write(data, encoding, callback) {
        if (kind === 'finite' && state.badKeys.has(this.key) && state.mode === 'send' && data.subarray(4).toString() === PARAM) { state.writes.push(callback); return }
        return super._write(data, encoding, callback)
      }
    }
    return { Socket, isIP: net.isIP, connect: (options) => new Socket().connect(options) }
  }
  const dir = path.dirname(require.resolve('hdckit'))
  const Connection = load(path.join(dir, 'hdc/Connection.js'), {
    'node:net': scoped('legacy'),
    'node:child_process': { execFile() { throw new Error('Real HDC startup forbidden') } },
  })
  const { default: Client } = load(path.join(dir, 'hdc/Client.js'), { './Connection': Connection })
  const processEnv = { env: { OHOS_HDC_SERVER_PORT: envPort } }
  const { default: Hdc } = load(path.join(dir, 'Hdc.js'), { './hdc/Client': Client }, { process: processEnv })
  const finite = load('src/main/lib/hdc/finiteShell.ts', { 'node:net': scoped('finite') }, {
    setTimeout(callback, ms) { state.budgets.push(ms); const timer = setTimeout(callback, wallClock ? ms : 100); timers.add(timer); return timer },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer) },
  })
  const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((level) => [level, (...args) => logs.push({ level, args })]))
  const imports = {
    hdckit: { createClient(options) {
      endpoint = options
      const client = Hdc.createClient(options)
      client.trackTargets = async () => ({ on() {} })
      return client
    } },
    './hdc/parameters': load('src/main/lib/hdc/parameters.ts'),
    // Only carries the request key to socket fault injection; no result/timeout replacement.
    './hdc/finiteShell': { runFiniteShell: (key, command, options) => context.run(key, () => finite.runFiniteShell(key, command, options)) },
    electron: { app: { on() {} } }, 'node:process': processEnv, 'node:child_process': {},
    'share/main/lib/util': { handleEvent: (name, handler) => handlers.set(name, handler), resolveResources: (name) => name },
    'share/common/log': () => logger, 'share/main/lib/window': { sendTo() {} },
    './store': { getSettingsStore: () => ({ get: () => '' }) },
  }
  for (const name of ['base', 'bundle', 'shell', 'port', 'uitest', 'hilog', 'webview']) imports[`./hdc/${name}`] = { init() {} }
  await load('src/main/lib/hdc.ts', imports).init()
  return { state, clients, timers, logs, getTargets: () => handlers.get('getTargets')() }
}

for (const phase of ['connect', 'handshake', 'ready', 'send', 'read']) {
  test(`one device stalled at ${phase} cannot indefinitely withhold healthy targets`, { timeout: 4000 }, async (t) => {
    const f = await fixture(t); f.state.mode = phase
    const result = await bounded(outcome(f.getTargets()))
    assert.deepEqual(Array.from(result.value ?? [], (v) => v.key), [GOOD, LAST])
    assert.deepEqual(f.state.budgets, [10000, 10000, 10000])
    assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
    assert.equal(f.timers.size, 0)
    const error = f.logs.find(({ args }) => args[0] === 'Failed to read HDC target parameters' && args[1] === BAD)?.args[2]
    assert.equal(error?.code, 'HDC_COMMAND_TIMEOUT'); assert.equal(error.stage, phase)
    assert.equal(f.state.requests.filter((r) => r.key === BAD && r.command === PARAM).length, phase === 'read' ? 1 : 0)
    if (phase === 'send') assert.equal(f.state.writes.length, 1)
    const count = f.clients.length
    for (const peer of f.state.peers.filter((s) => s.key === BAD)) peer.end(frame('const.product.name = Late\n'))
    for (const callback of f.state.writes) callback(new Error('late write error'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(f.clients.length, count)
    f.state.mode = ''
    assert.deepEqual(Array.from(await f.getTargets(), (v) => v.key), [BAD, GOOD, LAST])
    assert.equal(f.state.requests.filter((r) => r.command === 'list targets').length, 2)
  })
}

for (const errorText of ['[Fail] private-synthetic', '[E000001] private-synthetic', 'error: private-synthetic']) {
  test(`parameter errors isolate a device without logging its raw response: ${errorText}`, async (t) => {
    const f = await fixture(t); f.state.output = errorText
    assert.deepEqual(Array.from(await f.getTargets(), (v) => v.key), [GOOD, LAST])
    assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
    assert.ok(!JSON.stringify(f.logs, (_, value) => value instanceof Error ? value.message : value).includes('private-synthetic'))
    f.state.output = PARAMETERS
    assert.equal((await f.getTargets()).length, 3)
  })
}

for (const mode of ['reset', 'truncated']) {
  test(`parameter ${mode} isolates the failed device and a later refresh recovers`, async (t) => {
    const f = await fixture(t); f.state.mode = mode
    assert.deepEqual(Array.from(await f.getTargets(), (v) => v.key), [GOOD, LAST])
    assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
    f.state.mode = ''
    assert.equal((await f.getTargets()).length, 3)
  })
}

test('all timed-out devices reject with an aggregate error and the next refresh succeeds', async (t) => {
  const f = await fixture(t); f.state.badKeys = new Set(f.state.keys); f.state.mode = 'read'
  const result = await bounded(outcome(f.getTargets()))
  assert.match(result.error?.message ?? '', /No HDC target parameters could be read/)
  assert.equal(f.logs.filter(({ args }) => args[2]?.code === 'HDC_COMMAND_TIMEOUT').length, 3)
  assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
  assert.equal(f.timers.size, 0)
  f.state.mode = ''
  assert.equal((await f.getTargets()).length, 3)
})

test('empty host enumeration creates no finite read; host failure still rejects and recovers', async (t) => {
  const f = await fixture(t); f.state.keys = []
  assert.equal((await f.getTargets()).length, 0)
  assert.deepEqual(f.state.budgets, [])
  assert.ok(f.clients.every((s) => s.kind === 'legacy'))
  f.state.hostBadHello = true
  await assert.rejects(f.getTargets(), /Failed to list HDC targets/)
  assert.deepEqual(f.state.budgets, [])
  f.state.hostBadHello = false; f.state.keys = [GOOD]
  assert.equal((await f.getTargets())[0].key, GOOD)
})

test('ten-second per-device budget expires on the real clock', { timeout: 14000 }, async (t) => {
  const f = await fixture(t, { wallClock: true }); f.state.mode = 'read'
  const start = performance.now(), result = await bounded(outcome(f.getTargets()), 12000)
  const elapsed = performance.now() - start
  assert.deepEqual(Array.from(result.value ?? [], (v) => v.key), [GOOD, LAST])
  assert.ok(elapsed >= 9900 && elapsed < 12000, `elapsed ${elapsed}`)
  assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
})
