const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { transformSync } = require('esbuild')
const { UiDriver } = require('hdckit')

// Load both production modules. Only Electron/window factory, store lookup and
// the transport are controlled; no src/share checkout or device is accessed.
exports.screencastMain = function (send = async () => ({ sessionId: 'session' })) {
  const handlers = new Map()
  const windows = []
  const attempts = []
  const deliveries = []
  const calls = []
  let current
  let mainShows = 0
  const driver = new UiDriver({})
  driver.send = (...args) => {
    calls.push(args[1])
    return send(...args)
  }
  const windowBoundary = {
    create() {
      const win = new EventEmitter()
      let destroyed = false
      win.getBounds = () => ({ x: 0, y: 0, width: 500, height: 640 })
      win.setMinimumSize = win.setBounds = win.setAlwaysOnTop = () => {}
      win.focus = () => {
        assert.equal(destroyed, false, 'must not focus a destroyed BrowserWindow')
        win.focuses++
      }
      win.focuses = 0
      win.webContents = new EventEmitter()
      win.webContents.send = (...args) => {
        assert.equal(destroyed, false)
        deliveries.push({ win, args })
      }
      // Electron destroy bypasses close and emits closed. The shared factory
      // removes its registry entry on closed before the application listener.
      win.destroy = () => {
        if (destroyed) return
        destroyed = true
        win.webContents.emit('destroyed')
        win.emit('closed')
      }
      win.close = () => {
        assert.equal(destroyed, false, 'must not close a destroyed BrowserWindow')
        win.emit('close')
        win.destroy()
      }
      win.on('closed', () => { if (current === win) current = undefined })
      windows.push(win)
      current = win
      return win
    },
    loadPage() {},
    getWin: (name) => name === 'main' ? { show: () => mainShows++ } : current,
    sendTo(name, ...args) {
      attempts.push([name, ...args])
      if (current) current.webContents.send(...args)
    },
  }
  function load(relative) {
    const module = { exports: {} }
    const { code } = transformSync(fs.readFileSync(path.resolve(__dirname, relative), 'utf8'), {
      loader: 'ts', format: 'cjs',
    })
    vm.runInNewContext(code, {
      module, exports: module.exports,
      require(id) {
        if (id === 'electron') return {
          screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
        }
        if (id === 'share/main/lib/window') return windowBoundary
        if (id === 'share/main/lib/util') return {
          handleEvent: (name, handler) => handlers.set(name, handler),
          resolveResources() { throw new Error('No resources/device access allowed') },
        }
        if (id === '../lib/store') return { getScreencastStore: () => ({}) }
        if (id === './base') return {
          getTargetStore(key, name) {
            assert.equal(key, 'synthetic-target')
            assert.equal(name, 'uiDriver')
            return driver
          },
          setTargetStore() { throw new Error('Unexpected driver initialization') },
        }
        if (id.startsWith('licia/')) return require(id)
        throw new Error(`Unexpected dependency: ${id}`)
      },
    })
    return module.exports
  }
  const windowModule = load('../../src/main/window/screencast.ts')
  load('../../src/main/lib/hdc/uitest.ts').init({
    getTarget() { throw new Error('No device access allowed') },
  })
  return {
    windows, calls, attempts, deliveries, driver,
    show: windowModule.showWin, close: windowModule.closeWin,
    mainShows: () => mainShows,
    start: () => handlers.get('startCaptureScreen')('synthetic-target', 0.5),
    stop: () => handlers.get('stopCaptureScreen')('synthetic-target'),
  }
}
