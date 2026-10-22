const assert = require('node:assert/strict')
const { test } = require('node:test')
const { once } = require('node:events')
const { createRequire } = require('node:module')
const net = require('node:net')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

// Characterization of the missing cancellation boundary, NOT a timeout fix.
// Real base.ts -> hdckit Client/Target/Connection -> TCP on an ephemeral loopback
// port. Only logging/IPC registration and process launch are replaced. No HDC
// executable, device, device identifier, or installed-application data is used.
const fixtureKey = 'SYNTHETIC_TARGET'
const hdckitDir = path.dirname(require.resolve('hdckit'))
const basePath = path.resolve(__dirname, '../src/main/lib/hdc/base.ts')

function loadModule(filename, overrides = {}, typescript = false) {
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  const source = fs.readFileSync(filename, 'utf8')
  const code = typescript ? transformSync(source, { loader: 'ts', format: 'cjs' }).code : source
  vm.runInNewContext(code, {
    module, exports: module.exports, Buffer, process, setTimeout, clearTimeout,
    __dirname: path.dirname(filename),
    require: (id) => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id),
  }, { filename })
  return module.exports
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function observe(promise) {
  const result = { state: 'pending' }
  result.done = promise.then((value) => {
    result.state = 'fulfilled'; result.value = value
  }, (error) => {
    result.state = 'rejected'; result.error = error
  })
  return result
}

// This deadline is an observation window owned by the test, not cancellation.
async function deadline(promise, ms = 80) {
  let timer
  try {
    return await Promise.race([
      promise.then(() => 'settled'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('pending'), ms) }),
    ])
  } finally { clearTimeout(timer) }
}

function frame(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const header = Buffer.alloc(4)
  header.writeUInt32BE(data.length)
  return Buffer.concat([header, data])
}

async function fixture(t, { handshake = true, ready = true } = {}) {
  const accepted = deferred(), readyRequest = deferred(), commandRequest = deferred()
  const peers = [], connections = [], commands = []
  let stopping = false
  // allowHalfOpen deliberately models a peer that ignores the client's FIN.
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    peers.push(socket)
    socket.on('error', () => {})
    accepted.resolve(socket)
    let buffer = Buffer.alloc(0), handshaken = false
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE(0) + 4) {
        const length = buffer.readUInt32BE(0)
        const message = buffer.subarray(4, length + 4)
        buffer = buffer.subarray(length + 4)
        if (!handshaken) { handshaken = true; continue }
        const command = message.toString()
        commands.push(command)
        if (command === 'shell echo ready\n') {
          readyRequest.resolve(socket)
          if (ready) socket.end(frame('ready\n'))
        } else {
          commandRequest.resolve(socket)
          if (command === 'shell echo recovery') socket.end(frame('recovered\n'))
        }
      }
    })
    if (handshake) hello(socket)
  })
  // Register before listening or loading modules: setup failures must not leave
  // the server alive. Also prevent late continuations from opening new sockets.
  t.after(async () => {
    stopping = true
    // Only the harness owns these sockets. It must also clean up deliberately
    // stuck readers (destroy without an error does not settle hdckit's reads).
    const sockets = [...peers, ...connections.map((c) => c.socket).filter(Boolean)]
    const closes = sockets.filter((s) => !s.closed).map((s) => new Promise((resolve) => s.once('close', resolve)))
    for (const socket of sockets) socket.destroy()
    await Promise.all(closes)
    if (server.listening) await new Promise((resolve) => server.close(resolve))
    for (const socket of sockets) socket.removeAllListeners()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  const Connection = loadModule(path.join(hdckitDir, 'hdc/Connection.js'), {
    'node:net': { connect(options) {
      assert.equal(stopping, false, 'fixture is stopping')
      assert.equal(options.host, '127.0.0.1')
      assert.equal(options.port, port)
      return net.connect(options)
    } },
    'node:child_process': { execFile() { throw new Error('HDC process launch is forbidden in this test') } },
  }).default
  class ObservedConnection extends Connection {
    constructor(options) { super(options); connections.push(this) }
  }
  const Client = loadModule(path.join(hdckitDir, 'hdc/Client.js'), {
    './Connection': { default: ObservedConnection, __esModule: true },
  }).default
  const client = new Client({ host: '127.0.0.1', port, bin: 'FORBIDDEN_TEST_BINARY' })
  const base = loadModule(basePath, {
    'share/common/log': () => ({ debug() {} }),
    'share/main/lib/util': { handleEvent() {} },
  }, true)
  await base.init(client)
  return { base, client, connections, commands, accepted, readyRequest, commandRequest }
}

function hello(socket, banner = 'OHOS HDC') {
  const data = Buffer.alloc(16)
  data.write(banner)
  socket.write(frame(data))
}

test('hdckit getTarget is synchronous and opens no transport', { timeout: 3000 }, async (t) => {
  const f = await fixture(t)
  const target = f.client.getTarget(fixtureKey)
  assert.equal(typeof target.shell, 'function')
  assert.equal(target.then, undefined)
  assert.throws(() => f.client.getTarget(''), /connectKey is required/)
  await assert.rejects(f.base.shell('', 'echo synthetic'), /connectKey is required/)
  assert.equal(f.connections.length, 0)
})

test('real shell preserves delayed scalar output and batched framing', { timeout: 3000 }, async (t) => {
  const f = await fixture(t)
  const pending = observe(f.base.shell(fixtureKey, ['echo first', 'echo second']))
  const peer = await f.commandRequest.promise
  assert.equal(f.commands.at(-1), 'shell echo first\necho "echo_separator"\necho second')
  assert.equal(await deadline(pending.done), 'pending')
  peer.end(frame(' first \necho_separator\n second \n'))
  await pending.done
  assert.equal(pending.state, 'fulfilled')
  assert.deepEqual(Array.from(pending.value), ['first', 'second'])
  assert.equal(await f.base.shell(fixtureKey, 'echo recovery'), 'recovered')
})

test('silent handshake leaves shell pending before a connection can be returned', { timeout: 3000 }, async (t) => {
  const f = await fixture(t, { handshake: false })
  const pending = observe(f.base.shell(fixtureKey, 'echo synthetic'))
  const peer = await f.accepted.promise
  assert.equal(await deadline(pending.done), 'pending')
  assert.equal(f.connections.length, 1)
  assert.equal(f.commands.length, 0)
  assert.ok(f.connections[0].socket.listenerCount('readable') > 0)
  // Release the held handshake with a protocol error, proving the real parser
  // and rejection path run, rather than returning a mocked forever-Promise.
  hello(peer, 'INVALID')
  await pending.done
  assert.equal(pending.state, 'rejected')
  assert.match(pending.error.message, /Channel Hello failed/)
})

test('ready read can exceed transport waitUntil 10000 ms without timing out', { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { ready: false })
  const pending = observe(f.base.shell(fixtureKey, 'echo recovery'))
  const peer = await f.readyRequest.promise
  // waitUntil checks elapsed time only AFTER the async predicate settles.
  assert.equal(await deadline(pending.done, 10100), 'pending')
  assert.equal(f.connections.length, 1)
  peer.end(frame('ready\n'))
  await pending.done
  assert.equal(pending.state, 'fulfilled')
  assert.equal(pending.value, 'recovered')
})

test('an outer deadline leaves readAll and its socket alive; late output still succeeds', { timeout: 3000 }, async (t) => {
  const f = await fixture(t)
  const pending = observe(f.base.shell(fixtureKey, 'echo synthetic'))
  const peer = await f.commandRequest.promise
  peer.write(frame('partial'))
  assert.equal(await deadline(pending.done), 'pending')
  const socket = f.connections.at(-1).socket
  assert.equal(socket.destroyed, false)
  assert.ok(socket.listenerCount('readable') > 0)
  // A fresh request recovers independently; that does not cancel the old one.
  assert.equal(await f.base.shell(fixtureKey, 'echo recovery'), 'recovered')
  assert.equal(pending.state, 'pending')
  peer.end(frame(' late'))
  await pending.done
  assert.equal(pending.state, 'fulfilled')
  assert.equal(pending.value, 'partial late')
})

test('Connection.end only half-closes TCP; a stalled reader remains and EOF accepts partial data', { timeout: 3000 }, async (t) => {
  const f = await fixture(t)
  const pending = observe(f.base.shell(fixtureKey, 'echo synthetic'))
  const peer = await f.commandRequest.promise
  peer.write(frame('partial'))
  const connection = f.connections.at(-1)
  const socket = connection.socket
  const fin = once(peer, 'end')
  connection.end()
  await fin
  assert.equal(await deadline(pending.done), 'pending')
  assert.equal(socket.destroyed, false)
  assert.ok(socket.listenerCount('readable') > 0)
  peer.end()
  await pending.done
  assert.equal(pending.state, 'fulfilled')
  assert.equal(pending.value, 'partial')
})

test('socket.destroy without an error closes TCP but does not settle readAll', { timeout: 3000 }, async (t) => {
  const f = await fixture(t)
  const pending = observe(f.base.shell(fixtureKey, 'echo synthetic'))
  await f.commandRequest.promise
  const socket = f.connections.at(-1).socket
  const closed = once(socket, 'close')
  socket.destroy()
  await closed
  assert.equal(await deadline(pending.done), 'pending')
  assert.ok(socket.listenerCount('readable') > 0)
})

test('socket.destroy(error) rejects the real reader, removes read listeners and permits a fresh call', { timeout: 3000 }, async (t) => {
  const f = await fixture(t)
  const pending = observe(f.base.shell(fixtureKey, 'echo synthetic'))
  await f.commandRequest.promise
  const socket = f.connections.at(-1).socket
  const error = new Error('synthetic transport failure')
  const endListeners = socket.listenerCount('end')
  const closed = new Promise((resolve) => socket.once('close', resolve))
  socket.destroy(error)
  await pending.done
  await closed
  assert.equal(pending.state, 'rejected')
  assert.equal(pending.error, error)
  assert.equal(socket.listenerCount('readable'), 0)
  assert.equal(socket.listenerCount('error'), 0)
  // readBytes removes its own end listener; Node and connect retain theirs.
  assert.equal(socket.listenerCount('end'), endListeners - 1)
  assert.equal(await f.base.shell(fixtureKey, 'echo recovery'), 'recovered')
})
