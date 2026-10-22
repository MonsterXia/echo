const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { observable, runInAction } = require('mobx')

const dom = new JSDOM('<!doctype html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document
global.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = require('react-dom/client')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const sources = new Map()
function source(relative) {
  if (!sources.has(relative)) {
    const filename = path.resolve(__dirname, '..', relative)
    sources.set(
      relative,
      transformSync(readFileSync(filename, 'utf8'), {
        loader: filename.endsWith('tsx') ? 'tsx' : 'ts',
        format: 'cjs',
        jsx: 'automatic',
      }).code,
    )
  }
  return sources.get(relative)
}

function info(bundleName) {
  return {
    bundleName,
    label: bundleName,
    icon: '',
    system: false,
    versionName: '1',
    apiTargetVersion: 1,
    vendor: '',
    installTime: 0,
    releaseType: 'Release',
    mainAbility: 'EntryAbility',
  }
}

// Real React hooks, MobX observer, Application and installBundles. Only native
// UI widgets, Electron IPC and notification/dialog boundaries are substituted.
// Every IPC completion is controlled explicitly; no devices or timing sleeps.
async function fixture(
  t,
  { strict = false, delayInfos = false, hapPaths = ['fixture.hap'] } = {},
) {
  const calls = { lists: [], infos: [], installs: [], uninstalls: [] }
  const notifications = []
  let menu, iconProps, gridProps
  const store = observable({
    target: { key: 'fixture-a' },
    application: {
      sysBundle: false,
      listView: false,
      itemSize: 64,
      set(name, value) {
        this[name] = value
      },
    },
  })
  function request(kind, args) {
    const pending = { args, ...deferred() }
    calls[kind].push(pending)
    return pending.promise
  }
  const main = {
    getBundles: (...args) => request('lists', args),
    getBundleInfos: (...args) =>
      delayInfos ? request('infos', args) : Promise.resolve(args[1].map(info)),
    showOpenDialog: async () => ({ filePaths: hapPaths }),
    installBundle: (...args) => request('installs', args),
    uninstallBundle: (...args) => request('uninstalls', args),
  }
  const h = React.createElement
  const Container = ({ children }) => h('div', null, children)
  const Empty = () => null
  const mocks = {
    '../../store': store,
    'common/util': { t: (key) => key },
    'share/renderer/lib/util': {
      isFileDrop: () => true,
      notify: (...args) => notifications.push(args),
    },
    'share/renderer/lib/hooks': { useWindowResize() {} },
    'share/renderer/lib/contextMenu': (_event, template) => {
      menu = template
    },
    'luna-modal': { confirm: async () => true },
    'licia/toEl': (html) => html,
    'luna-toolbar/react': {
      __esModule: true,
      default: Container,
      LunaToolbarCheckbox: ({ onChange, disabled }) =>
        h('button', {
          'data-action': 'system',
          disabled,
          onClick: () => onChange(true),
        }),
      LunaToolbarInput: Empty,
      LunaToolbarSeparator: Empty,
      LunaToolbarSpace: Empty,
      LunaToolbarText: Empty,
    },
    'share/renderer/components/ToolbarIcon': ({ icon, onClick, disabled }) =>
      h('button', { 'data-action': icon, onClick, disabled }),
    'luna-icon-list/react': (props) => {
      iconProps = props
      return h(
        'div',
        null,
        props.icons.map(({ info }) =>
          h(
            'span',
            { key: info.bundleName, 'data-bundle': info.bundleName },
            info.label,
          ),
        ),
      )
    },
    'luna-data-grid/react': (props) => {
      gridProps = props
      return null
    },
    '../common/loading': {
      PannelLoading: () => h('div', { 'data-loading': true }),
    },
    './BundleInfoModal': Empty,
    './Application.module.scss': {},
    '../../../assets/default-icon.png': 'default-icon.png',
  }
  function load(relative) {
    const context = vm.createContext({
      module: { exports: {} },
      console,
      main,
      document,
      window,
      require(id) {
        if (id in mocks) return mocks[id]
        if (id === '../../../lib/util') return load('src/renderer/lib/util.ts')
        return require(id)
      },
    })
    vm.runInContext(source(relative), context, { filename: relative })
    return context.module.exports
  }
  const Application = load(
    'src/renderer/main/components/application/Application.tsx',
  ).default
  // App.tsx keys its panels by target; let the parent and child rerender in the
  // same React update instead of changing the store and remounting separately.
  const PanelTree = require('mobx-react-lite').observer(() =>
    h(Application, { key: store.target?.key || '' }),
  )
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let mounted = true
  async function render() {
    await act(async () =>
      root.render(
        h(strict ? React.StrictMode : React.Fragment, null, h(PanelTree)),
      ),
    )
  }
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
  await render()
  return {
    calls,
    store,
    notifications,
    render,
    unmount,
    names: () =>
      [...container.querySelectorAll('[data-bundle]')].map(
        (el) => el.dataset.bundle,
      ),
    loading: () => container.querySelector('[data-action="refresh"]').disabled,
    click: async (action) =>
      act(async () =>
        container.querySelector(`[data-action="${action}"]`).click(),
      ),
    settle: async (request, value, fail = false) =>
      act(async () => {
        request[fail ? 'reject' : 'resolve'](value)
      }),
    uninstall: async (name) => {
      await act(async () => {
        iconProps.onContextMenu({}, { data: { info: info(name) } })
        // Do not await an operation whose IPC completion is controlled by test.
        menu.find((item) => item.label === 'uninstall').click()
      })
    },
    gridNames: () => gridProps.data.map((row) => row.bundleName),
  }
}

test('installation during an in-flight refresh schedules a fresh query after it', async (t) => {
  const f = await fixture(t)
  await f.click('add')
  await f.settle(f.calls.installs[0])
  assert.equal(f.calls.lists.length, 1, 'must not query concurrently')
  await f.settle(f.calls.lists[0], ['old'])
  assert.equal(
    f.calls.lists.length,
    2,
    'installation refresh must not be dropped',
  )
  assert.equal(f.loading(), true)
  await f.settle(f.calls.lists[1], ['old', 'installed'])
  assert.deepEqual(f.names(), ['old', 'installed'])
  assert.equal(f.loading(), false)
  assert.equal(f.calls.lists.length, 2, 'no automatic retry loop')
})

test('an install callback from an idle render cannot overlap a newer refresh', async (t) => {
  const f = await fixture(t)
  await f.settle(f.calls.lists[0], ['old'])
  await f.click('add')
  await f.click('refresh')
  await f.settle(f.calls.installs[0])
  assert.equal(
    f.calls.lists.length,
    2,
    'old closure must use current request state',
  )
  await f.settle(f.calls.lists[1], ['old'])
  assert.equal(f.calls.lists.length, 3)
  await f.settle(f.calls.lists[2], ['installed'])
  assert.deepEqual(f.names(), ['installed'])
})

test('multiple install completions coalesce, and a request in the trailing pass runs once more', async (t) => {
  const f = await fixture(t)
  for (let i = 0; i < 3; i++) await f.click('add')
  for (const operation of f.calls.installs) await f.settle(operation)
  assert.equal(f.calls.lists.length, 1)
  await f.settle(f.calls.lists[0], [])
  assert.equal(f.calls.lists.length, 2)
  await f.click('add')
  await f.settle(f.calls.installs[3])
  await f.settle(f.calls.lists[1], [])
  assert.equal(f.calls.lists.length, 3)
  await f.settle(f.calls.lists[2], ['latest'])
  assert.deepEqual(f.names(), ['latest'])
  assert.equal(f.calls.lists.length, 3)
  assert.equal(f.loading(), false)
})

test('uninstall during a later metadata batch refreshes the final list and icon view', async (t) => {
  const f = await fixture(t, { delayInfos: true })
  await f.settle(f.calls.lists[0], [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
  ])
  await f.settle(
    f.calls.infos[0],
    ['one', 'two', 'three', 'four', 'five'].map(info),
  )
  assert.deepEqual(f.names(), ['one', 'two', 'three', 'four', 'five'])
  await f.uninstall('one')
  await f.settle(f.calls.uninstalls[0])
  assert.equal(f.calls.lists.length, 1)
  await f.settle(f.calls.infos[1], [info('six')])
  assert.equal(f.calls.lists.length, 2)
  await f.settle(f.calls.lists[1], [])
  assert.deepEqual(
    f.names(),
    [],
    'empty refresh must clear old icons as well as rows',
  )
  await act(async () => {
    f.store.application.set('listView', true)
  })
  assert.deepEqual(Array.from(f.gridNames()), [])
  assert.equal(f.loading(), false)
})

test('the trailing pass reads the latest system-app option', async (t) => {
  const f = await fixture(t)
  await f.click('add')
  await act(async () => f.store.application.set('sysBundle', true))
  await f.settle(f.calls.installs[0])
  await f.settle(f.calls.lists[0], [])
  assert.equal(f.calls.lists.length, 2)
  assert.deepEqual(Array.from(f.calls.lists[1].args), ['fixture-a', true])
  await f.settle(f.calls.lists[1], ['system'])
  assert.deepEqual(f.names(), ['system'])
})

for (const stage of ['lists', 'infos']) {
  test(`${stage} failure releases loading and a manual refresh recovers`, async (t) => {
    const f = await fixture(t, { delayInfos: true })
    if (stage === 'infos') await f.settle(f.calls.lists[0], ['old'])
    await f.settle(f.calls[stage][0], new Error('fixture query failed'), true)
    assert.equal(f.loading(), false)
    assert.equal(f.calls.lists.length, 1, 'failure must not retry by itself')
    assert.equal(
      f.notifications.some(([text]) => text === 'commonErr'),
      true,
    )
    await f.click('refresh')
    await f.settle(f.calls.lists[1], ['recovered'])
    await f.settle(f.calls.infos.at(-1), [info('recovered')])
    assert.deepEqual(f.names(), ['recovered'])
    assert.equal(f.loading(), false)
  })
}

test('a failed active query still drains a queued installation refresh', async (t) => {
  const f = await fixture(t)
  await f.click('add')
  await f.settle(f.calls.installs[0])
  await f.settle(f.calls.lists[0], new Error('fixture failure'), true)
  assert.equal(f.calls.lists.length, 2)
  await f.settle(f.calls.lists[1], ['installed'])
  assert.deepEqual(f.names(), ['installed'])
  assert.equal(f.loading(), false)
})

test('a failed installation does not request a refresh', async (t) => {
  const f = await fixture(t)
  await f.click('add')
  await f.settle(
    f.calls.installs[0],
    new Error('fixture install failure'),
    true,
  )
  await f.settle(f.calls.lists[0], ['old'])
  assert.equal(f.calls.lists.length, 1)
  assert.deepEqual(f.names(), ['old'])
})

test('unmount discards queued refreshes and late metadata without starting another batch', async (t) => {
  const f = await fixture(t, { delayInfos: true })
  await f.settle(f.calls.lists[0], [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
  ])
  await f.click('add')
  await f.settle(f.calls.installs[0])
  await f.unmount()
  await f.settle(f.calls.infos[0], [info('one')])
  assert.equal(f.calls.infos.length, 1)
  assert.equal(f.calls.lists.length, 1)
})

test('device remount ignores old enumeration and installation completions', async (t) => {
  const f = await fixture(t, { delayInfos: true })
  await f.click('add')
  await act(async () =>
    runInAction(() => {
      f.store.target = { key: 'fixture-b' }
    }),
  )
  await f.settle(f.calls.lists[1], ['new-device-app'])
  await f.settle(f.calls.infos[0], [info('new-device-app')])
  await f.settle(f.calls.installs[0])
  await f.settle(f.calls.lists[0], ['old-device-app'])
  assert.deepEqual(f.names(), ['new-device-app'])
  assert.equal(f.calls.lists.length, 2)
  assert.equal(
    f.calls.infos.length,
    1,
    'old enumeration must not start metadata queries',
  )
  assert.deepEqual(Array.from(f.calls.infos[0].args), [
    'fixture-b',
    ['new-device-app'],
  ])
})

test('StrictMode cleanup does not allow its abandoned refresh to overwrite the active effect', async (t) => {
  const f = await fixture(t, { strict: true, delayInfos: true })
  assert.equal(f.calls.lists.length, 2)
  await f.settle(f.calls.lists[1], ['current'])
  await f.settle(f.calls.infos[0], [info('current')])
  await f.settle(f.calls.lists[0], ['abandoned'])
  assert.deepEqual(f.names(), ['current'])
  assert.equal(f.calls.infos.length, 1)
  assert.equal(f.loading(), false)
})

test('a later metadata batch failure still drains a queued installation refresh', async (t) => {
  const f = await fixture(t, { delayInfos: true })
  await f.settle(f.calls.lists[0], [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
  ])
  await f.settle(
    f.calls.infos[0],
    ['one', 'two', 'three', 'four', 'five'].map(info),
  )
  await f.click('add')
  await f.settle(f.calls.installs[0])
  await f.settle(f.calls.infos[1], new Error('fixture metadata failure'), true)
  assert.equal(f.calls.lists.length, 2)
  assert.equal(f.loading(), true)
  await f.settle(f.calls.lists[1], ['installed'])
  await f.settle(f.calls.infos[2], [info('installed')])
  assert.deepEqual(f.names(), ['installed'])
  assert.equal(f.loading(), false)
})

test('a late old-device rejection cannot notify or release the new device loading state', async (t) => {
  const f = await fixture(t)
  await act(async () =>
    runInAction(() => {
      f.store.target = { key: 'fixture-b' }
    }),
  )
  await f.settle(f.calls.lists[0], new Error('old device failure'), true)
  assert.equal(f.notifications.length, 0)
  assert.equal(f.loading(), true)
  assert.equal(f.calls.lists.length, 2)
  await f.settle(f.calls.lists[1], ['current'])
  assert.deepEqual(f.names(), ['current'])
  assert.equal(f.loading(), false)
})

test('a partially successful multi-file installation requests one trailing refresh', async (t) => {
  const f = await fixture(t, { hapPaths: ['first.hap', 'second.hap'] })
  await f.click('add')
  await f.settle(f.calls.installs[0])
  await f.settle(
    f.calls.installs[1],
    new Error('fixture install failure'),
    true,
  )
  assert.equal(f.calls.lists.length, 1)
  await f.settle(f.calls.lists[0], [])
  assert.equal(f.calls.lists.length, 2)
  await f.settle(f.calls.lists[1], ['installed'])
  assert.deepEqual(f.names(), ['installed'])
  assert.equal(f.loading(), false)
})
