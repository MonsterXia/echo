const assert = require('node:assert/strict')
const { test } = require('node:test')
const { once, getEventListeners } = require('node:events')
const { createRequire } = require('node:module')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

const key = 'SYNTHETIC_TARGET'
const READY = 'shell echo ready\n'
const COMMAND = 'shell echo synthetic'
const MAX_OUTPUT = 16 * 1024 * 1024
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
function frame(data) {
  const value = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(value.length)
  return Buffer.concat([size, value])
}
function hello() {
  const data = Buffer.alloc(16)
  data.write('OHOS HDC')
  data.set([1, 2, 3, 4], 8)
  data.writeUInt32BE(123, 12)
  return frame(data)
}
function load(filename, overrides = {}, ts = false, runtime = {}) {
  const localRequire = createRequire(filename), module = { exports: {} }
  let code = fs.readFileSync(filename, 'utf8')
  if (ts) code = transformSync(code, { loader: 'ts', format: 'cjs' }).code
  vm.runInNewContext(code, {
    module, exports: module.exports, Buffer, AbortController, setTimeout, clearTimeout,
    require(id) { return Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id) },
    ...runtime,
  }, { filename })
  return module.exports
}
async function bounded(promise, ms = 1500) {
  let timer
  try {
    return await Promise.race([promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve({ missingDeadline: true }), ms) })])
  } finally { clearTimeout(timer) }
}
function outcome(promise) { return promise.then((value) => ({ value }), (error) => ({ error })) }

async function fixture(t, { greet = true, onCommand, connectStalls = false, writeStalls = false, fragmentReads = false } = {}) {
  const clients = [], peers = [], commands = [], handshakes = [], heldWrites = []
  const timers = new Set(), controllers = []
  const accepted = deferred(), ready = deferred(), command = deferred(), writing = deferred()
  let stopping = false
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('error', () => {})
    if (stopping) { socket.destroy(); return }
    peers.push(socket)
    accepted.resolve(socket)
    let buffer = Buffer.alloc(0), hasHandshake = false
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE(0) + 4) {
        const size = buffer.readUInt32BE(0), data = buffer.subarray(4, size + 4)
        buffer = buffer.subarray(size + 4)
        if (!hasHandshake) { hasHandshake = true; handshakes.push(data); continue }
        const text = data.toString()
        commands.push(text)
        if (text === READY) ready.resolve(socket)
        else command.resolve(socket)
        if (onCommand) onCommand(socket, text, commands)
        else socket.end(frame(text === READY ? 'ready\n' : 'value\n'))
      }
    })
    if (greet) socket.write(hello())
  })
  t.after(async () => {
    stopping = true
    const closed = server.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve()
    const sockets = [...peers, ...clients]
    const closes = sockets.filter((s) => !s.closed).map((s) => new Promise((resolve) => s.once('close', resolve)))
    for (const socket of sockets) socket.destroy(new Error('fixture teardown'))
    await Promise.all([...closes, closed])
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  class ScopedSocket extends net.Socket {
    constructor(...args) { super(...args); clients.push(this) }
    async *[Symbol.asyncIterator]() {
      for await (const chunk of super[Symbol.asyncIterator]()) {
        if (fragmentReads && chunk.length > 3) {
          yield chunk.subarray(0, 1)
          yield chunk.subarray(1, 3)
          yield chunk.subarray(3)
        } else yield chunk
      }
    }
    connect(options) {
      assert.equal(stopping, false)
      assert.equal(options.host, '127.0.0.1')
      assert.equal(options.port, port)
      if (connectStalls) return this
      return super.connect(options)
    }
    _write(data, encoding, callback) {
      if (writeStalls === true || (writeStalls === 'command' && data.subarray(4).toString() === COMMAND)) {
        heldWrites.push(callback); writing.resolve(); return
      }
      return super._write(data, encoding, callback)
    }
  }
  const scopedNet = { Socket: ScopedSocket, isIP: net.isIP, connect: (options) => new ScopedSocket().connect(options) }
  let run
  if (process.env.HDC_FINITE_BASELINE === '1') {
    // Reproduce the contract failure on the actual old base/hdckit path. Its
    // process boundary is forbidden, even when teardown causes a late retry.
    const dir = path.dirname(require.resolve('hdckit'))
    const Connection = load(path.join(dir, 'hdc/Connection.js'), {
      'node:net': scopedNet,
      'node:child_process': { execFile() { throw new Error('HDC launch forbidden') } },
    })
    const { default: Client } = load(path.join(dir, 'hdc/Client.js'), { './Connection': Connection })
    const base = load(path.resolve(__dirname, '../src/main/lib/hdc/base.ts'), {
      'share/common/log': () => ({ debug() {} }),
      'share/main/lib/util': { handleEvent() {} },
    }, true)
    await base.init(new Client({ host: '127.0.0.1', port }))
    run = (target, cmd) => base.shell(target, cmd)
  } else {
    run = load(path.resolve(__dirname, '../src/main/lib/hdc/finiteShell.ts'), { 'node:net': scopedNet }, true, {
      AbortController: class extends AbortController { constructor() { super(); controllers.push(this) } },
      setTimeout(callback, ms) {
        const timer = setTimeout(() => { timers.delete(timer); callback() }, ms)
        timers.add(timer); return timer
      },
      clearTimeout(timer) { timers.delete(timer); clearTimeout(timer) },
    }).runFiniteShell
  }
  return { run: (options = {}, cmd = 'echo synthetic', target = key) => run(target, cmd, {
    host: '127.0.0.1', port, timeoutMs: 2000, ...options,
  }), clients, peers, commands, handshakes, accepted, ready, command, writing, heldWrites, server, timers, controllers }
}

test('deadline destroys a silent handshake and rejects before returning to caller', { timeout: 4000 }, async (t) => {
  const f = await fixture(t, { greet: false })
  const result = outcome(f.run({ timeoutMs: 100 }))
  await f.accepted.promise
  const value = await bounded(result)
  assert.equal(value.error?.code, 'HDC_COMMAND_TIMEOUT', 'a live handshake must be cancelled, not left pending')
  assert.equal(value.error.stage, 'handshake')
  assert.ok(f.clients.every((s) => s.closed))
  assert.deepEqual(f.commands, [])
})

for (const phase of ['ready', 'read']) {
  test(`deadline cancels stalled ${phase}, discards partial data and the next request recovers`, { timeout: 4000 }, async (t) => {
    let stall = true
    const f = await fixture(t, { onCommand(socket, cmd) {
      if (stall && (phase === 'ready' || cmd === COMMAND)) { socket.write(frame('partial')); return }
      socket.end(frame(cmd === READY ? 'ready\n' : 'recovered'))
    } })
    const result = outcome(f.run({ timeoutMs: 100 }))
    await (phase === 'ready' ? f.ready : f.command).promise
    const value = await bounded(result)
    assert.equal(value.error?.code, 'HDC_COMMAND_TIMEOUT')
    assert.equal(value.error.stage, phase)
    assert.ok(f.clients.every((s) => s.closed))
    stall = false
    assert.equal(await f.run(), 'recovered')
  })
}

for (const phase of ['handshake', 'ready', 'read']) {
  test(`external abort during ${phase} closes owned sockets and suppresses late success`, { timeout: 4000 }, async (t) => {
    const f = await fixture(t, { greet: phase !== 'handshake', onCommand(socket, cmd) {
      if (phase === 'ready' || cmd === COMMAND) return
      socket.end(frame('ready\n'))
    } })
    const controller = new AbortController()
    const result = outcome(f.run({ signal: controller.signal }))
    const peer = await (phase === 'handshake' ? f.accepted : phase === 'ready' ? f.ready : f.command).promise
    if (phase === 'handshake') {
      if (f.clients[0].connecting) await once(f.clients[0], 'connect')
      await new Promise((resolve) => setImmediate(resolve))
    }
    controller.abort('private reason is not logged')
    peer.end(phase === 'handshake' ? hello() : frame('late success'))
    const value = await bounded(result)
    assert.equal(value.error?.code, 'HDC_COMMAND_ABORTED')
    assert.equal(value.error.stage, phase)
    assert.ok(f.clients.every((s) => s.closed))
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    assert.ok(!value.error.message.includes(key))
    if (phase !== 'read') assert.ok(!f.commands.includes(COMMAND))
  })
}

test('pre-aborted and invalid requests allocate no socket', async (t) => {
  const f = await fixture(t)
  const controller = new AbortController(); controller.abort()
  assert.equal((await outcome(f.run({ signal: controller.signal }))).error.code, 'HDC_COMMAND_ABORTED')
  for (const timeoutMs of [0, -1, Infinity, NaN, 2 ** 31, 1.5]) {
    await assert.rejects(f.run({ timeoutMs }), /timeoutMs/)
  }
  for (const target of ['', 'a'.repeat(33), 'a\0b']) await assert.rejects(f.run({}, 'echo synthetic', target), /connectKey/)
  assert.equal(f.clients.length, 0)
})

test('finite command preserves raw output, split frames and wire handshake', { timeout: 4000 }, async (t) => {
  // Fragment at the stream iterator boundary so TCP coalescing cannot hide it.
  const f = await fixture(t, { fragmentReads: true, onCommand(socket, cmd) {
    if (cmd === READY) return socket.end(frame('ready\n'))
    const data = Buffer.concat([frame('  first\n'), frame('second  \n')])
    socket.write(data.subarray(0, 2)); socket.end(data.subarray(2))
  } })
  assert.equal(await f.run(), '  first\nsecond  \n')
  assert.deepEqual(f.commands, [READY, COMMAND])
  assert.equal(f.handshakes.length, 2)
  for (const value of f.handshakes) {
    assert.equal(value.length, 44)
    assert.deepEqual(value.subarray(0, 12), hello().subarray(4, 16))
    assert.equal(value.subarray(12).toString().replace(/\0/g, ''), key)
  }
  assert.ok(f.clients.every((s) => s.closed))
})

test('ready retry shares the deadline and sends the user command exactly once', { timeout: 5000 }, async (t) => {
  let probes = 0
  const f = await fixture(t, { onCommand(socket, cmd) {
    socket.end(frame(cmd === READY && ++probes === 1 ? '[Fail] E000004' : 'ready'))
  } })
  assert.equal(await f.run({ timeoutMs: 3000 }), 'ready')
  assert.deepEqual(f.commands, [READY, READY, COMMAND])
})

test('deadline during ready retry delay prevents another connection', { timeout: 4000 }, async (t) => {
  const f = await fixture(t, { onCommand(socket) { socket.end(frame('E000004')) } })
  const value = await outcome(f.run({ timeoutMs: 100 }))
  assert.equal(value.error.code, 'HDC_COMMAND_TIMEOUT')
  assert.equal(value.error.stage, 'ready')
  assert.equal(f.clients.length, 1)
  assert.deepEqual(f.commands, [READY])
})

test('abort during ready retry delay releases its listener and prevents another connection', { timeout: 4000 }, async (t) => {
  const f = await fixture(t, { onCommand(socket) { socket.end(frame('E000004')) } })
  const controller = new AbortController(), pending = outcome(f.run({ signal: controller.signal }))
  await f.ready.promise
  if (!f.clients[0].closed) await once(f.clients[0], 'close')
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  const result = await pending
  assert.equal(result.error.code, 'HDC_COMMAND_ABORTED')
  assert.equal(result.error.stage, 'ready')
  assert.equal(f.clients.length, 1)
  for (const c of f.controllers) assert.equal(getEventListeners(c.signal, 'abort').length, 0)
})

test('TCP reset during read rejects and closes the owned socket', { timeout: 4000 }, async (t) => {
  const f = await fixture(t, { onCommand(socket, cmd) {
    if (cmd === READY) socket.end(frame('ready'))
    else socket.resetAndDestroy()
  } })
  const result = await outcome(f.run())
  assert.equal(result.error?.code, 'ECONNRESET')
  assert.ok(f.clients.every((s) => s.closed))
})

for (const mode of ['truncated', 'oversized', 'aggregate-limit', 'invalid-hello', 'empty-hello']) {
  test(`rejects ${mode} protocol output without partial success`, { timeout: 4000 }, async (t) => {
    const badHello = mode.endsWith('hello')
    const f = await fixture(t, { greet: !badHello, onCommand(socket, cmd) {
      if (cmd === READY) return socket.end(frame('ready\n'))
      if (mode === 'truncated') socket.end(Buffer.from([0, 0, 0, 5, 65]))
      if (mode === 'oversized') { const header = Buffer.alloc(4); header.writeUInt32BE(MAX_OUTPUT + 1); socket.end(header) }
      if (mode === 'aggregate-limit') socket.end(Buffer.concat([frame(Buffer.alloc(MAX_OUTPUT)), frame('overflow')]))
    } })
    const result = outcome(f.run())
    if (badHello) {
      const peer = await f.accepted.promise
      peer.end(mode === 'empty-hello' ? undefined : frame('not a valid handshake'))
    }
    assert.equal((await result).error?.code, 'HDC_COMMAND_PROTOCOL')
    assert.ok(f.clients.every((s) => s.closed))
  })
}

test('one cancellation cannot close a concurrent request', { timeout: 4000 }, async (t) => {
  const f = await fixture(t, { onCommand(socket, cmd) {
    if (cmd !== COMMAND) socket.end(frame('ok'))
  } })
  const controller = new AbortController(), cancelled = outcome(f.run({ signal: controller.signal }))
  await f.command.promise
  const healthy = f.run({}, 'echo healthy')
  controller.abort()
  assert.equal((await cancelled).error.code, 'HDC_COMMAND_ABORTED')
  assert.equal(await healthy, 'ok')
})

test('a refused connection rejects without launching or killing any service', { timeout: 4000 }, async (t) => {
  const f = await fixture(t)
  await new Promise((resolve) => f.server.close(resolve))
  const result = await outcome(f.run())
  assert.equal(result.error?.code, 'ECONNREFUSED')
  assert.ok(f.clients.every((s) => s.closed))
})

for (const mode of ['connect', 'handshake-write', 'command-write']) {
 for (const cancellation of ['abort', 'timeout']) {
  test(`${cancellation} during a held ${mode} prevents late error continuation`, { timeout: 4000 }, async (t) => {
    const f = await fixture(t, { connectStalls: mode === 'connect', writeStalls: mode === 'handshake-write' ? true : mode === 'command-write' ? 'command' : false })
    const controller = new AbortController(), pending = outcome(f.run({ signal: controller.signal, timeoutMs: cancellation === 'timeout' ? 100 : 2000 }))
    if (mode !== 'connect') {
      const first = await Promise.race([f.writing.promise.then(() => 'write'), pending])
      assert.equal(first, 'write', 'write must be held before injecting abort')
    }
    if (cancellation === 'abort') controller.abort()
    const result = await bounded(pending)
    assert.equal(result.error?.code, cancellation === 'abort' ? 'HDC_COMMAND_ABORTED' : 'HDC_COMMAND_TIMEOUT')
    assert.equal(result.error.stage, mode === 'command-write' ? 'send' : mode === 'handshake-write' ? 'handshake' : 'connect')
    assert.ok(f.clients.every((s) => s.closed))
    // The transport's late callback must not start a command or resurrect success.
    for (const callback of f.heldWrites) callback(new Error('late write failure'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(f.commands, mode === 'command-write' ? [READY] : [])
  })
 }
}

test('repeated success and cancellation release sockets, abort listeners and deadline timers', { timeout: 5000 }, async (t) => {
  let abortCurrent
  const f = await fixture(t, { onCommand(socket, cmd) {
    if (cmd === COMMAND && abortCurrent) abortCurrent()
    else socket.end(frame('ok'))
  } })
  for (let i = 0; i < 20; i++) {
    const controller = new AbortController()
    abortCurrent = i % 2 ? () => controller.abort() : null
    const result = await f.run({ signal: controller.signal }).then((value) => value, (error) => error.code)
    assert.equal(result, i % 2 ? 'HDC_COMMAND_ABORTED' : 'ok')
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    assert.equal(f.timers.size, 0)
    for (const c of f.controllers) assert.equal(getEventListeners(c.signal, 'abort').length, 0)
    for (const s of f.clients) { assert.ok(s.closed); assert.deepEqual(s.eventNames(), []) }
  }
})

test('cancelling a finite command leaves an unrelated open TCP channel alive', { timeout: 4000 }, async (t) => {
  const f = await fixture(t, { onCommand(socket, cmd) { if (cmd === READY) socket.end(frame('ready')) } })
  const other = net.connect({ host: '127.0.0.1', port: f.server.address().port })
  other.on('error', () => {})
  t.after(() => other.destroy())
  await once(other, 'connect')
  const controller = new AbortController(), result = outcome(f.run({ signal: controller.signal }))
  await f.command.promise
  controller.abort()
  assert.equal((await result).error.code, 'HDC_COMMAND_ABORTED')
  assert.equal(other.destroyed, false)
  assert.equal(other.readable, true)
})
