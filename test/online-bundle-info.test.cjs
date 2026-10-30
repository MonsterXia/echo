const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const axios = require('axios')

function loadStore(post, Clock = Date) {
  const module = { exports: {} }
  const file = 'src/main/lib/hdc/onlineBundleInfo.ts'
  const { code } = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' })
  vm.runInNewContext(code, { module, exports: module.exports, Date: Clock, setTimeout, clearTimeout, AbortController,
    require(id) {
      if (id.startsWith('node:')) return require(id)
      assert.equal(id, 'axios')
      return { post }
    },
  })
  return module.exports.getOnlineBundleInfo
}

test('real HTTP transport aborts a silent store and recovers after cooldown', async t => {
  const sockets = new Set()
  let requests = 0, reply = false, now = Date.now()
  const server = createServer((req, res) => {
    requests++
    req.resume()
    if (reply) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name: 'Recovered app' })) }
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  class Clock extends Date { static now() { return now } }
  // Only the destination is redirected to loopback. Axios cancellation, its
  // real Node HTTP adapter and the production deadline/circuit remain intact.
  const get = loadStore((_url, body, config) => axios.post(`http://127.0.0.1:${server.address().port}/store`, body, { ...config, proxy: false }), Clock)
  const started = performance.now()
  await assert.rejects(get('silent.app'), /ETIMEDOUT|ECONNABORTED/)
  assert.ok(performance.now() - started < 4500, 'deadline includes a connected server that never replies')
  for (let i = 0; i < 20 && sockets.size; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sockets.size, 0, 'timed-out transport must really close')
  assert.equal(Object.keys(await get('another.app')).length, 0)
  assert.equal(requests, 1)
  now += 30001; reply = true
  assert.equal((await get('another.app')).name, 'Recovered app')
  assert.equal(requests, 2)
})

test('deadline also closes an HTTPS proxy socket before CONNECT completes', async t => {
  const sockets = new Set()
  let requests = 0
  const server = createServer()
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.on('connect', (_req, socket) => {
    requests++
    socket.on('end', () => socket.destroy())
    socket.resume() // Observe FIN; intentionally never send the CONNECT reply.
  })
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const get = loadStore((_url, body, config) => axios.post('https://store.example.invalid/metadata', body, {
    ...config, proxy: { protocol: 'http', host: '127.0.0.1', port: server.address().port },
  }))
  await assert.rejects(get('silent.app'), /ETIMEDOUT|ECONNABORTED/)
  assert.equal(requests, 1, 'must exercise real CONNECT tunneling')
  for (let i = 0; i < 20 && sockets.size; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sockets.size, 0, 'cancelled CONNECT must not leave a live proxy connection')
})
