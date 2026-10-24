const assert = require('node:assert/strict')
const { test } = require('node:test')
const net = require('node:net')
const { loadConnection, loadTransport, packet } = require('./helpers/uitest-stream.cjs')

test('background startup leaves an existing daemon and outdated SDK untouched', async () => {
  const Driver = loadTransport().default
  const commands = []
  let uploads = 0, forwards = 0
  const driver = new Driver({ sendFile: async () => { uploads++ } })
  driver.allowDaemonRestart = false
  driver.shell = async command => {
    commands.push(command)
    if (command === 'pidof uitest') return '4242'
    if (command.startsWith('cat ')) return 'UITEST_AGENT_LIBRARY@v1.0.0'
    return ''
  }
  driver.forwardTcp = async () => { forwards++; return 8012 }
  await assert.rejects(driver.start(), /existing UITest daemon/)
  assert.equal(commands.some(command => /kill|rm |param set|start-daemon/.test(command)), false)
  assert.equal(uploads, 0)
  assert.equal(forwards, 0)
})

test('cold control startup connects as soon as the daemon is ready and tolerates early connections', async t => {
  const Driver = loadTransport().default
  const driver = new Driver({})
  let accepts = 0
  const sockets = new Set()
  const server = net.createServer(socket => {
    accepts++; sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    if (accepts === 1) { socket.end(); return }
    socket.on('data', bytes => {
      const id = bytes.readUInt32BE(Buffer.byteLength('_uitestkit_rpc_message_head_'))
      socket.write(packet(id, JSON.stringify({ result: { width: 100, height: 200 } })))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  driver.shell = async () => ''
  driver.shouldUpdateSdk = async () => false
  driver.forwardTcp = async () => server.address().port
  t.after(async () => {
    driver.connection?.end()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  })
  const start = performance.now()
  assert.deepEqual(await driver.getDisplaySize(), { width: 100, height: 200 })
  assert.ok(performance.now() - start < 1500, 'ready daemon must not pay a fixed two-second sleep')
  assert.equal(accepts, 2)
})

async function fixture(t, accept = () => {}) {
  const sockets = new Set()
  const server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    accept(socket)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const Connection = loadConnection()
  const c = new Connection()
  t.after(async () => {
    c.end()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  })
  await c.connect(server.address().port)
  return c
}

async function settledWithin(promise, ms = 250) {
  let timer
  try {
    return await Promise.race([
      promise.then(() => 'resolved', () => 'rejected'),
      new Promise(resolve => { timer = setTimeout(() => resolve('pending'), ms) }),
    ])
  } finally { clearTimeout(timer) }
}

test('peer EOF rejects pending control requests and clears the dead connection', async t => {
  const c = await fixture(t, socket => socket.once('data', () => socket.end()))
  assert.equal(await settledWithin(c.sendMessage({ method: 'stopCaptureScreen' })), 'rejected')
  assert.equal(c.resolves.size, 0)
  assert.equal(c.rejects.size, 0)
})

test('explicit close rejects every request, including a pending stop', async t => {
  const c = await fixture(t)
  const first = settledWithin(c.sendMessage({ method: 'stopCaptureScreen' }))
  const second = settledWithin(c.sendMessage({ method: 'getDisplaySize' }))
  c.end()
  assert.deepEqual(await Promise.all([first, second]), ['rejected', 'rejected'])
  assert.equal(c.resolves.size, 0)
  assert.equal(c.rejects.size, 0)
})

test('a request deadline retires the socket and rejects other in-flight requests', async t => {
  const c = await fixture(t)
  const socket = c.socket
  const first = settledWithin(c.sendMessage({ method: 'stopCaptureScreen' }, 30))
  const second = settledWithin(c.sendMessage({ method: 'getDisplaySize' }, 500))
  assert.equal(await first, 'rejected')
  assert.equal(await second, 'rejected')
  assert.ok(socket.destroyed)
  assert.equal(c.resolves.size, 0)
  assert.equal(c.rejects.size, 0)
  assert.equal(await settledWithin(c.sendMessage({ method: 'after-close' })), 'rejected')
  assert.equal(c.resolves.size, 0, 'closed send must not leak a pending entry')
})

test('successful reply cancels its timer and leaves the stream usable', async t => {
  const c = await fixture(t, socket => socket.on('data', bytes => {
    const id = bytes.readUInt32BE(Buffer.byteLength('_uitestkit_rpc_message_head_'))
    socket.write(packet(id, JSON.stringify({ result: 'ok' })))
  }))
  assert.equal((await c.sendMessage({ method: 'first' }, 40)).result, 'ok')
  await new Promise(resolve => setTimeout(resolve, 70))
  assert.equal((await c.sendMessage({ method: 'second' }, 40)).result, 'ok')
  assert.equal(c.timers?.size, 0)
})

test('ordinary requests have a deadline even when callers do not supply one', async t => {
  const c = await fixture(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let state = 'pending'
  const task = c.sendMessage({ method: 'silent' }).then(() => { state = 'resolved' }, () => { state = 'rejected' })
  t.mock.timers.tick(10001)
  await Promise.resolve()
  assert.equal(state, 'rejected')
  await task
  assert.ok(c.socket.destroyed)
  t.mock.timers.reset()
})

test('same-tick identical requests have distinct IDs and each receives its own reply', async t => {
  const c = await fixture(t)
  const originalNow = Date.now
  let first, second
  try {
    Date.now = () => 1000
    first = c.sendMessage({ method: 'same' })
    second = c.sendMessage({ method: 'same' })
  } finally { Date.now = originalNow }
  const ids = [...c.resolves.keys()]
  assert.equal(ids.length, 2)
  c.onData(Buffer.concat(ids.map((id, i) => packet(id, JSON.stringify({ result: i })))))
  assert.deepEqual((await Promise.all([first, second])).map(x => x.result), [0, 1])
})

test('socket error rejects active requests and explicit close settles an unfinished TCP connect', async t => {
  const c = await fixture(t)
  const pending = settledWithin(c.sendMessage({ method: 'active' }))
  c.socket.emit('error', new Error('synthetic transport error'))
  assert.equal(await pending, 'rejected')
  const Connection = loadConnection()
  const connecting = new Connection()
  const opened = settledWithin(connecting.connect(1))
  connecting.end()
  assert.equal(await opened, 'rejected')
})

test('real driver stop times out, closes its socket, and retries via a fresh handshake without replaying input', async t => {
  let accepts = 0, stops = 0, inputs = 0
  const sockets = new Set()
  const header = Buffer.byteLength('_uitestkit_rpc_message_head_')
  const tail = Buffer.byteLength('_uitestkit_rpc_message_tail_')
  const server = net.createServer(socket => {
    accepts++
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buffered = Buffer.alloc(0)
    socket.on('data', bytes => {
      buffered = Buffer.concat([buffered, bytes])
      while (buffered.length >= header + 8) {
        const id = buffered.readUInt32BE(header), size = buffered.readUInt32BE(header + 4)
        const end = header + 8 + size + tail
        if (buffered.length < end) break
        const request = JSON.parse(buffered.subarray(header + 8, header + 8 + size))
        buffered = buffered.subarray(end)
        const api = request.params.api
        if (api === 'stopCaptureScreen' && ++stops === 1) continue
        if (api === 'Driver.inputText') { inputs++; socket.end(); continue }
        socket.write(packet(id, JSON.stringify({ result: api === 'Driver.create' ? 'synthetic-driver' : {} })))
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const Driver = loadTransport().default
  const driver = new Driver({})
  driver.start = async () => { driver.port = server.address().port }
  t.after(async () => {
    driver.connection?.end()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  })
  const started = performance.now()
  await assert.rejects(driver.stopCaptureScreen(), /timed out/)
  assert.ok(performance.now() - started >= 2900)
  assert.ok(performance.now() - started < 6000)
  assert.equal(driver.connection, null)
  await driver.stopCaptureScreen()
  assert.equal(stops, 2)
  assert.equal(accepts, 2, 'retry must use a new TCP connection and handshake')
  await assert.rejects(driver.inputText('synthetic'), /ended|closed/)
  assert.equal(inputs, 1, 'unknown-result input is never automatically replayed')
})
