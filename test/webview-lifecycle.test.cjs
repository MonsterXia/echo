const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync, buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { observable, runInAction } = require('mobx')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document
global.getComputedStyle = dom.window.getComputedStyle
window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
})
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
}
global.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = require('react-dom/client')
const { observer } = require('mobx-react-lite')
// Bundle the installed ESM wrapper (its extensionless imports need a bundler,
// just as in Vite). Keep React shared with the actual component under test.
const gridContext = vm.createContext({
  require,
  window,
  document,
  console,
  navigator: window.navigator,
  getComputedStyle,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
})
vm.runInContext(
  buildSync({
    entryPoints: [require.resolve('luna-data-grid/react')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'GridWrapper',
    write: false,
    external: ['react', 'react/jsx-runtime'],
  }).outputFiles[0].text,
  gridContext,
)
const LunaDataGrid = gridContext.GridWrapper.default
const filename = path.resolve(
  __dirname,
  '../src/renderer/main/components/webview/Webview.tsx',
)
const source = transformSync(readFileSync(filename, 'utf8'), {
  loader: 'tsx',
  format: 'cjs',
  jsx: 'automatic',
}).code

const bundle = { name: 'fixture.bundle', pid: 123 }
const page = (id = 'page', port = 1234) => ({
  id,
  title: id,
  url: `https://example.test/${id}`,
  type: 'page',
  webSocketDebuggerUrl: `ws://localhost:${port}/devtools/page/${id}`,
})

// Execute the real component with React hooks, MobX and Luna's actual grid.
// IPC, toolbar widgets, layout APIs and the poll clock are substituted; tests drive registered
// callbacks and explicitly settle promises, without copying polling logic.
async function fixture(
  t,
  { strict = false, target = { key: 'device-a' } } = {},
) {
  const calls = { top: [], pages: [], opened: [] }
  const timers = new Map()
  let nextTimer = 0,
    gridProps,
    grid
  const store = observable({ target, panel: 'webview' })
  function request(kind, args) {
    let resolve, reject
    const promise = new Promise((yes, no) => {
      resolve = yes
      reject = no
    })
    calls[kind].push({ args, resolve, reject })
    return promise
  }
  const main = {
    getTopBundle: (...args) => request('top', args),
    getWebviews: (...args) => request('pages', args),
    openWindow: (...args) => calls.opened.push(args),
    openExternal: (...args) => calls.opened.push(args),
  }
  const h = React.createElement
  const Empty = () => null
  const mocks = {
    '../../store': store,
    './Webview.module.scss': {},
    'common/util': { t: (key) => key },
    'share/renderer/lib/hooks': { useWindowResize() {} },
    'luna-toolbar/react': {
      __esModule: true,
      default: ({ children }) => h('div', null, children),
      LunaToolbarInput: Empty,
      LunaToolbarSpace: Empty,
      LunaToolbarText: ({ text }) => h('span', { 'data-bundle': true }, text),
    },
    'share/renderer/components/ToolbarIcon': ({ icon, onClick, disabled }) =>
      h('button', { 'data-action': icon, onClick, disabled }),
    'luna-data-grid/react': (props) => {
      gridProps = props
      return h(LunaDataGrid, {
        ...props,
        onCreate(instance) {
          grid = instance
          props.onCreate(instance)
        },
      })
    },
  }
  const context = vm.createContext({
    module: { exports: {} },
    console,
    main,
    document,
    window,
    setTimeout(callback, ms) {
      const id = ++nextTimer
      timers.set(id, { callback, ms })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    require(id) {
      return id in mocks ? mocks[id] : require(id)
    },
  })
  vm.runInContext(source, context, { filename })
  const Webview = context.module.exports.default
  // Same device-key remount boundary as App.tsx; panel changes keep it mounted.
  const Panels = observer(() => h(Webview, { key: store.target?.key || '' }))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let mounted = true
  async function unmount() {
    if (mounted) {
      await act(async () => root.unmount())
      mounted = false
    }
  }
  t.after(async () => {
    await unmount()
    container.remove()
  })
  await act(async () =>
    root.render(h(strict ? React.StrictMode : React.Fragment, null, h(Panels))),
  )
  return {
    calls,
    timers,
    unmount,
    rows: () => Array.from(gridProps.data, (row) => row.id),
    name: () => container.querySelector('[data-bundle]').textContent,
    disabled: (action) =>
      container.querySelector(`[data-action="${action}"]`).disabled,
    select: async () => act(async () => grid.selectSingle(grid.nodes[0])),
    click: async (action) =>
      act(async () =>
        container.querySelector(`[data-action="${action}"]`).click(),
      ),
    settle: async (pending, value, fail = false) =>
      act(async () => pending[fail ? 'reject' : 'resolve'](value)),
    change: async (values) =>
      act(async () => runInAction(() => Object.assign(store, values))),
    tick: async () => {
      assert.equal(timers.size, 1, 'one pending poll')
      const [id, timer] = timers.entries().next().value
      assert.equal(timer.ms, 2000)
      timers.delete(id)
      // Do not await a callback whose IPC promise is controlled by the test.
      await act(async () => {
        timer.callback()
      })
    },
  }
}

async function complete(f, topIndex, pages = [page()]) {
  await f.settle(f.calls.top[topIndex], bundle)
  await f.settle(f.calls.pages.at(-1), pages)
}

test('polling waits for both IPC stages before scheduling the next pass', async (t) => {
  const f = await fixture(t)
  assert.equal(f.timers.size, 0)
  await f.settle(f.calls.top[0], bundle)
  assert.equal(f.timers.size, 0)
  await f.settle(f.calls.pages[0], [page()])
  assert.deepEqual(f.rows(), ['page'])
  await f.tick()
  assert.equal(f.calls.top.length, 2)
  assert.equal(f.calls.pages.length, 1)
  assert.equal(f.timers.size, 0)
})

test('unmount cancels a scheduled poll', async (t) => {
  const f = await fixture(t)
  await complete(f, 0)
  await f.unmount()
  assert.equal(f.timers.size, 0)
})

test('unmount during top-bundle query prevents a late WebView IPC', async (t) => {
  const f = await fixture(t)
  await f.unmount()
  await f.settle(f.calls.top[0], bundle)
  assert.equal(f.calls.pages.length, 0)
  assert.equal(f.timers.size, 0)
})

test('unmount during WebView query never schedules another pass', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.top[0], bundle)
  await f.unmount()
  await f.settle(f.calls.pages[0], [page('late')])
  assert.equal(f.timers.size, 0)
})

test('device-key remount prevents old-device IPC continuation', async (t) => {
  const f = await fixture(t)
  await f.change({ target: { key: 'device-b' } })
  await complete(f, 1, [page('current')])
  await f.settle(f.calls.top[0], bundle)
  assert.equal(f.calls.pages.length, 1)
  assert.deepEqual(Array.from(f.calls.pages[0].args), ['device-b', 123])
  assert.deepEqual(f.rows(), ['current'])
})

test('StrictMode cleanup prevents its abandoned query from starting the next stage', async (t) => {
  const f = await fixture(t, { strict: true })
  assert.equal(f.calls.top.length, 2)
  await complete(f, 1, [page('current')])
  await f.settle(f.calls.top[0], bundle)
  assert.equal(f.calls.pages.length, 1)
  assert.deepEqual(f.rows(), ['current'])
  assert.equal(f.timers.size, 1)
})

test('hidden panel discards late pages and resumes with a fresh query', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.top[0], bundle)
  await f.change({ panel: 'overview' })
  await f.settle(f.calls.pages[0], [page('hidden')])
  assert.deepEqual(f.rows(), [])
  assert.equal(f.name(), '')
  assert.equal(f.timers.size, 0)
  await f.change({ panel: 'webview' })
  assert.equal(f.calls.top.length, 2)
  await complete(f, 1, [page('resumed')])
  assert.deepEqual(f.rows(), ['resumed'])
})

test('late rejection from a hidden pass cannot clear a newer result', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.top[0], bundle)
  await f.change({ panel: 'overview' })
  await f.change({ panel: 'webview' })
  assert.equal(f.calls.top.length, 2)
  await complete(f, 1, [page('current')])
  await f.settle(f.calls.pages[0], new Error('obsolete'), true)
  assert.deepEqual(f.rows(), ['current'])
  assert.equal(f.timers.size, 1)
})

for (const stage of ['top', 'pages']) {
  test(`${stage} failure clears stale rows and actions, then polling recovers`, async (t) => {
    const f = await fixture(t)
    await complete(f, 0)
    await f.select()
    assert.equal(f.disabled('debug'), false)
    await f.tick()
    if (stage === 'pages') await f.settle(f.calls.top[1], bundle)
    await f.settle(f.calls[stage].at(-1), new Error('fixture failure'), true)
    assert.deepEqual(f.rows(), [])
    assert.equal(f.name(), '')
    assert.equal(f.disabled('debug'), true)
    assert.equal(f.disabled('browser'), true)
    await f.tick()
    await complete(f, 2, [page('recovered')])
    assert.deepEqual(f.rows(), ['recovered'])
  })
}

for (const empty of ['no-pid', 'no-pages']) {
  test(`${empty} clears stale selection and can recover`, async (t) => {
    const f = await fixture(t)
    await complete(f, 0)
    await f.select()
    await f.tick()
    if (empty === 'no-pid') await f.settle(f.calls.top[1], { name: '', pid: 0 })
    else await complete(f, 1, [])
    assert.deepEqual(f.rows(), [])
    assert.equal(f.disabled('debug'), true)
    assert.equal(f.disabled('browser'), true)
    await f.tick()
    await complete(f, 2)
    assert.deepEqual(f.rows(), ['page'])
  })
}

test('no target does not schedule polling or IPC', async (t) => {
  const f = await fixture(t, { target: null })
  assert.equal(f.calls.top.length, 0)
  assert.equal(f.timers.size, 0)
})

test('a selected target uses refreshed URLs for the same id', async (t) => {
  const f = await fixture(t)
  await complete(f, 0)
  await f.select()
  await f.tick()
  await complete(f, 1, [page('page', 5678)])
  await f.click('debug')
  assert.match(f.calls.opened[0][0], /localhost:5678/)
})

test('a new foreground PID does not inherit selection from an identical page id', async (t) => {
  const f = await fixture(t)
  await complete(f, 0)
  await f.select()
  await f.tick()
  await f.settle(f.calls.top[1], { name: 'fixture.other', pid: 456 })
  await f.settle(f.calls.pages[1], [page()])
  assert.equal(f.disabled('debug'), true)
})

test('a successful obsolete pass cannot overwrite a new visible result', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.top[0], bundle)
  await f.change({ panel: 'overview' })
  await f.change({ panel: 'webview' })
  assert.equal(f.calls.top.length, 2)
  await complete(f, 1, [page('current')])
  await f.settle(f.calls.pages[0], [page('obsolete')])
  assert.deepEqual(f.rows(), ['current'])
  assert.equal(f.timers.size, 1)
})

test('hiding during top-bundle lookup prevents the next IPC stage', async (t) => {
  const f = await fixture(t)
  await f.change({ panel: 'overview' })
  await f.settle(f.calls.top[0], bundle)
  assert.equal(f.calls.pages.length, 0)
  assert.equal(f.timers.size, 0)
})
