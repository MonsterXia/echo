const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const { UiDriver } = require('hdckit')

// Keep the real registered uitest handlers AND hdckit's async capture methods.
// Only replace the device transport, cached-driver lookup and Electron boundary.
// Constructing UiDriver does not connect; replacing send prevents any HDC call.
exports.captureHandlers = function (send) {
  const driver = new UiDriver({})
  driver.send = send
  const handlers = new Map()
  const frames = []
  const module = { exports: {} }
  const { code } = transformSync(
    fs.readFileSync(
      path.resolve(__dirname, '../../src/main/lib/hdc/uitest.ts'),
      'utf8',
    ),
    { loader: 'ts', format: 'cjs' },
  )
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id) {
      if (id === './base')
        return {
          getTargetStore(key, name) {
            assert.equal(key, 'synthetic-target')
            assert.equal(name, 'uiDriver')
            return driver
          },
          setTargetStore() {
            throw new Error('Unexpected driver initialization')
          },
        }
      if (id === 'share/main/lib/util')
        return {
          handleEvent: (name, handler) => handlers.set(name, handler),
          resolveResources() {
            throw new Error('Unexpected resource lookup')
          },
        }
      if (id === 'share/main/lib/window')
        return {
          sendTo: (...args) => frames.push(args),
        }
      if (id.startsWith('licia/')) return require(id)
      throw new Error(`Unexpected import: ${id}`)
    },
  })
  module.exports.init({
    getTarget() {
      throw new Error('No device access allowed')
    },
  })
  return {
    driver,
    frames,
    start: (key = 'synthetic-target', scale = 0.5) =>
      handlers.get('startCaptureScreen')(key, scale),
    stop: (key = 'synthetic-target') => handlers.get('stopCaptureScreen')(key),
  }
}
