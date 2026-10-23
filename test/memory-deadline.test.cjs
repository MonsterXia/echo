const assert = require('node:assert/strict')
const { test } = require('node:test')
const { fixture, outcome, bounded, frame, load, KEY, READY, MEMORY, INFO, KERNEL, SCREEN } = require('./helpers/overview-fixture.cjs')

test('overview routes memory and screen through finite transport and retains memory/overview fields', async (t) => {
  const f = await fixture(t)
  const result = await f.overview()
  assert.equal(result.memTotal, 8388608)
  assert.equal(result.memUsed, 5242880)
  assert.equal(result.name, 'Synthetic')
  assert.equal(result.kernelVersion, 'Linux synthetic ')
  assert.equal(result.physicalResolution, '1080x1920')
  assert.equal(f.clients.filter((s) => s.kind === 'finite').length, 10)
  assert.deepEqual(f.state.deadlines, [10000, 15000, 10000, 10000, 15000])
  assert.equal(f.initOptions[0].host, '127.0.0.1')
  assert.equal(f.initOptions[0].port, 8710)
  assert.deepEqual(f.state.requests, [READY, 'shell param get', READY, INFO, READY, KERNEL, READY, MEMORY, READY, SCREEN])
  await f.input()
  assert.deepEqual(f.state.requests.slice(-2), [READY, 'shell uinput -K -d 3 -u 3'])
  assert.equal(f.clients.filter((s) => s.kind === 'finite').length, 10)
})

for (const [envPort, expectedPort] of [
  ['18710', 18710], [' 23456 ', 23456], ['23456suffix', 23456],
  ['', 8710], ['not-a-port', 8710], ['   ', 8710],
]) {
  test(`real factory and finite memory share env port ${JSON.stringify(envPort)}`, async (t) => {
    const f = await fixture(t, { envPort, expectedPort })
    assert.equal((await f.overview()).memTotal, 8388608)
    assert.equal(f.initOptions[0].port, expectedPort)
    assert.equal(f.clients.filter((s) => s.kind === 'finite').length, 10)
  })
}

for (const envPort of ['0', '-1', '65536']) {
  test(`invalid numeric env port ${envPort} rejects before any connection`, async (t) => {
    await assert.rejects(fixture(t, { envPort }), /Invalid OHOS_HDC_SERVER_PORT/)
  })
}

for (const [mem, total, used] of [
  ['MemTotal: 8192 kB\nMemFree: 1024 kB\n', 8388608, 7340032],
  ['MemTotal: 8192 kB\nMemAvailable: 0 kB\n', 8388608, 8388608],
  ['unrelated field\n', 0, 0],
]) {
  test(`memory parser preserves compatibility: ${JSON.stringify(mem)}`, async (t) => {
    const f = await fixture(t); f.state.mem = mem
    const result = await f.overview()
    assert.equal(result.memTotal, total); assert.equal(result.memUsed, used)
  })
}

for (const phase of ['handshake', 'ready', 'read']) {
  test(`overview rejects stalled memory ${phase}, closes sockets, ignores late output and recovers`, { timeout: 4000 }, async (t) => {
    const f = await fixture(t); f.state.stall = phase
    const result = await bounded(outcome(f.overview()))
    assert.equal(result.error?.code, 'HDC_COMMAND_TIMEOUT')
    assert.equal(result.error.stage, phase)
    assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
    assert.equal(f.state.requests.includes(SCREEN), false)
    assert.equal(f.state.requests.filter((x) => x === MEMORY).length, phase === 'read' ? 1 : 0)
    const count = f.clients.length
    f.peers.at(-1).end(frame('MemTotal: 100 kB\nMemFree: 50 kB\n'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(f.clients.length, count, 'no retry after timeout')
    f.state.stall = ''
    assert.equal((await f.overview()).memTotal, 8388608)
  })
}

for (const mode of ['reset', 'truncated']) {
  test(`memory ${mode} rejects overview without retry or fallback`, async (t) => {
    const f = await fixture(t); f.state.stall = mode
    const result = await outcome(f.overview())
    assert.equal(result.error?.code, mode === 'reset' ? 'ECONNRESET' : 'HDC_COMMAND_PROTOCOL')
    assert.equal(f.state.requests.filter((x) => x === MEMORY).length, 1)
    assert.equal(f.state.requests.includes(SCREEN), false)
    assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
  })
}

for (const text of ['[Fail] cat denied', '[E000001] failed', 'error: failed']) {
  test(`explicit memory command failure rejects overview: ${text}`, async (t) => {
    const f = await fixture(t); f.state.mem = text
    const result = await outcome(f.overview())
    assert.match(result.error?.message ?? '', /memory command failed/)
    assert.equal(f.state.requests.includes(SCREEN), false)
    assert.equal(f.state.requests.filter((x) => x === MEMORY).length, 1)
  })
}

test('production ten-second memory deadline expires on the real clock', { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { wallClock: true }); f.state.stall = 'read'
  const started = performance.now()
  const result = await bounded(outcome(f.overview()), 12000)
  const elapsed = performance.now() - started
  assert.equal(result.error?.code, 'HDC_COMMAND_TIMEOUT')
  assert.ok(elapsed >= 9900 && elapsed < 12000, `elapsed ${elapsed}`)
  assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
})

test('real memory timeout clears Overview details and permits UI retry', { timeout: 5000 }, async (t) => {
  const { JSDOM } = require('jsdom'), React = require('react')
  const { act } = React, h = React.createElement, Empty = () => null
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  global.window = dom.window; global.document = dom.window.document
  global.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const f = await fixture(t), notifications = []
  let pending
  const main = { getOverview() { pending = outcome(f.overview()); return pending.then(({ value, error }) => { if (error) throw error; return value }) } }
  const Component = load('src/renderer/main/components/overview/Overview.tsx', {
    './Overview.module.scss': {},
    '../../store': { target: { key: KEY, ohosVersion: '6.0', sdkVersion: '20' } },
    'common/util': { t: (key) => key },
    'share/renderer/lib/util': { notify: (...args) => notifications.push(args) },
    'share/renderer/components/ToolbarIcon': ({ icon, onClick, disabled }) => h('button', { 'data-action': icon, onClick, disabled }),
    'luna-toolbar/react': { __esModule: true, default: ({ children }) => h('div', null, children), LunaToolbarSpace: Empty },
    '../common/loading': { PannelLoading: () => h('div', { 'data-loading': true }) },
    './PortMappingModal': Empty, './RemoteControllerModal': Empty,
  }, { main }).default
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); delete global.window; delete global.document; delete global.IS_REACT_ACT_ENVIRONMENT })
  const button = () => container.querySelector('[data-action="refresh"]')
  await act(async () => root.render(h(Component)))
  await act(async () => { await pending })
  assert.ok(container.textContent.includes('Synthetic'))
  f.state.stall = 'read'
  await act(async () => button().click())
  assert.equal(button().disabled, true)
  await act(async () => { assert.equal((await pending).error?.code, 'HDC_COMMAND_TIMEOUT') })
  assert.equal(container.textContent.includes('Synthetic'), false)
  assert.equal(container.querySelector('[data-loading]'), null)
  assert.equal(button().disabled, false)
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0][1].icon, 'error')
  f.state.stall = ''
  await act(async () => button().click())
  await act(async () => { await pending })
  assert.ok(container.textContent.includes('Synthetic'))
  assert.equal(button().disabled, false)
  assert.equal(notifications.length, 1)
})
