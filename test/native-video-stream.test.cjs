const { test } = require('node:test')
const assert = require('node:assert/strict')
const http2 = require('node:http2')
const { build } = require('esbuild')
const path = require('node:path')
const Module = require('node:module')
async function load() {
  const file = path.resolve(__dirname, '../src/main/lib/hdc/nativeVideo.ts')
  const output = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  const compiled = new Module(file, module)
  compiled._compile(output.outputFiles[0].text, file)
  return compiled.exports
}
async function server(t, handle) {
  const server = http2.createServer()
  const sessions = new Set()
  server.on('session', (s) => { sessions.add(s); s.on('error', () => {}) })
  server.on('stream', (s, h) => { s.on('error', () => {}); s.resume(); handle(s, h) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { for (const s of sessions) s.destroy(); server.close() })
  return server.address().port
}
test('native gRPC confirms start, receives video, confirms stop and closes stream', async (t) => {
  const { connectNativeVideo } = await load()
  let starts = 0, stops = 0
  const port = await server(t, (s, h) => {
    s.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
    s.on('wantTrailers', () => s.sendTrailers({ 'grpc-status': '0' }))
    if (h[':path'] === '/ScrcpyService/onStart') {
      starts++
      const data = Buffer.from([26, 14, 10, 4, 100, 97, 116, 97, 18, 6, 42, 4, 0, 0, 1, 101])
      const head = Buffer.alloc(5); head.writeUInt32BE(data.length, 1)
      s.write(Buffer.concat([head, data]))
    } else { stops++; s.end(Buffer.alloc(5)) }
  })
  const frames = [], errors = []
  const stream = await connectNativeVideo(port, (f) => frames.push(f), (e) => errors.push(e))
  await stream.stop()
  assert.equal(starts, 1)
  assert.equal(stops, 1)
  assert.equal(frames.length, 1)
  assert.equal(errors.length, 0)
})
test('native start rejects gRPC failures instead of reporting ready', async (t) => {
  const { connectNativeVideo } = await load()
  const port = await server(t, (s) => s.respond({ ':status': 200, 'content-type': 'application/grpc', 'grpc-status': '12' }, { endStream: true }))
  await assert.rejects(connectNativeVideo(port, () => {}, () => {}), /gRPC|ended/)
})

test('a silent encoder times out distinctly and receives onEnd before its connection is destroyed', async (t) => {
  const { connectNativeVideo } = await load()
  const requests = []
  const port = await server(t, (s, h) => {
    requests.push(h[':path'])
    if (h[':path'].endsWith('onEnd')) {
      s.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
      s.on('wantTrailers', () => s.sendTrailers({ 'grpc-status': '0' }))
      s.end(Buffer.alloc(5))
    }
  })
  await assert.rejects(connectNativeVideo(port, () => assert.fail('no synthetic video'), () => {}),
    error => error.name === 'NativeVideoFirstFrameTimeout')
  assert.deepEqual(requests, ['/ScrcpyService/onStart', '/ScrcpyService/onEnd'])
})
test('native stop failure is observable and still releases the local HTTP2 session', async (t) => {
  const { connectNativeVideo } = await load()
  const port = await server(t, (s, h) => {
    if (h[':path'].endsWith('onStart')) {
      s.respond({ ':status': 200, 'content-type': 'application/grpc' })
      const data = Buffer.from([26, 14, 10, 4, 100, 97, 116, 97, 18, 6, 42, 4, 0, 0, 1, 101])
      const head = Buffer.alloc(5); head.writeUInt32BE(data.length, 1)
      s.write(Buffer.concat([head, data]))
    } else s.respond({ ':status': 200, 'grpc-status': '13' }, { endStream: true })
  })
  const stream = await connectNativeVideo(port, () => {}, () => {})
  await assert.rejects(stream.stop(), /gRPC/)
})

test('missing native library or another socket owner never creates or removes resources', async () => {
  const { NativeVideo } = await load()
  for (const available of [false, true]) {
    const native = new NativeVideo({ port: 8710, connectKey: 'synthetic' })
    const calls = []
    native.run = async (args) => {
      calls.push(args)
      return args[1].startsWith('test -f') ? (available ? 'available' : '') : '@scrcpy_grpc_socket'
    }
    assert.equal(await native.start(0.5, () => {}, () => {}), false)
    assert.equal(calls.length, available ? 2 : 1)
  }
})

test('failed native startup removes only its owned process and copy before fallback', async () => {
  const { NativeVideo } = await load()
  const native = new NativeVideo({ port: 8710, connectKey: 'synthetic' })
  const calls = []
  let command, running = false
  native.run = async (args) => {
    const shell = args[1]
    calls.push(shell)
    if (shell.startsWith('test -f')) return 'available'
    if (shell === 'cat /proc/net/unix') return ''
    if (shell.startsWith('uitest start-daemon')) { command = shell; running = true; throw new Error('timeout after creation') }
    if (shell === 'ps -ef') return `UID PID PPID C STIME TTY TIME CMD\nshell 99 1 other-uitest\n${running ? `shell 123 1 ${command}` : ''}`
    if (shell.startsWith('test ! -e')) return 'removed'
    if (shell === 'kill -9 123') running = false
    return ''
  }
  assert.equal(await native.start(0.5, () => {}, () => {}), false)
  assert.equal(running, false)
  assert.deepEqual(calls.filter(x => x.startsWith('kill')), ['kill -9 123'])
  assert.match(calls.at(-2), /^rm -f \/data\/local\/tmp\/scrcpy_harmony_[a-f0-9]{16}\.so$/)
  assert.equal(native.name, undefined)
})

test('uncertain native process exit preserves ownership for a later cleanup attempt', async () => {
  const { NativeVideo } = await load()
  const native = new NativeVideo({ port: 8710, connectKey: 'synthetic' })
  native.name = 'scrcpy_harmony_0123456789abcdef.so'
  const owned = native.name
  native.run = async (args) => args[1] === 'ps -ef'
    ? `UID PID PPID C STIME TTY TIME CMD\nshell 123 1 uitest start-daemon singleness --extension-name ${owned} -scale 2` : ''
  await assert.rejects(native.stop(), /stop unconfirmed/)
  assert.equal(native.name, owned)
  native.run = async args => args[1] === 'ps -ef' ? 'UID PID PPID C STIME TTY TIME CMD' : args[1]?.startsWith('test ! -e') ? 'removed' : ''
  await native.stop()
  assert.equal(native.name, undefined)
})

test('native stop confirms an already absent forwarding rule and permits fallback', async () => {
  const { NativeVideo } = await load()
  const native = new NativeVideo({ port: 8710, connectKey: 'synthetic' })
  native.name = 'scrcpy_harmony_0123456789abcdef.so'
  native.forwarded = true
  native.port = 43210
  native.run = async (args) => {
    if (args[0] === 'fport' && args[1] === 'rm') throw new Error('mapping not found')
    if (args[0] === 'fport' && args[1] === 'ls') return '[Empty]'
    if (args[1] === 'ps -ef') return 'UID PID PPID C STIME TTY TIME CMD'
    if (args[1]?.startsWith('test ! -e')) return 'removed'
    return ''
  }
  await native.stop()
  assert.equal(native.forwarded, false)
  assert.equal(native.name, undefined)
})

test('native stop cannot confirm removal when forwarding inventory is unavailable', async () => {
  const { NativeVideo } = await load()
  const native = new NativeVideo({ port: 8710, connectKey: 'synthetic' })
  native.forwarded = true
  native.port = 43210
  native.run = async () => { throw new Error('server disconnected') }
  await assert.rejects(native.stop(), /disconnected/)
  assert.equal(native.forwarded, true)
})
