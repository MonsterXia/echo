const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { transformSync } = require('esbuild')

// Execute the real window, IPC session coordinator, UiDriver subclass and
// uitest handlers. Only Electron, cached-driver lookup and transport are fake.
exports.screencastMain = function (
  send = async () => ({ sessionId: 'session' }),
  options = {},
) {
  const handlers = new Map(),
    modules = new Map(),
    drivers = new Map()
  const windows = [],
    attempts = [],
    deliveries = [],
    calls = []
  const sessions = new Map(),
    generations = new Map()
  let current,
    driver,
    mainShows = 0
  const errors = []
  let targetRequests = 0,
    initializationStops = 0,
    initializationQueries = 0
  const hdckit = require('hdckit')
  class TransportUiDriver extends hdckit.UiDriver {
    constructor(...args) {
      super(...args)
      let initialized = false
      this.send = async (...args) => {
        if (args[1] === 'getDisplaySize' && !initialized) {
          initialized = true
          initializationQueries++
          await options.initialize?.()
        }
        calls.push(args[1])
        return send(...args)
      }
    }
  }
  const windowBoundary = {
    create() {
      const win = new EventEmitter()
      let destroyed = false
      win.getBounds = () => ({ x: 0, y: 0, width: 500, height: 640 })
      win.setMinimumSize = win.setBounds = win.setAlwaysOnTop = () => {}
      win.focus = () => {
        assert.equal(
          destroyed,
          false,
          'must not focus a destroyed BrowserWindow',
        )
        win.focuses++
      }
      win.focuses = 0
      const wc = (win.webContents = new EventEmitter())
      wc.isDestroyed = () => destroyed
      const deliver = (...args) => {
        assert.equal(destroyed, false)
        attempts.push(['screencast', ...args])
        deliveries.push({ win, args })
      }
      wc.send = deliver
      wc.mainFrame = { send: deliver }
      win.destroy = () => {
        if (destroyed) return
        destroyed = true
        win.emit('closed')
        wc.emit('destroyed')
      }
      win.close = () => {
        assert.equal(
          destroyed,
          false,
          'must not close a destroyed BrowserWindow',
        )
        win.emit('close')
        win.destroy()
      }
      win.on('closed', () => {
        if (current === win) current = undefined
      })
      windows.push(win)
      current = win
      return win
    },
    loadPage(win) {
      win.webContents.emit('did-navigate')
    },
    getWin: (name) => (name === 'main' ? { show: () => mainShows++ } : current),
  }
  function load(file) {
    file = path.resolve(__dirname, file)
    if (modules.has(file)) return modules.get(file).exports
    const module = { exports: {} }
    modules.set(file, module)
    const { code } = transformSync(fs.readFileSync(file, 'utf8'), {
      loader: 'ts',
      format: 'cjs',
    })
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      AbortController,
      Buffer,
      console: { error: (...args) => errors.push(args), warn() {} },
      require(id) {
        if (id === 'electron')
          return {
            ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
            screen: {
              getDisplayMatching: () => ({
                workArea: { x: 0, y: 0, width: 1920, height: 1080 },
              }),
            },
          }
        if (id === 'share/main/lib/window') return windowBoundary
        if (id === 'share/main/lib/util')
          return {
            handleEvent: (name, handler) =>
              handlers.set(name, (_event, ...args) => handler(...args)),
            resolveResources: () => 'synthetic-sdk-not-read',
            getUserDataPath: () => 'synthetic-cache-not-written',
          }
        if (id === '../lib/store') return { getScreencastStore: () => ({}) }
        if (id === './base')
          return {
            getTargetStore: (key, name) => {
              assert.equal(name, 'uiDriver')
              return drivers.get(key)
            },
            setTargetStore: (key, name, value) => {
              assert.equal(name, 'uiDriver')
              drivers.set(key, value)
            },
          }
        if (id === './nativeVideo')
          return { NativeVideo: class {
            async start() { return false }
            async stop() {}
          } }
        if (id === './controlRecovery') return { ControlRecovery: class {
          async remember() {}
          async reset() { throw new Error('Synthetic device recovery is not configured') }
        } }
        if (id === './finiteShell' && options.inputShell) return { runFiniteShell: options.inputShell }
        if (id.startsWith('.'))
          return load(path.resolve(path.dirname(file), id + '.ts'))
        if (id === 'hdckit') return { ...hdckit, UiDriver: TransportUiDriver }
        if (id.startsWith('licia/') || id.startsWith('node:'))
          return require(id)
        throw new Error(`Unexpected dependency: ${id}`)
      },
    })
    return module.exports
  }
  const { CaptureUiDriver } = load('../../src/main/lib/hdc/captureDriver.ts')
  function addDriver(key, transport = send) {
    const item = new CaptureUiDriver({})
    item.send = (...args) => {
      calls.push(args[1])
      return transport(...args)
    }
    drivers.set(key, item)
    return item
  }
  driver = addDriver('synthetic-target')
  const windowModule = load('../../src/main/window/screencast.ts')
  load('../../src/main/lib/hdc/uitest.ts').init({
    options: { host: '127.0.0.1', port: 8710 },
    async getTarget() {
      targetRequests++
      if (options.getTarget) await options.getTarget()
      return {
        async shell(command) {
          assert.equal(
            command,
            'pidof uitest',
            'initialization must not kill a synthetic or real agent',
          )
          initializationStops++
          return {
            readAll: async () => {
              await options.initialize?.()
              return Buffer.from('')
            },
          }
        },
      }
    },
  })
  const invoke = (
    name,
    args,
    win = current,
    frame = win?.webContents.mainFrame,
  ) =>
    Promise.resolve().then(() =>
      handlers.get(name)(
        { sender: win?.webContents, senderFrame: frame },
        ...args,
      ),
    )
  async function create(key = 'synthetic-target', win = current) {
    const id = await invoke('createCaptureSession', [key], win)
    sessions.set(win, id)
    generations.set(id, 0)
    return id
  }
  return {
    prepare: (valid = () => true, key = 'synthetic-target') => load('../../src/main/lib/hdc/captureSessions.ts').prepareCapture(key, 0.5, valid, async () => drivers.get(key)),
    cancelPreparation: (key = 'synthetic-target') => load('../../src/main/lib/hdc/captureSessions.ts').cancelCapturePreparation(key),
    shutdown: () => load('../../src/main/lib/hdc/captureSessions.ts').shutdownCaptures(),
    windows,
    calls,
    attempts,
    deliveries,
    driver,
    drivers,
    errors,
    invoke,
    hasHandler: name => handlers.has(name),
    create,
    addDriver,
    show: windowModule.showWin,
    close: windowModule.closeWin,
    mainShows: () => mainShows,
    current: () => current,
    evictDriver: (key = 'synthetic-target') => drivers.delete(key),
    initialization: () => ({ targetRequests, initializationStops, initializationQueries }),
    session: () => sessions.get(current),
    startSession: (id, scale = 0.5, generation = 1, win = current) =>
      invoke('startCaptureScreen', [id, scale, generation], win),
    stopSession: (id, win = current) => invoke('stopCaptureScreen', [id], win),
    async start(key = 'synthetic-target', scale = 0.5) {
      const win = current
      const id = sessions.get(win) || (await create(key, win))
      const generation = generations.get(id) + 1
      generations.set(id, generation)
      return invoke('startCaptureScreen', [id, scale, generation], win)
    },
    stop: () => invoke('stopCaptureScreen', [sessions.get(current)]),
  }
}
