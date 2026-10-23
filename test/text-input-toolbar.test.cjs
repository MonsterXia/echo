const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
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
global.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
})
const { createRoot } = require('react-dom/client')
const widgetContext = vm.createContext({
  require,
  window,
  document,
  navigator: window.navigator,
  console,
  setTimeout,
  clearTimeout,
})
vm.runInContext(
  buildSync({
    entryPoints: [require.resolve('luna-toolbar/react')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'Widgets',
    write: false,
    external: ['react', 'react/jsx-runtime'],
  }).outputFiles[0].text,
  widgetContext,
)
const widgets = widgetContext.Widgets

function load(file, mocks, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(
    transformSync(
      fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'),
      {
        loader: 'tsx',
        format: 'cjs',
        jsx: 'automatic',
      },
    ).code,
    {
      module,
      exports: module.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      ...globals,
    },
  )
  return module.exports.default
}
const ToolbarIcon = load('src/share/renderer/components/ToolbarIcon.tsx', {
  'luna-toolbar/react': widgets,
})
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  // Keep controlled rejection cleanup from becoming a test-runner orphan.
  // The production callback's own result and notification are asserted below.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

// Actual Toolbar, React hooks, MobX observer, shared icon and installed Luna
// widgets. Only prompt/IPC/notification boundaries and unrelated capture APIs
// are substituted. No Electron, clipboard or device access.
async function fixture(
  t,
  { strict = false, target = { key: 'synthetic-a' } } = {},
) {
  const prompts = [],
    sends = [],
    notifications = []
  const store = observable({ target, scale: 1, alwaysOnTop: false })
  let onClick
  const Toolbar = load(
    'src/renderer/screencast/components/Toolbar.tsx',
    {
      '../store': store,
      './Toolbar.module.scss': {},
      'common/util': { t: (key) => key },
      'luna-toolbar/react': widgets,
      'share/renderer/components/ToolbarIcon': (props) => {
        if (props.icon === 'text') onClick = props.onClick
        return React.createElement(ToolbarIcon, props)
      },
      'luna-modal': {
        prompt: () => {
          const p = deferred()
          prompts.push(p)
          return p.promise
        },
      },
      'share/renderer/lib/util': {
        notify: (text, options) =>
          notifications.push({ text, icon: options.icon }),
      },
      'licia/fullscreen': {},
      'licia/download': {},
    },
    {
      main: {
        inputText: (...args) => {
          const p = deferred()
          sends.push({ ...p, args })
          return p.promise
        },
      },
    },
  )
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let mounted = true
  const unmount = async () => {
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
    root.render(
      React.createElement(
        strict ? React.StrictMode : React.Fragment,
        null,
        React.createElement(Toolbar),
      ),
    ),
  )
  return {
    prompts,
    sends,
    notifications,
    unmount,
    button: () => container.querySelector('.icon-text').closest('button'),
    busy: () =>
      container
        .querySelector('.icon-text')
        .closest('.luna-toolbar-item')
        .classList.contains('luna-toolbar-disabled'),
    invoke: () => {
      const p = onClick()
      p.catch(() => {})
      return p
    },
    change: async (next) =>
      act(async () =>
        runInAction(() => {
          store.target = next
        }),
      ),
  }
}
async function begin(f, text = '合成文本') {
  let task
  await act(async () => {
    task = f.invoke()
  })
  await act(async () => f.prompts.at(-1).resolve(text))
  return { task }
}

for (const strict of [false, true]) {
  test(`waits for bridge and guards repeated clicks before rerender (strict=${strict})`, async (t) => {
    const f = await fixture(t, { strict })
    let task,
      settled = false
    await act(async () => {
      task = f.invoke()
      task.then(() => {
        settled = true
      })
      f.invoke()
    })
    assert.equal(f.prompts.length, 1)
    assert.equal(f.busy(), true)
    await act(async () => f.prompts[0].resolve('合成文本'))
    assert.equal(settled, false)
    assert.deepEqual(f.sends[0].args, ['synthetic-a', '合成文本'])
    await act(async () => {
      f.button().click()
      f.invoke()
    })
    assert.equal(f.prompts.length, 1)
    assert.equal(f.sends.length, 1)
    await act(async () => {
      f.sends[0].resolve()
      await task
    })
    assert.equal(settled, true)
    assert.equal(f.busy(), false)
    await act(async () => f.button().click())
    assert.equal(f.prompts.length, 2)
    await act(async () => f.prompts[1].resolve(null))
  })
}

for (const text of [null, '']) {
  test(`cancel/empty does not send and releases the button (${JSON.stringify(text)})`, async (t) => {
    const f = await fixture(t)
    const { task } = await begin(f, text)
    await task
    assert.equal(f.sends.length, 0)
    assert.equal(f.busy(), false)
    assert.equal(f.notifications.length, 0)
  })
}
test('preserves whitespace and special text without rewriting', async (t) => {
  const f = await fixture(t)
  const { task } = await begin(f, '  中文 "\\$;&🙂  ')
  assert.deepEqual(f.sends[0].args, ['synthetic-a', '  中文 "\\$;&🙂  '])
  await act(async () => {
    f.sends[0].resolve()
    await task
  })
})
test('consumes bridge rejection, gives generic feedback and only retries on a new user action', async (t) => {
  const f = await fixture(t)
  const { task } = await begin(f)
  await act(async () => {
    f.sends[0].reject(Error('synthetic sensitive error'))
    await task
  })
  assert.deepEqual(f.notifications, [{ text: 'commonErr', icon: 'error' }])
  assert.equal(f.sends.length, 1)
  assert.equal(f.busy(), false)
  const retry = await begin(f, 'new synthetic text')
  assert.equal(f.sends.length, 2)
  await act(async () => {
    f.sends[1].resolve()
    await retry.task
  })
})
test('prompt rejection is consumed and releases the button', async (t) => {
  const f = await fixture(t)
  let task
  await act(async () => {
    task = f.invoke()
  })
  await act(async () => {
    f.prompts[0].reject(Error('prompt failure'))
    await task
  })
  assert.deepEqual(f.notifications, [{ text: 'commonErr', icon: 'error' }])
  assert.equal(f.busy(), false)
  assert.equal(f.sends.length, 0)
})
for (const next of [{ key: 'synthetic-b' }, { key: 'synthetic-a' }]) {
  test(`target replacement invalidates an unsubmitted prompt (${next.key})`, async (t) => {
    const f = await fixture(t)
    let task
    await act(async () => {
      task = f.invoke()
    })
    await f.change(next)
    await act(async () => {
      f.prompts[0].resolve('stale synthetic')
      await task
    })
    assert.equal(f.sends.length, 0)
    assert.equal(f.notifications.length, 0)
  })
}
for (const rejects of [false, true]) {
  test(`old completion cannot unlock or notify a new target operation (rejects=${rejects})`, async (t) => {
    const f = await fixture(t)
    const old = await begin(f)
    await f.change({ key: 'synthetic-b' })
    const current = await begin(f, 'current synthetic')
    await act(async () => {
      if (rejects) f.sends[0].reject(Error('old failure'))
      else f.sends[0].resolve()
      await old.task
    })
    assert.equal(f.busy(), true)
    assert.equal(f.notifications.length, 0)
    await act(async () => f.invoke())
    assert.equal(f.prompts.length, 2)
    assert.deepEqual(f.sends[1].args, ['synthetic-b', 'current synthetic'])
    await act(async () => {
      f.sends[1].resolve()
      await current.task
    })
    assert.equal(f.busy(), false)
  })
}
test('unmount before prompt completion prevents any send', async (t) => {
  const f = await fixture(t)
  let task
  await act(async () => {
    task = f.invoke()
  })
  await f.unmount()
  f.prompts[0].resolve('stale synthetic')
  await task
  assert.equal(f.sends.length, 0)
})
test('unmount after send consumes rejection without notifying', async (t) => {
  const f = await fixture(t)
  const { task } = await begin(f)
  await f.unmount()
  f.sends[0].reject(Error('late failure'))
  await task
  assert.equal(f.notifications.length, 0)
  assert.equal(f.sends.length, 1)
})
test('no target cannot open the text prompt', async (t) => {
  const f = await fixture(t, { target: null })
  await act(async () => {
    f.invoke()
  })
  assert.equal(f.prompts.length, 0)
  assert.equal(f.busy(), true)
})
