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
              /^(electron|share\/main\/lib\/window|share\/main\/lib\/util|\.\.\/lib\/store|\.\.\/lib\/hdc\/captureSessions)$/,
          },
          (args) => ({ path: args.path, external: true }),
        )
      },
    },
  ],
})

async function open(area, restored) {
  let bounds, minimum
  const handlers = new Map()
  const win = {
    getBounds: () => bounds,
    getContentBounds: () => bounds,
    isMaximized: () => false,
    isFullScreen: () => false,
    webContents: { mainFrame: {} },
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
        case '../lib/hdc/captureSessions':
          return { registerCaptureWindow: () => () => {} }
        case 'electron':
          return { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, screen: { getDisplayMatching: () => ({ workArea: area }) } }
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
  return {
    get bounds() { return bounds }, get minimum() { return minimum }, win,
    fit(width, height, inset, event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }) {
      assert.equal(typeof handlers.get('fitScreencast'), 'function', 'window must accept actual frame geometry');
      return handlers.get('fitScreencast')(event, width, height, inset)
    },
  }
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


test('first landscape frame removes large letterbox while preserving visible video area', async () => {
  const w = await open({ x: 0, y: 0, width: 1920, height: 1040 });
  w.fit(2412, 1084, 61);
  assert.ok(w.bounds.width > 700);
  assert.ok(Math.abs(w.bounds.width / (w.bounds.height - 61) - 2412 / 1084) < 0.01);
});

test('portrait and rotated frames include toolbar and stay inside a small negative-origin work area', async () => {
  const area = { x: -800, y: -600, width: 800, height: 560 };
  const w = await open(area);
  for (const [width,height,inset] of [[1084,2412,92],[2412,1084,61]]) {
    w.fit(width,height,inset);
    assert.ok(Math.abs(w.bounds.width / (w.bounds.height - inset) - width / height) < 0.01);
    assert.ok(w.bounds.x >= area.x && w.bounds.y >= area.y);
    assert.ok(w.bounds.x + w.bounds.width <= area.x + area.width);
    assert.ok(w.bounds.y + w.bounds.height <= area.y + area.height);
    assert.ok(w.minimum[0] <= w.bounds.width && w.minimum[1] <= w.bounds.height);
  }
});

test('frame fitting rejects other documents and invalid dimensions, preserves maximized/fullscreen', async () => {
  const w = await open({ x: 0,y: 0,width: 1920,height: 1040 });
  const before = { ...w.bounds };
  assert.throws(() => w.fit(1084,2412,61,{sender:{},senderFrame:{}}));
  for (const args of [[0,1084,61],[NaN,1084,61],[1084,2412,-1],[1084,2412,Infinity],[1e9,1,61]]) assert.throws(() => w.fit(...args));
  w.win.isMaximized = () => true;
  w.fit(1084,2412,61);
  assert.deepEqual({...w.bounds}, before);
  w.win.isMaximized = () => false;
  w.win.isFullScreen = () => true;
  w.fit(1084,2412,61);
  assert.deepEqual({...w.bounds}, before);
});
