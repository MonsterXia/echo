const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync, buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { observable } = require('mobx')
// No resource loading or script execution: markup/attribute creation itself is
// the regression. All metadata below is synthetic.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document
global.getComputedStyle = dom.window.getComputedStyle
global.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} })
window.ResizeObserver = class { observe() {} unobserve() {} }
const { createRoot } = require('react-dom/client')
const widgetContext = vm.createContext({
  require, window, document, console, navigator: window.navigator,
  getComputedStyle, setTimeout, clearTimeout, setInterval, clearInterval,
})
vm.runInContext(buildSync({
  stdin: { contents: "export { default as Grid } from 'luna-data-grid/react'; export * as Toolbar from 'luna-toolbar/react'", resolveDir: process.cwd() },
  bundle: true, platform: 'browser', format: 'iife', globalName: 'Widgets', write: false,
  external: ['react', 'react/jsx-runtime'],
}).outputFiles[0].text, widgetContext)
const { Grid, Toolbar } = widgetContext.Widgets
const filename = path.resolve(__dirname, '../src/renderer/main/components/webview/Webview.tsx')
const source = transformSync(readFileSync(filename, 'utf8'), {
  loader: 'tsx', format: 'cjs', jsx: 'automatic',
}).code

// Actual Webview, React/MobX, installed Luna grid and toolbar. Shared icon and
// resize hook are presentation adapters so CI needs no src/share checkout.
async function fixture(t, metadata) {
  const opened = []
  const store = observable({ target: { key: 'synthetic-target' }, panel: 'webview' })
  const page = {
    id: 'synthetic-page', title: 'Synthetic title', type: 'page',
    url: 'https://example.test/page?x=1&y=2',
    webSocketDebuggerUrl: 'ws://localhost:1234/devtools/page/synthetic-page',
    ...metadata,
  }
  const h = React.createElement
  let grid
  const mocks = {
    '../../store': store, './Webview.module.scss': {},
    'common/util': { t: key => key },
    'share/renderer/lib/hooks': { useWindowResize() {} },
    'luna-toolbar/react': { __esModule: true, ...Toolbar },
    'share/renderer/components/ToolbarIcon': props => h(Toolbar.LunaToolbarButton,
      { onClick: props.onClick, disabled: props.disabled },
      h('span', { className: `icon-${props.icon}` })),
    'luna-data-grid/react': props => h(Grid, { ...props, onCreate(instance) {
      grid = instance
      props.onCreate(instance)
    } }),
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports, document, window,
    // Only the component's poll clock is inert; Luna runs its actual lifecycle.
    setTimeout: () => 1, clearTimeout() {},
    main: {
      async getTopBundle(key) {
        assert.equal(key, 'synthetic-target')
        return { name: 'synthetic.bundle', pid: 123 }
      },
      async getWebviews(key, pid) {
        assert.equal(key, 'synthetic-target'); assert.equal(pid, 123)
        return [page]
      },
      openWindow: (...args) => opened.push(args),
      openExternal: (...args) => opened.push(args),
    },
    require: id => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  }, { filename })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  await act(async () => root.render(h(module.exports.default)))
  assert.equal(grid.nodes.length, 1)
  return {
    opened,
    cell: grid.nodes[0].container.querySelector('td'),
    select: () => act(async () => grid.selectSingle(grid.nodes[0])),
    click: icon => act(async () => container.querySelector(`.icon-${icon}`).closest('button').click()),
  }
}

test('favicon-bearing title is literal text, never parsed into elements', async t => {
  const title = '<b data-injected="title">Synthetic &amp; title</b><svg onload="void 0"></svg>'
  const f = await fixture(t, { title, faviconUrl: 'https://example.test/icon.png' })
  assert.equal(f.cell.textContent, title)
  assert.equal(f.cell.querySelector('b, svg, [onload]'), null)
  assert.equal(f.cell.querySelectorAll('img').length, 1)
})

test('favicon quotes remain in one src attribute and cannot create attributes or markup', async t => {
  const faviconUrl = 'https://example.test/icon.png" onerror="void 0" data-injected="icon'
  const f = await fixture(t, { faviconUrl })
  const img = f.cell.querySelector('img')
  assert.ok(img)
  assert.equal(img.getAttribute('src'), faviconUrl)
  assert.deepEqual(img.getAttributeNames(), ['src'])
  assert.equal(f.cell.textContent, 'Synthetic title')
})

test('title markup stays text when no favicon is supplied', async t => {
  const title = '<img src=x onerror="void 0">Plain &amp; text'
  const f = await fixture(t, { title })
  // jsdom implements the grid's innerText setter separately from textContent.
  assert.equal(f.cell.innerText, title)
  assert.equal(f.cell.querySelector('img'), null)
})

for (const faviconUrl of [
  'https://example.test/icon.png?x=1&y=2',
  'http://localhost:1234/icon.png',
  'data:image/png;base64,iVBORw0KGgo=',
]) {
  test(`preserves icon src and title text (${faviconUrl.split(':')[0]})`, async t => {
    const title = '中文 & "quotes" <literal> 🙂'
    const f = await fixture(t, { title, faviconUrl })
    assert.equal(f.cell.querySelector('img').getAttribute('src'), faviconUrl)
    assert.equal(f.cell.textContent, title)
    assert.equal(f.cell.querySelector('literal'), null)
    await f.select()
    await f.click('browser')
    await f.click('debug')
    assert.deepEqual(f.opened, [
      ['https://example.test/page?x=1&y=2'],
      ['devtools://devtools/bundled/inspector.html?ws=localhost:1234/devtools/page/synthetic-page', 'devtools'],
    ])
  })
}
