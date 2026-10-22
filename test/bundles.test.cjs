const assert = require('node:assert/strict')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')

// Load both production modules: the shared shell framing and registered IPC
// handler remain real. Only HDC transport, online metadata and Electron are mocked.
async function loadBundles(entries, online = async (name) => ({ data: { name: `Label ${name}`, icon: `icon:${name}` } })) {
  const handlers = new Map(), logs = [], commands = [], lookups = []
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) =>
    [level, (...args) => logs.push({ level, args })]))
  let base
  function load(file) {
    const module = { exports: {} }
    const { code } = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' })
    vm.runInNewContext(code, { module, exports: module.exports, Buffer, setTimeout,
      require(id) {
        if (id === './base') return base
        if (id === 'share/main/lib/util') return { handleEvent: (name, handler) => handlers.set(name, handler) }
        if (id === 'share/common/log') return () => logger
        if (id === 'axios') return { post: async (_url, data) => { lookups.push(data.pkgName); return online(data.pkgName) } }
        if (id.startsWith('licia/')) return require(id)
        throw new Error(`Unexpected import: ${id}`)
      },
    })
    return module.exports
  }
  base = load('src/main/lib/hdc/base.ts')
  const client = { getTarget() { return { async shell(command) {
    commands.push(command)
    const responses = command.split('\necho "echo_separator"\n').map((cmd) => {
      const name = cmd.replace(/^bm dump -n /, '')
      const value = entries[name]
      if (value instanceof Error) throw value
      return value ?? 'error: bundle not found'
    })
    return { readAll: async () => Buffer.from(responses.join('\necho_separator\n')) }
  } } } }
  await base.init(client)
  await load('src/main/lib/hdc/bundle.ts').init(client)
  return { getInfos: async (names) => JSON.parse(JSON.stringify(await handlers.get('getBundleInfos')('DEVICE_TEST', names))), logs, commands, lookups }
}
function info(name, version = '1.0') {
  return { name, installTime: 1000, releaseType: 'Release', mainEntry: 'entry',
    hapModuleNames: ['entry'], hapModuleInfos: [{ name: 'entry', mainAbility: 'EntryAbility', abilityInfos: [] }],
    applicationInfo: { bundleName: name, isSystemApp: false, versionName: version, apiTargetVersion: 26, vendor: `vendor:${name}` } }
}
function dump(name, body = info(name)) { return `${name}:\n${JSON.stringify(body)}` }
function diagnostic(logs, name) {
  return logs.some(({ level, args }) => (level === 'warn' || level === 'error') && args.includes(name) && args.includes('DEVICE_TEST'))
}

test('valid dump keeps fields and online metadata associated with its bundle', async () => {
  const { getInfos } = await loadBundles({ good: dump('good') })
  assert.deepEqual(await getInfos(['good']), [{ bundleName: 'good', label: 'Label good', icon: 'icon:good', system: false,
    versionName: '1.0', apiTargetVersion: 26, vendor: 'vendor:good', installTime: 1000, releaseType: 'Release', mainAbility: 'EntryAbility' }])
})

test('mixed command failure, error text, malformed JSON and missing module preserve later bundle identity', async () => {
  const orphan = info('orphan', '2.0'); orphan.hapModuleNames = ['feature']
  const cause = new Error('transport closed')
  const { getInfos, logs, lookups } = await loadBundles({ first: dump('first'), command: cause,
    text: 'error: bundle not found', malformed: 'malformed:\n{broken', orphan: dump('orphan', orphan), last: dump('last', info('last', '9.0')) })
  const result = await getInfos(['first', 'command', 'text', 'malformed', 'orphan', 'last'])
  assert.deepEqual(result.map(({ bundleName, versionName, vendor, label, icon }) =>
    [bundleName, versionName, vendor, label, icon]), [
    ['first', '1.0', 'vendor:first', 'Label first', 'icon:first'],
    ['orphan', '2.0', 'vendor:orphan', 'Label orphan', 'icon:orphan'],
    ['last', '9.0', 'vendor:last', 'Label last', 'icon:last'],
  ])
  assert.equal(result[1].mainAbility, undefined)
  for (const name of ['command', 'text', 'malformed', 'orphan']) assert.ok(diagnostic(logs, name), name)
  assert.ok(logs.some(({ args }) => args.includes(cause)))
  assert.deepEqual(lookups, ['first', 'orphan', 'last'])
})

for (const [label, change] of [
  ['missing module arrays', (d) => { delete d.hapModuleNames; delete d.hapModuleInfos }],
  ['missing indexed module', (d) => { d.hapModuleInfos = [] }],
  ['missing ability list', (d) => { d.hapModuleInfos = [{}] }],
  ['empty ability list', (d) => { d.hapModuleInfos = [{ abilityInfos: [] }] }],
]) test(`incomplete launch metadata: ${label}`, async () => {
  const d = info('orphan'); change(d)
  const { getInfos, logs } = await loadBundles({ orphan: dump('orphan', d), last: dump('last') })
  const result = await getInfos(['orphan', 'last'])
  assert.deepEqual(result.map((x) => x.bundleName), ['orphan', 'last'])
  assert.equal(result[0].mainAbility, undefined)
  assert.ok(diagnostic(logs, 'orphan'))
})

test('first ability remains a fallback when mainAbility is absent', async () => {
  const d = info('fallback'); d.hapModuleInfos = [{ abilityInfos: [{ name: 'FallbackAbility' }] }]
  const { getInfos } = await loadBundles({ fallback: dump('fallback', d) })
  assert.equal((await getInfos(['fallback']))[0].mainAbility, 'FallbackAbility')
})

test('no main entry is a valid non-launchable bundle', async () => {
  const d = info('service'); delete d.mainEntry
  const { getInfos } = await loadBundles({ service: dump('service', d) })
  assert.equal((await getInfos(['service']))[0].mainAbility, undefined)
})

test('shell separator text inside metadata cannot split or misassociate results', async () => {
  const d = info('first'); d.applicationInfo.vendor = 'before echo_separator after'
  const { getInfos } = await loadBundles({ first: dump('first', d), last: dump('last') })
  const result = await getInfos(['first', 'last'])
  assert.deepEqual(result.map((x) => [x.bundleName, x.vendor]), [['first', 'before echo_separator after'], ['last', 'vendor:last']])
})

test('raw JSON and CRLF dumps are accepted', async () => {
  const { getInfos } = await loadBundles({ raw: JSON.stringify(info('raw')), crlf: dump('crlf').replace('\n', '\r\n') })
  assert.deepEqual((await getInfos(['raw', 'crlf'])).map((x) => x.bundleName), ['raw', 'crlf'])
})

for (const [label, value] of [['null', null], ['array', []], ['missing applicationInfo', {}], ['null applicationInfo', { applicationInfo: null }]]) {
  test(`invalid bundle shape is skipped with a diagnostic: ${label}`, async () => {
    const { getInfos, logs } = await loadBundles({ invalid: dump('invalid', value), good: dump('good') })
    assert.deepEqual((await getInfos(['invalid', 'good'])).map((x) => x.bundleName), ['good'])
    assert.ok(diagnostic(logs, 'invalid'))
  })
}

test('a response for another bundle is rejected instead of mislabeled', async () => {
  const { getInfos, logs } = await loadBundles({ wrong: dump('other'), good: dump('good') })
  assert.deepEqual((await getInfos(['wrong', 'good'])).map((x) => x.bundleName), ['good'])
  assert.ok(diagnostic(logs, 'wrong'))
})

test('online lookup failure retains local fields and does not shift later enrichment', async () => {
  const { getInfos, logs } = await loadBundles({ first: dump('first'), last: dump('last') }, async (name) => {
    if (name === 'first') throw new Error('offline')
    return { data: { name: 'Last label', icon: 'last-icon' } }
  })
  const result = await getInfos(['first', 'last'])
  assert.deepEqual(result.map((x) => [x.bundleName, x.label, x.icon]), [['first', 'first', ''], ['last', 'Last label', 'last-icon']])
  assert.ok(diagnostic(logs, 'first'))
})

test('empty input performs no shell or online request', async () => {
  const { getInfos, commands, lookups } = await loadBundles({})
  assert.deepEqual(await getInfos([]), [])
  assert.deepEqual(commands, []); assert.deepEqual(lookups, [])
})

test('all failures return an empty result with per-bundle diagnostics', async () => {
  const { getInfos, logs } = await loadBundles({ first: 'error: missing', last: new Error('transport failed') })
  assert.deepEqual(await getInfos(['first', 'last']), [])
  assert.ok(diagnostic(logs, 'first')); assert.ok(diagnostic(logs, 'last'))
})

test('next refresh reads current state after removal, failure and reinstall', async () => {
  const entries = { app: dump('app') }
  const { getInfos } = await loadBundles(entries)
  assert.equal((await getInfos(['app']))[0].versionName, '1.0')
  delete entries.app
  assert.deepEqual(await getInfos(['app']), [])
  entries.app = dump('app', info('app', '2.0'))
  assert.equal((await getInfos(['app']))[0].versionName, '2.0')
})

test('body identity mismatch is rejected even with the expected header', async () => {
  const d = info('wrong'); d.applicationInfo.bundleName = 'other'
  const { getInfos, logs } = await loadBundles({ wrong: dump('wrong', d), good: dump('good') })
  assert.deepEqual((await getInfos(['wrong', 'good'])).map((x) => x.bundleName), ['good'])
  assert.ok(diagnostic(logs, 'wrong'))
})

test('missing optional display fields retain the IPC field types', async () => {
  const { getInfos } = await loadBundles({ minimal: dump('minimal', { applicationInfo: {} }) })
  assert.deepEqual(await getInfos(['minimal']), [{ bundleName: 'minimal', label: 'Label minimal', icon: 'icon:minimal',
    system: false, versionName: '', apiTargetVersion: 0, vendor: '', installTime: 0, releaseType: '' }])
})
