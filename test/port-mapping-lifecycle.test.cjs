const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { buildSync, transformSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { observable, runInAction } = require('mobx')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document
global.getComputedStyle = dom.window.getComputedStyle
global.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
})
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
}
const { createRoot } = require('react-dom/client')
const { observer } = require('mobx-react-lite')

// Vite resolves these extensionless ESM imports too. Use the installed Luna
// implementations with shared React, substituting only layout-only browser APIs.
const widgets = vm.createContext({
  require,
  window,
  document,
  navigator: window.navigator,
  console,
  getComputedStyle,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
})
vm.runInContext(
  buildSync({
    stdin: {
      contents: `export { default as Modal } from 'luna-modal/react';
    export { default as Grid } from 'luna-data-grid/react';
    export * as Toolbar from 'luna-toolbar/react';`,
      resolveDir: path.resolve(__dirname, '..'),
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'Widgets',
    write: false,
    external: ['react', 'react/jsx-runtime', 'react-dom'],
  }).outputFiles[0].text,
  widgets,
)

function compile(relative) {
  return transformSync(
    readFileSync(path.resolve(__dirname, '..', relative), 'utf8'),
    {
      loader: relative.endsWith('tsx') ? 'tsx' : 'ts',
      format: 'cjs',
      jsx: 'automatic',
    },
  ).code
}
const component = compile(
  'src/renderer/main/components/overview/PortMappingModal.tsx',
)
const util = compile('src/renderer/main/lib/util.ts')
const row = (port = 1001) => ({ local: `tcp:${port}`, remote: 'tcp:2001' })

// Actual component, portal, MobX, React and Luna modal/toolbar/grid. Controlled
// bridge promises never access HDC or real ports. Capture the real registered
// callbacks to await event handlers (React does not return their promises).
async function fixture(
  t,
  {
    visible = true,
    target = { key: 'fixture-a' },
    strict = false,
    keyed = true,
  } = {},
) {
  const state = observable({ visible, target })
  const calls = Object.fromEntries(
    [
      'listForwards',
      'listReverses',
      'forward',
      'reverse',
      'removeForward',
      'removeReverse',
    ].map((key) => [key, []]),
  )
  const notifications = []
  const controls = {}
  let grid
  const main = Object.fromEntries(
    Object.keys(calls).map((key) => [
      key,
      (...args) => {
        let resolve, reject
        const promise = new Promise((yes, no) => {
          resolve = yes
          reject = no
        })
        calls[key].push({ args, resolve, reject })
        return promise
      },
    ]),
  )
  const h = React.createElement
  const toolbar = { __esModule: true, ...widgets.Widgets.Toolbar }
  for (const name of [
    'LunaToolbarInput',
    'LunaToolbarSelect',
    'LunaToolbarButton',
  ]) {
    const Widget = toolbar[name]
    toolbar[name] = (props) => {
      controls[props.keyName || 'add'] = props
      return h(Widget, props)
    }
  }
  const mocks = {
    '../../store': state,
    'common/util': { t: (key) => key },
    './PortMappingModal.module.scss': {},
    'share/renderer/lib/util': {
      notify: (...args) => notifications.push(args),
    },
    'luna-modal/react': widgets.Widgets.Modal,
    'luna-toolbar/react': toolbar,
    'luna-data-grid/react': (props) =>
      h(widgets.Widgets.Grid, {
        ...props,
        onCreate(instance) {
          grid = instance
        },
      }),
    'share/renderer/components/ToolbarIcon': (props) => {
      controls[props.icon] = props
      return h('button', {
        'data-action': props.icon,
        disabled: props.disabled,
        onClick: props.onClick,
      })
    },
  }
  function load(source) {
    const context = vm.createContext({
      module: { exports: {} },
      main,
      window,
      document,
      console,
      require(id) {
        if (id === '../../lib/util') return load(util)
        return id in mocks ? mocks[id] : require(id)
      },
    })
    vm.runInContext(source, context)
    return context.module.exports
  }
  const Modal = load(component).default
  const Tree = observer(() =>
    h(Modal, {
      key: keyed ? state.target?.key || '' : 'stable',
      visible: state.visible,
      onClose: () =>
        runInAction(() => {
          state.visible = false
        }),
    }),
  )
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
    root.render(h(strict ? React.StrictMode : React.Fragment, null, h(Tree))),
  )
  return {
    calls,
    notifications,
    unmount,
    rows: () => Array.from(grid.nodes, (n) => n.data.local),
    selected: () => grid.getSelected().length,
    disabled: (action) => controls[action].disabled,
    change: async (values) =>
      act(async () => runInAction(() => Object.assign(state, values))),
    select: async () => act(async () => grid.selectSingle(grid.nodes[0])),
    direction: async (direction) =>
      act(async () => {
        const select = document.querySelector(
          '.luna-toolbar-item-select select',
        )
        select.value = direction
        select.dispatchEvent(new window.Event('change', { bubbles: true }))
      }),
    input: async (key, value) => act(async () => controls[key].onChange(value)),
    start: async (action) => {
      let pending
      await act(async () => {
        pending = Promise.resolve(controls[action].onClick())
        pending.catch(() => {})
      })
      return { pending }
    },
    settle: async (request, value, fail = false) =>
      act(async () => request[fail ? 'reject' : 'resolve'](value)),
    finish: async (operation) => act(async () => operation.pending),
  }
}

test('hidden mount does not read; open and reopen read only while visible', async (t) => {
  const f = await fixture(t, { visible: false })
  assert.equal(f.calls.listForwards.length, 0)
  await f.change({ visible: true })
  assert.equal(f.calls.listForwards.length, 1)
  await f.settle(f.calls.listForwards[0], [row()])
  await f.select()
  await f.change({ visible: false })
  assert.deepEqual(f.rows(), [])
  assert.equal(f.disabled('delete'), true)
  await f.change({ visible: true })
  assert.equal(f.calls.listForwards.length, 2)
  await f.settle(f.calls.listForwards[1], [row(1002)])
  assert.deepEqual(f.rows(), ['tcp:1002'])
})

test('no target never reads, target availability starts the visible query', async (t) => {
  const f = await fixture(t, { target: null, keyed: false })
  assert.equal(f.calls.listForwards.length, 0)
  await f.change({ target: { key: 'fixture-b' } })
  assert.equal(f.calls.listForwards.length, 1)
  assert.deepEqual(f.calls.listForwards[0].args, ['fixture-b'])
})

test('closed-session success cannot overwrite reopened rows', async (t) => {
  const f = await fixture(t)
  await f.change({ visible: false })
  await f.change({ visible: true })
  assert.equal(f.calls.listForwards.length, 2)
  await f.settle(f.calls.listForwards[1], [row(1002)])
  await f.settle(f.calls.listForwards[0], [row()])
  assert.deepEqual(f.rows(), ['tcp:1002'])
})

for (const direction of ['forward', 'reverse']) {
  test(`${direction} read rejection is consumed, clears selection, and manual retry recovers`, async (t) => {
    const f = await fixture(t)
    await f.settle(f.calls.listForwards[0], [row()])
    const kind = direction === 'forward' ? 'listForwards' : 'listReverses'
    if (direction === 'reverse') {
      await f.direction('reverse')
      await f.settle(f.calls.listReverses[0], [row()])
    }
    await f.select()
    const failed = await f.start('refresh')
    await f.settle(f.calls[kind].at(-1), new Error('synthetic rejection'), true)
    await f.finish(failed)
    assert.deepEqual(f.rows(), [])
    assert.equal(f.selected(), 0)
    assert.equal(f.disabled('delete'), true)
    assert.equal(f.notifications.length, 1)
    assert.equal(f.notifications[0][0], 'commonErr')
    const before = f.calls[kind].length
    const retry = await f.start('refresh')
    assert.equal(f.calls[kind].length, before + 1)
    await f.settle(f.calls[kind].at(-1), [row(1002)])
    await f.finish(retry)
    assert.deepEqual(f.rows(), ['tcp:1002'])
  })
}

for (const fail of [false, true]) {
  test(`a superseded refresh ${fail ? 'rejection' : 'success'} cannot affect the newest rows`, async (t) => {
    const f = await fixture(t)
    await f.settle(f.calls.listForwards[0], [row()])
    const old = await f.start('refresh')
    const current = await f.start('refresh')
    await f.settle(f.calls.listForwards[2], [row(1002)])
    await f.finish(current)
    await f.settle(
      f.calls.listForwards[1],
      fail ? new Error('obsolete') : [row()],
      fail,
    )
    await f.finish(old)
    assert.deepEqual(f.rows(), ['tcp:1002'])
    assert.equal(f.notifications.length, 0)
  })
}

test('direction change clears old selection and ignores late forward results', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.listForwards[0], [row()])
  await f.select()
  const old = await f.start('refresh')
  await f.direction('reverse')
  assert.equal(f.disabled('delete'), true)
  assert.deepEqual(f.rows(), [])
  await f.settle(f.calls.listReverses[0], [row(1002)])
  await f.settle(f.calls.listForwards[1], [row()])
  await f.finish(old)
  assert.deepEqual(f.rows(), ['tcp:1002'])
})

for (const keyed of [false, true]) {
  test(`target change ${keyed ? 'with App key remount' : 'in the same component'} invalidates the old request`, async (t) => {
    const f = await fixture(t, { keyed })
    await f.change({ target: { key: 'fixture-b' } })
    assert.equal(f.calls.listForwards.length, 2)
    await f.settle(f.calls.listForwards[1], [row(1002)])
    await f.settle(f.calls.listForwards[0], [row()])
    assert.deepEqual(f.rows(), ['tcp:1002'])
  })
}

test('StrictMode cleanup makes the first request obsolete', async (t) => {
  const f = await fixture(t, { strict: true })
  assert.equal(f.calls.listForwards.length, 2)
  await f.settle(f.calls.listForwards[1], [row(1002)])
  await f.settle(f.calls.listForwards[0], [row()])
  assert.deepEqual(f.rows(), ['tcp:1002'])
})

for (const boundary of ['close', 'unmount']) {
  test(`${boundary} consumes late rejection without notifying or starting another read`, async (t) => {
    const f = await fixture(t)
    await f.settle(f.calls.listForwards[0], [row()])
    const old = await f.start('refresh')
    if (boundary === 'close') await f.change({ visible: false })
    else await f.unmount()
    await f.settle(f.calls.listForwards[1], new Error('obsolete'), true)
    await f.finish(old)
    assert.equal(f.notifications.length, 0)
    assert.equal(f.calls.listForwards.length, 2)
  })
}

for (const direction of ['forward', 'reverse']) {
  test(`${direction} add/remove retain normalization and argument order`, async (t) => {
    const f = await fixture(t)
    await f.settle(f.calls.listForwards[0], [])
    const read = direction === 'forward' ? 'listForwards' : 'listReverses'
    const remove = direction === 'forward' ? 'removeForward' : 'removeReverse'
    if (direction === 'reverse') {
      await f.direction('reverse')
      await f.settle(f.calls.listReverses[0], [])
    }
    await f.input('local', ' 1001 ')
    await f.input('remote', '2001')
    const add = await f.start('add')
    const args =
      direction === 'forward'
        ? ['fixture-a', 'tcp:1001', 'tcp:2001']
        : ['fixture-a', 'tcp:2001', 'tcp:1001']
    assert.deepEqual(f.calls[direction][0].args, args)
    await f.settle(f.calls[direction][0])
    await f.finish(add)
    await f.settle(f.calls[read].at(-1), [row()])
    await f.select()
    const deletion = await f.start('delete')
    assert.deepEqual(f.calls[remove][0].args, args)
    await f.settle(f.calls[remove][0])
    await f.finish(deletion)
    await f.settle(f.calls[read].at(-1), [])
    assert.deepEqual(f.rows(), [])
  })
}

test('write completion after closing does not issue a hidden read', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.listForwards[0], [])
  await f.input('local', '1001')
  await f.input('remote', '2001')
  const add = await f.start('add')
  await f.change({ visible: false })
  await f.settle(f.calls.forward[0])
  await f.finish(add)
  assert.equal(f.calls.listForwards.length, 1)
})

test('initial read rejection is handled once without an automatic retry', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.listForwards[0], new Error('initial failure'), true)
  assert.equal(f.notifications.length, 1)
  assert.equal(f.notifications[0][0], 'commonErr')
  assert.deepEqual(f.rows(), [])
  assert.equal(f.calls.listForwards.length, 1)
})

test('an old write completion cannot refresh a reopened session', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.listForwards[0], [])
  await f.input('local', '1001')
  await f.input('remote', '2001')
  const add = await f.start('add')
  await f.change({ visible: false })
  await f.change({ visible: true })
  assert.equal(f.calls.listForwards.length, 2)
  await f.settle(f.calls.listForwards[1], [row(1002)])
  await f.settle(f.calls.forward[0])
  await f.finish(add)
  assert.equal(f.calls.listForwards.length, 2)
  assert.deepEqual(f.rows(), ['tcp:1002'])
})

test('write failures keep the existing error notification and do not request a read', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.listForwards[0], [row()])
  await f.input('local', '1001')
  await f.input('remote', '2001')
  const add = await f.start('add')
  await f.settle(f.calls.forward[0], new Error('write failure'), true)
  await f.finish(add)
  assert.equal(f.calls.listForwards.length, 1)
  await f.select()
  const deletion = await f.start('delete')
  await f.settle(f.calls.removeForward[0], new Error('remove failure'), true)
  await f.finish(deletion)
  assert.equal(f.calls.listForwards.length, 1)
  assert.equal(f.notifications.length, 2)
  assert.deepEqual(f.rows(), ['tcp:1001'])
})
