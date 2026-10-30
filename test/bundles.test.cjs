const assert = require('node:assert/strict')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')

// Load both production modules: the shared shell framing and registered IPC
// handler remain real. Only HDC transport, online metadata and Electron are mocked.
async function loadBundles(entries, online = async (name) => ({ data: { name: `Label ${name}`, icon: `icon:${name}` } }), labels = {}, install = async () => {}, options = {}) {
  const handlers = new Map(), logs = [], commands = [], lookups = [], events = []
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) =>
    [level, (...args) => logs.push({ level, args })]))
  let base
  const modules = new Map()
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const module = { exports: {} }
    const { code } = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' })
    vm.runInNewContext(code, { module, exports: module.exports, Buffer, setTimeout: options.setTimeout || setTimeout, clearTimeout, AbortController, Date: options.Date || Date,
      require(id) {
        if (id.startsWith('node:')) return require(id)
        if (id === './base') return base
        if (id === './onlineBundleInfo') return load('src/main/lib/hdc/onlineBundleInfo.ts')
        if (id === 'share/main/lib/window') return { sendAll: (...args) => events.push(args) }
        if (id === 'share/main/lib/util') return { handleEvent: (name, handler) => handlers.set(name, handler) }
        if (id === 'share/common/log') return () => logger
        if (id === 'axios') return { post: async (_url, data, config) => { lookups.push(data.pkgName); return online(data.pkgName, config) } }
        if (id.startsWith('licia/')) return require(id)
        throw new Error(`Unexpected import: ${id}`)
      },
    })
    modules.set(file, module.exports)
    return module.exports
  }
  base = load('src/main/lib/hdc/base.ts')
  const client = { getTarget() { return { install, async shell(command) {
    commands.push(command)
    if (command === 'bm dump -h') {
      if (labels.help instanceof Error) throw labels.help
      return { readAll: async () => Buffer.from(labels.help ?? 'usage: bm dump\n  -n, --bundle-name <bundle-name>') }
    }
    if (command.endsWith(' -l')) {
      const value = labels[command.slice('bm dump -n '.length, -3)]
      if (value instanceof Error) throw value
      return { readAll: async () => Buffer.from(value ?? 'error: label unavailable') }
    }
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
  return { getInfos: async (names) => JSON.parse(JSON.stringify(await handlers.get('getBundleInfos')('DEVICE_TEST', names))), logs, commands, lookups, events, install: hap => handlers.get('installBundle')('DEVICE_TEST', hap) }
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
    if (name === 'first') throw Object.assign(new Error('not listed'), { response: { status: 404 } })
    return { data: { name: 'Last label', icon: 'last-icon' } }
  })
  const result = await getInfos(['first', 'last'])
  assert.deepEqual(result.map((x) => [x.bundleName, x.label, x.icon]), [['first', 'first', ''], ['last', 'Last label', 'last-icon']])
  assert.ok(logs.some(({ level, args }) => level === 'warn' && args.includes('first')))
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

const labelHelp = 'usage: bm dump <options>\n  -l, --label                          list the label info'

test('literal device label wins over the store name while keeping the store icon', async () => {
  const d = info('personal'); d.applicationInfo.label = '  个人工具  '
  const { getInfos, commands } = await loadBundles({ personal: dump('personal', d) })
  const [result] = await getInfos(['personal'])
  assert.equal(result.label, '个人工具')
  assert.equal(result.icon, 'icon:personal')
  assert.deepEqual(commands, ['bm dump -n personal'])
})

test('resource labels resolve on the device even for vendor-prefixed sideloads and system apps', async () => {
  const names = ['personal', 'com.huawei.personal', 'system']
  const entries = Object.fromEntries(names.map((name) => {
    const d = info(name); d.applicationInfo.label = '$string:app_name'
    d.applicationInfo.isSystemApp = name === 'system'
    return [name, dump(name, d)]
  }))
  const { getInfos, commands } = await loadBundles(entries, async () => { throw new Error('offline') },
    { help: labelHelp, personal: '个人工具\r\n', 'com.huawei.personal': '侧载工具', system: '设置' })
  const result = await getInfos(names)
  assert.deepEqual(result.map(x => [x.bundleName, x.label, x.icon]),
    [['personal', '个人工具', ''], ['com.huawei.personal', '侧载工具', ''], ['system', '设置', '']])
  assert.equal(commands.filter(c => c === 'bm dump -h').length, 1)
})

test('a label command failure preserves that bundle and resolves the following bundle', async () => {
  const { getInfos, logs } = await loadBundles({ first: dump('first'), last: dump('last') }, undefined,
    { help: labelHelp, first: new Error('disconnected'), last: '本地名称' })
  assert.deepEqual((await getInfos(['first', 'last'])).map(x => [x.bundleName, x.label]),
    [['first', 'Label first'], ['last', '本地名称']])
  assert.ok(diagnostic(logs, 'first'))
})

for (const invalid of ['', '$string:name', 'error: failed to get information', 'usage: bm dump <options>', 'line one\nline two']) {
  test(`invalid label command response falls back without exposing diagnostics: ${JSON.stringify(invalid)}`, async () => {
    const { getInfos, logs } = await loadBundles({ app: dump('app') }, undefined, { help: labelHelp, app: invalid })
    assert.equal((await getInfos(['app']))[0].label, 'Label app')
    assert.ok(diagnostic(logs, 'app'))
  })
}

test('old bm without label support retains the original store fallback', async () => {
  const d = info('app'); d.applicationInfo.label = '$string:app_name'
  const { getInfos, commands } = await loadBundles({ app: dump('app', d) })
  assert.equal((await getInfos(['app']))[0].label, 'Label app')
  assert.ok(commands.includes('bm dump -h'))
  assert.ok(!commands.includes('bm dump -n app -l'))
})

test('capability errors do not drop apps and are retried after reconnect on the next request', async () => {
  const labels = { help: new Error('disconnected'), app: '恢复后的名称' }
  const { getInfos, logs } = await loadBundles({ app: dump('app') }, undefined, labels)
  assert.equal((await getInfos(['app']))[0].label, 'Label app')
  assert.ok(logs.some(({ args }) => args.includes('DEVICE_TEST') && args.some(x => x instanceof Error)))
  labels.help = labelHelp
  assert.equal((await getInfos(['app']))[0].label, '恢复后的名称')
})

test('refresh reads changed local names rather than caching them across reinstalls or locale changes', async () => {
  const labels = { help: labelHelp, app: '旧名称' }
  const { getInfos } = await loadBundles({ app: dump('app') }, undefined, labels)
  assert.equal((await getInfos(['app']))[0].label, '旧名称')
  labels.app = '新名称'
  assert.equal((await getInfos(['app']))[0].label, '新名称')
})

test('malformed literal label still allows device label resolution', async () => {
  const d = info('app'); d.applicationInfo.label = { invalid: true }
  const { getInfos } = await loadBundles({ app: dump('app', d) }, undefined, { help: labelHelp, app: '有效名称' })
  assert.equal((await getInfos(['app']))[0].label, '有效名称')
})

test('a local label equal to the bundle name still takes priority over the store', async () => {
  const d = info('app'); d.applicationInfo.label = 'app'
  const { getInfos } = await loadBundles({ app: dump('app', d) })
  const [result] = await getInfos(['app'])
  assert.equal(result.label, 'app')
  assert.equal(result.icon, 'icon:app')
})


test('successful installation broadcasts to application lists; rejected installation does not', async () => {
  const good = await loadBundles({})
  await good.install('fixture.hap')
  assert.deepEqual(good.events, [['bundleInstalled', 'DEVICE_TEST']])
  const bad = await loadBundles({}, undefined, {}, async () => { throw Error('signature mismatch') })
  await assert.rejects(bad.install('fixture.hap'), /signature mismatch/)
  assert.deepEqual(bad.events, [])
})

test('a silent store is aborted once and the whole batch returns device metadata', async () => {
  let request
  const f = await loadBundles({ first: dump('first'), last: dump('last') }, (_name, config) => {
    request = config
    return new Promise(() => {})
  }, {}, undefined, { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)) })
  const result = await Promise.race([f.getInfos(['first', 'last']), new Promise(resolve => setTimeout(() => resolve('still waiting'), 200))])
  assert.notEqual(result, 'still waiting', 'optional metadata cannot hold the app list indefinitely')
  assert.deepEqual(result.map(x => [x.bundleName, x.label, x.versionName]), [['first', 'first', '1.0'], ['last', 'last', '1.0']])
  assert.deepEqual(f.lookups, ['first'], 'offline batches cannot pay a deadline per application')
  assert.equal(request.signal.aborted, true, 'cancel the underlying request, not just the caller wait')
  assert.ok(request.timeout > 0 && request.timeout <= 3000)
})

test('concurrent refreshes share one request for the same store metadata', async () => {
  let release
  const response = new Promise(resolve => { release = resolve })
  const f = await loadBundles({ app: dump('app') }, () => response)
  const first = f.getInfos(['app']), second = f.getInfos(['app'])
  await new Promise(resolve => setImmediate(resolve))
  release({ data: { name: 'Store name', icon: 'https://example.test/icon.png' } })
  assert.deepEqual(await first, await second)
  assert.deepEqual(f.lookups, ['app'])
})

test('network failures cool down across apps and refreshes, then recover without restarting', async () => {
  let now = 1000, online = false
  class Clock extends Date { static now() { return now } }
  const failure = Object.assign(new Error('private-proxy-secret'), { code: 'ETIMEDOUT', request: { secret: 'private-proxy-secret' } })
  const f = await loadBundles({ first: dump('first'), last: dump('last') }, async () => {
    if (!online) throw failure
    return { data: { name: 'Recovered name' } }
  }, {}, undefined, { Date: Clock })
  assert.equal((await f.getInfos(['first', 'last'])).length, 2)
  await f.getInfos(['first', 'last'])
  assert.deepEqual(f.lookups, ['first'])
  assert.equal(JSON.stringify(f.logs).includes('private-proxy-secret'), false)
  assert.equal(f.logs.filter(x => x.level === 'warn').length, 1)
  online = true; now += 30001
  assert.equal((await f.getInfos(['last']))[0].label, 'Recovered name')
  assert.deepEqual(f.lookups, ['first', 'last'])
})

test('an app absent from the store is cached without disabling other apps', async () => {
  const f = await loadBundles({ absent: dump('absent'), good: dump('good') }, async name => {
    if (name === 'absent') throw Object.assign(new Error('not found'), { response: { status: 404 } })
    return { data: { name: 'Available app' } }
  })
  const infos = await f.getInfos(['absent', 'good'])
  assert.deepEqual(infos.map(x => x.label), ['absent', 'Available app'])
  await f.getInfos(['absent', 'good'])
  assert.deepEqual(f.lookups, ['absent', 'good'])
})

test('store payload fields cannot replace local strings with objects', async () => {
  const f = await loadBundles({ app: dump('app') }, async () => ({ data: { name: { text: 'name' }, icon: ['image'] } }))
  const [app] = await f.getInfos(['app'])
  assert.equal(app.label, 'app')
  assert.equal(app.icon, '')
})

test('different concurrent app batches share the offline cooldown', async () => {
  const f = await loadBundles({ first: dump('first'), last: dump('last') }, () => new Promise(() => {}),
    {}, undefined, { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)) })
  const [first, last] = await Promise.all([f.getInfos(['first']), f.getInfos(['last'])])
  assert.equal(first[0].label, 'first')
  assert.equal(last[0].label, 'last')
  assert.equal(f.lookups.length, 1)
})

test('a cached successful entry remains usable while another request fails', async () => {
  const f = await loadBundles({ known: dump('known'), offline: dump('offline') }, async name => {
    if (name === 'offline') throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' })
    return { data: { name: 'Cached name' } }
  })
  await f.getInfos(['known'])
  await f.getInfos(['offline'])
  assert.equal((await f.getInfos(['known']))[0].label, 'Cached name')
  assert.deepEqual(f.lookups, ['known', 'offline'])
})

test('late timed-out replies cannot poison the metadata cache', async () => {
  let now = 1000, finish
  class Clock extends Date { static now() { return now } }
  const f = await loadBundles({ app: dump('app') }, () => new Promise(resolve => { finish = resolve }),
    {}, undefined, { Date: Clock, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)) })
  assert.equal((await f.getInfos(['app']))[0].label, 'app')
  finish({ data: { name: 'Late obsolete name' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await f.getInfos(['app']))[0].label, 'app')
  now += 30001
  const retry = f.getInfos(['app'])
  await new Promise(resolve => setImmediate(resolve))
  finish({ data: { name: 'Current name' } })
  assert.equal((await retry)[0].label, 'Current name')
})

test('unlisted app metadata expires so a later store listing can be discovered', async () => {
  let now = 1000, listed = false
  class Clock extends Date { static now() { return now } }
  const f = await loadBundles({ app: dump('app') }, async () => ({ data: listed ? { name: 'Now listed' } : {} }),
    {}, undefined, { Date: Clock })
  assert.equal((await f.getInfos(['app']))[0].label, 'app')
  listed = true
  assert.equal((await f.getInfos(['app']))[0].label, 'app')
  now += 300001
  assert.equal((await f.getInfos(['app']))[0].label, 'Now listed')
})
