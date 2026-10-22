const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const { once } = require('node:events')
const { transformSync } = require('esbuild')
const axios = require('axios')

const root = path.resolve(__dirname, '..')
const row = (pid) => `0000000000000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_${pid}`
const target = (id) => ({ id, title: 'Synthetic page', type: 'page', url: 'https://example.invalid/', webSocketDebuggerUrl: `ws://127.0.0.1/devtools/page/${id}` })

async function fixture(t) {
  const state = { unix: row(12), body: [target('page-12')], status: 200, shellError: false, forwardError: false, hang: false, trickle: false }
  const calls = { shell: [], forward: [], http: [] }
  const peers = new Set()
  let stopping = false
  const server = http.createServer((req, res) => {
    calls.http.push(req.url)
    if (state.hang) return
    res.writeHead(state.status, { 'Content-Type': 'application/json', Location: '/unexpected-redirect' })
    if (state.trickle) {
      res.write('[')
      const interval = setInterval(() => res.write(' '), 50)
      res.once('close', () => clearInterval(interval))
      return
    }
    res.end(typeof state.body === 'string' ? state.body : JSON.stringify(state.body))
  })
  server.on('connection', (socket) => {
    socket.on('error', () => {})
    if (stopping) { socket.destroy(); return }
    peers.add(socket)
    socket.on('close', () => peers.delete(socket))
  })
  t.after(async () => {
    stopping = true
    const closed = server.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve()
    for (const peer of peers) peer.destroy()
    await closed
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  const handlers = new Map()
  const base = {
    async shell(key, command) {
      calls.shell.push({ key, command })
      assert.equal(command, 'cat /proc/net/unix')
      if (state.shellError) throw new Error('Synthetic shell failure')
      return state.unix
    },
    async forwardTcp(key, remote) {
      calls.forward.push({ key, remote })
      if (state.forwardError) throw new Error('Synthetic forward failure')
      return port
    },
  }
  const module = { exports: {} }
  const { code } = transformSync(fs.readFileSync(path.join(root, 'src/main/lib/hdc/webview.ts'), 'utf8'), { loader: 'ts', format: 'cjs' })
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, setTimeout, clearTimeout, require(id) {
    if (id === './base') return base // Never load HDC or start a real forward.
    if (id === 'share/main/lib/util') return { handleEvent: (name, handler) => handlers.set(name, handler) }
    if (id === 'axios') return axios
    if (id.startsWith('licia/')) return require(id)
    throw new Error(`Unexpected import: ${id}`)
  } })
  module.exports.init()
  return { state, calls, getWebviews: handlers.get('getWebviews') }
}

test('exact PID wins over a longer PID prefix and preserves all JSON targets', async (t) => {
  const f = await fixture(t)
  f.state.unix = [row(123), row(12), row(99)].join('\r\n')
  f.state.body = [target('one'), target('two')]
  assert.deepEqual(Array.from(await f.getWebviews('SYNTHETIC_DEVICE', 12)), f.state.body)
  assert.deepEqual(f.calls.forward, [{ key: 'SYNTHETIC_DEVICE', remote: 'localabstract:webview_devtools_remote_12' }])
  assert.deepEqual(f.calls.http, ['/json'])
})

test('an unrelated final socket line is not a fallback target', async (t) => {
  const f = await fixture(t)
  f.state.unix = row(99) // Deliberately no trailing newline.
  assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12)).length, 0)
  assert.deepEqual(f.calls.forward, [])
  assert.deepEqual(f.calls.http, [])
})

test('PID prefixes and malformed socket rows never trigger forwarding', async (t) => {
  const f = await fixture(t)
  f.state.unix = [row(123), row('12_extra'), 'invalid @webview_devtools_remote_12', row(12).replace('@webview', '@other_webview')].join('\n')
  assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12)).length, 0)
  assert.deepEqual(f.calls.forward, [])
})

test('malformed matches do not hide a later valid target; duplicate rows forward once', async (t) => {
  const f = await fixture(t)
  f.state.unix = ['invalid webview_devtools_remote_12', row(12), row(12)].join('\n')
  assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12))[0].id, 'page-12')
  assert.equal(f.calls.forward.length, 1)
})

test('empty unix listing and empty JSON target list are successful empty results', async (t) => {
  const f = await fixture(t)
  f.state.unix = ''
  assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12)).length, 0)
  assert.equal(f.calls.forward.length, 0)
  f.state.unix = row(12)
  f.state.body = []
  assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12)).length, 0)
  assert.equal(f.calls.http.length, 1)
})

test('invalid PIDs do not read device sockets or create forwards', async (t) => {
  const f = await fixture(t)
  for (const pid of [0, -1, 1.5, NaN, Infinity, '12']) {
    assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', pid)).length, 0)
  }
  assert.equal(f.calls.shell.length, 0)
  assert.equal(f.calls.forward.length, 0)
})

test('different PIDs on one device do not share an in-flight discovery', async (t) => {
  const f = await fixture(t)
  f.state.unix = [row(12), row(123)].join('\n')
  await Promise.all([f.getWebviews('SYNTHETIC_DEVICE', 12), f.getWebviews('SYNTHETIC_DEVICE', 123)])
  assert.deepEqual(f.calls.forward.map(({ remote }) => remote).sort(), ['localabstract:webview_devtools_remote_12', 'localabstract:webview_devtools_remote_123'])
  assert.equal(f.calls.http.length, 2)
})

test('identical concurrent requests share work but the next request rereads sockets', async (t) => {
  const f = await fixture(t)
  await Promise.all([f.getWebviews('SYNTHETIC_DEVICE', 12), f.getWebviews('SYNTHETIC_DEVICE', 12)])
  assert.equal(f.calls.shell.length, 1)
  f.state.unix = ''
  assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12)).length, 0)
  assert.equal(f.calls.shell.length, 2)
})

test('shell and forward failures reject and the next refresh recovers', async (t) => {
  const f = await fixture(t)
  for (const field of ['shellError', 'forwardError']) {
    f.state[field] = true
    await assert.rejects(f.getWebviews('SYNTHETIC_DEVICE', 12), /Synthetic .* failure/)
    f.state[field] = false
    assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12))[0].id, 'page-12')
  }
})

test('HTTP errors, malformed JSON and non-target payloads reject and can recover', async (t) => {
  const f = await fixture(t)
  f.state.status = 503
  await assert.rejects(f.getWebviews('SYNTHETIC_DEVICE', 12))
  f.state.status = 200
  for (const body of ['not JSON', { error: 'Synthetic failure' }, [null], [42]]) {
    f.state.body = body
    await assert.rejects(f.getWebviews('SYNTHETIC_DEVICE', 12))
  }
  f.state.body = [target('recovered')]
  assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12))[0].id, 'recovered')
})

test('silent HTTP endpoint has a bounded wait and does not pin future refreshes', { timeout: 9000 }, async (t) => {
  const f = await fixture(t)
  f.state.hang = true
  const pending = f.getWebviews('SYNTHETIC_DEVICE', 12)
  // An observation bound makes the old unbounded request fail normally; the
  // fixture's pre-registered teardown closes its own sockets even on failure.
  let timer
  try {
    const outcome = await Promise.race([
      pending.then(() => 'resolved', () => 'rejected'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('pending'), 6500) }),
    ])
    assert.equal(outcome, 'rejected')
    f.state.hang = false
    assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12))[0].id, 'page-12')
  } finally { clearTimeout(timer) }
})

test('a streaming endpoint cannot extend the HTTP deadline indefinitely', { timeout: 9000 }, async (t) => {
  const f = await fixture(t)
  f.state.trickle = true
  let timer
  try {
    const outcome = await Promise.race([
      f.getWebviews('SYNTHETIC_DEVICE', 12).then(() => 'resolved', () => 'rejected'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('pending'), 6500) }),
    ])
    assert.equal(outcome, 'rejected')
    f.state.trickle = false
    assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12))[0].id, 'page-12')
  } finally { clearTimeout(timer) }
})

test('local discovery does not follow HTTP redirects', async (t) => {
  const f = await fixture(t)
  f.state.status = 302
  await assert.rejects(f.getWebviews('SYNTHETIC_DEVICE', 12))
  assert.deepEqual(f.calls.http, ['/json'])
  f.state.status = 200
  assert.equal((await f.getWebviews('SYNTHETIC_DEVICE', 12))[0].id, 'page-12')
})
