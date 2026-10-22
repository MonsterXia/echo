const assert = require('node:assert/strict')
const { test } = require('node:test')
const vm = require('node:vm')
const path = require('node:path')
const { build } = require('esbuild')

// Test the production window policy at Electron/shared-window boundaries.
// No shared submodule or Electron runtime is needed for the CI unit suite.
const bundle = build({
  entryPoints: [path.resolve(__dirname, '../src/main/window/screencast.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'window-boundaries',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(electron|share\/main\/lib\/window|share\/main\/lib\/util|\.\.\/lib\/store)$/,
          },
          (args) => ({ path: args.path, external: true }),
        )
      },
    },
  ],
})

async function open(area, restored) {
  let bounds, minimum
  const win = {
    getBounds: () => bounds,
    setBounds: (next) => {
      bounds = next
    },
    setMinimumSize: (w, h) => {
      minimum = [w, h]
    },
    on() {},
  }
  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    require(id) {
      switch (id) {
        case 'electron':
          return { screen: { getDisplayMatching: () => ({ workArea: area }) } }
        case 'share/main/lib/window':
          return {
            create(opts) {
              minimum = [opts.minWidth, opts.minHeight]
              bounds = restored || {
                x: 50,
                y: 50,
                width: opts.width,
                height: opts.height,
              }
              return win
            },
            loadPage() {},
            getWin() {},
          }
        case '../lib/store':
          return { getScreencastStore: () => ({}) }
        case 'share/main/lib/util':
          return { handleEvent() {} }
        default:
          throw new Error(`Unexpected dependency: ${id}`)
      }
    },
  })
  vm.runInContext((await bundle).outputFiles[0].text, context)
  context.module.exports.showWin()
  return { bounds, minimum }
}

test('small work area contains the initial window and permits a compact window', async () => {
  const { bounds, minimum } = await open({
    x: 0,
    y: 0,
    width: 533,
    height: 400,
  })
  assert.ok(bounds.width <= 533 && bounds.height <= 400)
  assert.ok(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= 533 &&
      bounds.y + bounds.height <= 400,
  )
  assert.ok(minimum[0] <= 320 && minimum[1] <= 320)
})

test('restored bounds fit a negative-origin display after work area shrinks', async () => {
  const { bounds } = await open(
    { x: -800, y: -600, width: 800, height: 560 },
    { x: -1000, y: -700, width: 900, height: 900 },
  )
  assert.equal(bounds.x, -800)
  assert.equal(bounds.y, -600)
  assert.equal(bounds.width, 800)
  assert.equal(bounds.height, 560)
})

test('valid saved placement is retained and a tiny work area caps the minimum', async () => {
  const saved = { x: 100, y: 100, width: 400, height: 500 }
  const normal = await open({ x: 0, y: 0, width: 1920, height: 1040 }, saved)
  assert.deepEqual({ ...normal.bounds }, saved)
  const tiny = await open({ x: 10, y: 20, width: 280, height: 300 })
  assert.ok(tiny.minimum[0] <= 280 && tiny.minimum[1] <= 300)
  assert.ok(tiny.bounds.width <= 280 && tiny.bounds.height <= 300)
})
