const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

const code = transformSync(fs.readFileSync(require.resolve('../src/renderer/screencast/store.ts'), 'utf8'), {
  loader: 'ts', format: 'cjs',
}).code

async function load(saved) {
  const writes = []
  let starts = 0, clients = 0
  let ready
  const initialized = new Promise(resolve => { ready = resolve })
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(id) {
      if (id === 'share/renderer/store/BaseStore') return class {}
      if (id === './lib/ScreencastClient') return class {
        constructor() { clients++; ready() }
        start() { starts++ }
      }
      if (id === 'mobx') return require('mobx')
      throw Error(id)
    },
    main: {
      on() {},
      getScreencastStore: async key => key === 'scale' ? saved : false,
      getMainStore: async () => ({ key: 'synthetic' }),
      setScreencastStore: (...args) => writes.push(args),
    },
  })
  await initialized
  return { store: module.exports.default, writes, get starts() { return starts }, get clients() { return clients } }
}

test('saved legacy ratios load into an available quality without restarting capture', async () => {
  for (const [saved, expected] of [[0.5, 0.5], [0.6, 0.5], [0.7, 1], [0.8, 1], [0.9, 1], [1, 1]]) {
    const f = await load(saved)
    assert.equal(f.store.scale, expected, `saved ${saved}`)
    assert.equal(f.clients, 1)
    assert.equal(f.starts, 0)
    assert.deepEqual(f.writes, [])
  }
})

test('missing or invalid saved quality defaults to original', async () => {
  for (const saved of [undefined, null, 0, -1, 2, NaN, '0.5']) {
    assert.equal((await load(saved)).store.scale, 1)
  }
})

test('quality changes restart once and persist canonical values; same quality is a no-op', async () => {
  const f = await load(0.9)
  f.store.setScale(1)
  assert.equal(f.starts, 0)
  f.store.setScale(0.5)
  assert.equal(f.starts, 1)
  f.store.setScale(0.6)
  assert.equal(f.starts, 1)
  f.store.setScale(1)
  assert.equal(f.starts, 2)
  assert.deepEqual(f.writes, [['scale', 0.5], ['scale', 1]])
})
