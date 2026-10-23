const assert = require('node:assert/strict')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')

// Exercise the registered production handler; only HDC/Electron side effects
// are replaced. No device, submodule checkout or Electron runtime is required.
async function loadTargets(client) {
  const handlers = new Map()
  const logs = []
  const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((level) =>
    [level, (...args) => logs.push({ level, args })]))
  const module = { exports: {} }
  const { code } = transformSync(fs.readFileSync('src/main/lib/hdc.ts', 'utf8'), {
    loader: 'ts', format: 'cjs',
  })
  vm.runInNewContext(code, {
    module, exports: module.exports, setTimeout,
    require(id) {
      if (id === 'hdckit') return { createClient: () => ({
        trackTargets: async () => ({ on() {} }), ...client,
      }) }
      if (id === 'electron') return { app: { on() {} } }
      if (id === 'share/main/lib/util') return {
        handleEvent: (name, handler) => handlers.set(name, handler),
        resolveResources: (name) => name,
      }
      if (id === 'share/common/log') return () => logger
      if (id === 'share/main/lib/window') return { sendTo() {} }
      if (id === './store') return { getSettingsStore: () => ({ get: () => '' }) }
      // Projection-only fixture: wire parsing and deadlines run in loopback suites.
      if (id === './hdc/parameters') return { parseTargetParameters: (parameters) => parameters }
      if (id === './hdc/finiteShell') return { runFiniteShell: (key) => client.readParameters(key) }
      if (id.startsWith('./hdc/')) return { init() {} }
      if (id.startsWith('node:') || id.startsWith('licia/') || id === 'fs-extra') return require(id)
      throw new Error(`Unexpected import: ${id}`)
    },
  })
  await module.exports.init()
  logs.length = 0
  return {
    getTargets: async () => JSON.parse(JSON.stringify(await handlers.get('getTargets')())),
    logs,
  }
}

const parameters = (version = 'PSN-AL00 7.0.0.109(SP6C00E105R3P3)') => ({
  'const.product.name': 'nova 15',
  'const.product.software.version': version,
  'const.ohos.apiversion': '26',
})
const clientFor = (entries) => ({
  listTargets: async () => Object.keys(entries),
  async readParameters(key) {
    const entry = entries[key]
    if (entry instanceof Error) throw entry
    return entry
  },
})

test('a failed device does not hide healthy devices or change their order', async () => {
  const error = new Error('device disconnected during parameter read')
  const { getTargets, logs } = await loadTargets(clientFor({
    first: parameters(), broken: error, last: parameters('OpenHarmony 4.1.0(API Version 11 Release)'),
  }))
  assert.deepEqual(await getTargets(), [
    { key: 'first', name: 'nova 15', ohosVersion: '7.0.0.109', sdkVersion: '26' },
    { key: 'last', name: 'nova 15', ohosVersion: '4.1.0', sdkVersion: '26' },
  ])
  assert.ok(logs.some(({ level, args }) => level === 'warn' && args.includes('broken') && args.includes(error)))
})

test('a synchronous parameter read failure is isolated too', async () => {
  const client = clientFor({ good: parameters(), gone: parameters() })
  const lookup = client.readParameters
  client.readParameters = (key) => {
    if (key === 'gone') throw new Error('target disappeared')
    return lookup(key)
  }
  const { getTargets } = await loadTargets(client)
  assert.deepEqual((await getTargets()).map(({ key }) => key), ['good'])
})

for (const [label, input, expected] of [
  ['device prefix and build suffix', 'PSN-AL00 7.0.0.109(SP6C00E105R3P3)', '7.0.0.109'],
  ['prefix without parentheses', 'OpenHarmony 4.1.0', '4.1.0'],
  ['bare version', '5.0.0.22', '5.0.0.22'],
  ['bare version and spaced suffix', '5.0.0.22 (SP35)', '5.0.0.22'],
  ['repeated whitespace', ' \tPSN-AL00   7.0.0.109(SP6) \r\n', '7.0.0.109'],
  ['multiword product prefix', 'HarmonyOS NEXT 6.1.0.117(SP1)', '6.1.0.117'],
  ['missing value', undefined, ''],
  ['null value', null, ''],
  ['non-string value', 123, ''],
  ['blank value', ' \t ', ''],
  ['unrecognized text', 'unknown release', ''],
]) {
  test(`version compatibility: ${label}`, async () => {
    const props = parameters()
    props['const.product.software.version'] = input
    const { getTargets } = await loadTargets(clientFor({ device: props, healthy: parameters() }))
    const targets = await getTargets()
    assert.equal(targets.length, 2, 'Incomplete metadata must not hide connected devices')
    assert.equal(targets[0].ohosVersion, expected)
    assert.equal(targets[1].ohosVersion, '7.0.0.109')
  })
}

test('missing optional metadata preserves a selectable key and string IPC fields', async () => {
  const { getTargets, logs } = await loadTargets(clientFor({ unnamed: {} }))
  assert.deepEqual(await getTargets(), [
    { key: 'unnamed', name: 'unnamed', ohosVersion: '', sdkVersion: '' },
  ])
  assert.ok(logs.some(({ level, args }) => level === 'warn' && args.includes('unnamed')))
})

test('parameter whitespace is removed from the display name and API version', async () => {
  const props = { ...parameters(), 'const.product.name': ' nova 15\n', 'const.ohos.apiversion': '26 ' }
  const { getTargets } = await loadTargets(clientFor({ device: props }))
  assert.deepEqual(await getTargets(), [
    { key: 'device', name: 'nova 15', ohosVersion: '7.0.0.109', sdkVersion: '26' },
  ])
})

test('no connected devices has an informational diagnostic, not a read failure', async () => {
  const { getTargets, logs } = await loadTargets(clientFor({}))
  assert.deepEqual(await getTargets(), [])
  assert.ok(logs.some(({ level }) => level === 'info'))
  assert.ok(!logs.some(({ level }) => level === 'warn' || level === 'error'))
})

test('all failed devices reject with per-device causes and an aggregate diagnostic', async () => {
  const first = new Error('unauthorized')
  const second = new Error('transport closed')
  const { getTargets, logs } = await loadTargets(clientFor({ first, second }))
  await assert.rejects(getTargets(), /No HDC target parameters could be read/)
  for (const [key, error] of [['first', first], ['second', second]]) {
    assert.ok(logs.some(({ level, args }) => level === 'warn' && args.includes(key) && args.includes(error)))
  }
  assert.ok(logs.some(({ level, args }) => level === 'warn' && args.includes(2)))
})

test('list failure rejects with a diagnostic and can recover on the next refresh', async () => {
  const error = new Error('HDC server unavailable')
  let connected = false
  const client = { ...clientFor({ device: parameters() }), listTargets: async () => {
    if (!connected) throw error
    return ['device']
  } }
  const { getTargets, logs } = await loadTargets(client)
  await assert.rejects(getTargets(), /Failed to list HDC targets/)
  assert.ok(logs.some(({ level, args }) => level === 'error' && args.includes(error)))
  connected = true
  assert.deepEqual((await getTargets()).map(({ key }) => key), ['device'])
})

test('disconnect and reconnect do not retain a failed target or stale parameters', async () => {
  const entries = { device: parameters() }
  const { getTargets } = await loadTargets(clientFor(entries))
  assert.equal((await getTargets()).length, 1)
  entries.device = new Error('disconnected')
  await assert.rejects(getTargets(), /No HDC target parameters could be read/)
  delete entries.device
  assert.deepEqual(await getTargets(), [])
  entries.device = parameters('PSN-AL00 7.0.0.110(SP7)')
  assert.equal((await getTargets())[0].ohosVersion, '7.0.0.110')
})
