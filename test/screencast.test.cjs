const assert = require('node:assert/strict')
const { test } = require('node:test')
const vm = require('node:vm')
const path = require('node:path')
const { build } = require('esbuild')

// Keep the production client and coordinate/event logic; substitute only the
// Electron bridge, DOM canvas and JPEG decoder, which need external runtimes.
const bundle = build({
  entryPoints: [
    path.resolve(
      __dirname,
      '../src/renderer/screencast/lib/ScreencastClient.ts',
    ),
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'device-boundaries',
      setup(build) {
        build.onLoad({ filter: /screencast[/\\]store\.ts$/ }, () => ({
          contents: 'export default globalThis.testStore',
          loader: 'js',
        }))
        build.onLoad({ filter: /screencast[/\\]lib[/\\]util\.ts$/ }, () => ({
          contents:
            'export async function loadImage() { return globalThis.testImage }',
          loader: 'js',
        }))
      },
    },
  ],
})

async function fixture({ scale = 1, width = 1084, height = 2412 } = {}) {
  const calls = []
  const listeners = {}
  const canvas = {
    width: 300,
    height: 150,
    getContext: () => ({ clearRect() {}, drawImage() {} }),
    getBoundingClientRect: () => ({ x: 50, y: 31, width: 271, height: 603 }),
    addEventListener: (name, fn) => {
      listeners[name] = fn
    },
    focus() {},
  }
  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    Blob,
    AbortController,
    Uint8Array,
    URL: { createObjectURL: () => 'blob:frame', revokeObjectURL() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    document: { createElement: () => canvas },
    testStore: { scale },
    testImage: { naturalWidth: 542, naturalHeight: 1206 },
    main: {
      createCaptureSession: async () => 'coordinate-session',
      stopCaptureScreen: async () => {},
      startCaptureScreen: async () => {},
      getDisplaySize: async () => ({ width, height }),
      on: () => () => {},
      touchDown: (...args) => calls.push(['down', ...args]),
      touchMove: (...args) => calls.push(['move', ...args]),
      touchUp: (...args) => calls.push(['up', ...args]),
    },
  })
  vm.runInContext((await bundle).outputFiles[0].text, context)
  const client = new context.module.exports.default('device')
  // Coordinate tests deliver frames only after the async capture start settles.
  await new Promise((resolve) => setImmediate(resolve))
  return {
    calls,
    listeners,
    canvas,
    context,
    client,
    draw: () => client.draw(new Uint8Array()),
    pointer: (type, x = 185.5, y = 332.5) =>
      listeners[type]({ clientX: x, clientY: y }),
  }
}

test('maps a half-resolution device frame to full touch coordinates', async () => {
  const f = await fixture()
  await f.draw()
  f.pointer('pointerdown')
  f.pointer('pointermove', 253.25, 483.25)
  f.pointer('pointerup', 253.25, 483.25)
  assert.deepEqual(f.calls, [
    ['down', 'device', 542, 1206],
    ['move', 'device', 813, 1809],
    ['up', 'device', 813, 1809],
  ])
})

test('uses actual display size when the requested scale differs from the stream scale', async () => {
  const f = await fixture({ scale: 0.5 })
  f.context.testImage = { naturalWidth: 271, naturalHeight: 603 }
  await f.draw()
  f.pointer('pointerdown')
  assert.deepEqual(f.calls, [['down', 'device', 542, 1206]])
})

test('keeps full-resolution capture coordinates unchanged', async () => {
  const f = await fixture()
  f.context.testImage = { naturalWidth: 1084, naturalHeight: 2412 }
  await f.draw()
  f.pointer('pointerdown')
  assert.deepEqual(f.calls, [['down', 'device', 542, 1206]])
})

test('changing the requested scale does not remap the frame still on screen', async () => {
  const f = await fixture()
  f.context.testImage = { naturalWidth: 1084, naturalHeight: 2412 }
  await f.draw()
  f.context.testStore.scale = 0.5
  f.pointer('pointerdown', 117.75, 181.75)
  assert.deepEqual(f.calls, [['down', 'device', 271, 603]])
})

test('refreshes touch dimensions when a landscape frame arrives', async () => {
  const f = await fixture()
  await f.draw()
  f.context.main.getDisplaySize = async () => ({ width: 2412, height: 1084 })
  f.context.testImage = { naturalWidth: 1206, naturalHeight: 542 }
  f.canvas.getBoundingClientRect = () => ({
    x: 50,
    y: 31,
    width: 603,
    height: 271,
  })
  await f.draw()
  f.pointer('pointerdown', 502.25, 234.25)
  assert.deepEqual(f.calls, [['down', 'device', 1809, 813]])
})

test('clamps a released pointer to the last valid device pixel', async () => {
  const f = await fixture()
  await f.draw()
  f.pointer('pointerdown', 50, 31)
  f.pointer('pointerleave', 900, 900)
  assert.deepEqual(f.calls, [
    ['down', 'device', 0, 0],
    ['up', 'device', 1083, 2411],
  ])
})

test('does not send touches before a frame and display size are available', async () => {
  const f = await fixture()
  f.pointer('pointerdown')
  f.pointer('pointermove')
  f.pointer('pointerup')
  f.pointer('pointerleave')
  assert.deepEqual(f.calls, [])
})

test('does not send touches when device dimensions are invalid', async () => {
  const f = await fixture({ width: 0, height: 0 })
  await f.draw()
  f.pointer('pointerdown')
  assert.deepEqual(f.calls, [])
})
