const assert = require('node:assert/strict')

const { once } = require('node:events')
const { createRequire } = require('node:module')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
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
  const state = { stall: '', screenStall: '', screen: 'physical screen resolution: 1080x1920', mem: 'MemTotal: 8192 kB\nMemFree: 1024 kB\nMemAvailable: 3072 kB\n', requests: [], deadlines: [], heldWrites: [] }
  const clients = [], peers = [], handlers = new Map(), initOptions = []
  let stopping = false, sequence = 0
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('error', () => {})
    if (stopping) { socket.destroy(); return }
    peers.push(socket)
    const index = ++sequence
    // Each overview has two preceding commands, each with ready + command.
    const memoryProbe = index === 5
    const screenProbe = index === 7
    if (!(state.stall === 'handshake' && memoryProbe) && !(state.screenStall === 'handshake' && screenProbe)) {
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
          if (state.screenStall === 'ready' && screenProbe) return
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
        } else if (command === SCREEN) {
          if (state.screenStall === 'read') { socket.write(frame('physical screen resolution: 1x1')); return }
          if (state.screenStall === 'reset') { socket.resetAndDestroy(); return }
          if (state.screenStall === 'truncated') { socket.end(Buffer.from([0, 0, 0, 5, 65])); return }
          socket.end(frame(state.screen))
        }
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
        if (state.screenStall === 'connect' && clients.length === 7) return this
        return super.connect({ host: '127.0.0.1', port: address.port })
      }
      _write(data, encoding, callback) {
        if (state.screenStall === 'send' && data.subarray(4).toString() === SCREEN) {
          state.heldWrites.push(callback); return
        }
        return super._write(data, encoding, callback)
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


module.exports = { fixture, outcome, bounded, frame, load, KEY, READY, MEMORY, INFO, SCREEN }
