const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { buildSync } = require('esbuild')
function fixture(ttlMs = 60000) {
  const file = path.resolve('src/main/lib/hdc/captureWarmup.ts')
  const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
  const compiled = new Module(file, module); compiled._compile(code, file)
  const starts = [], stops = [], errors = []
  let prepare = async () => true
  const warmup = new compiled.exports.CaptureWarmup({
    ttlMs,
    prepare: (key, scale, valid) => { starts.push({ key, scale, valid }); return prepare() },
    cancel: async key => { stops.push(key) },
    onError: error => errors.push(error.message),
  })
  return { warmup, starts, stops, errors, prepare: callback => { prepare = callback } }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
test('only the selected online target warms once; repeated inventories and expiry do not loop', async t => {
  const f = fixture(40)
  t.after(() => f.warmup.dispose())
  f.warmup.select('a', 1)
  f.warmup.setTargets(['b'])
  assert.equal(f.starts.length, 0)
  f.warmup.setTargets(['a', 'b'])
  f.warmup.setTargets(['a', 'b'])
  await flush()
  assert.equal(f.starts.length, 1)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.deepEqual(f.stops, ['a'])
  f.warmup.setTargets(['a', 'b'])
  assert.equal(f.starts.length, 1)
})
test('disconnect invalidates a pending warmup; reconnect creates a new generation', async () => {
  const f = fixture()
  let release
  f.prepare(() => new Promise(resolve => { release = resolve }))
  f.warmup.setTargets(['a']); f.warmup.select('a', 1)
  await flush()
  assert.equal(f.starts[0].valid(), true)
  f.warmup.setTargets([])
  assert.equal(f.starts[0].valid(), false)
  release(true)
  await flush()
  f.prepare(async () => true)
  f.warmup.setTargets(['a'])
  await flush()
  assert.equal(f.starts.length, 2)
  assert.equal(f.starts[1].valid(), true)
  await f.warmup.dispose()
  assert.equal(f.starts[1].valid(), false)
})
test('selection changes cancel the old preparation and errors are consumed without automatic retries', async () => {
  const f = fixture()
  f.warmup.setTargets(['a', 'b']); f.warmup.select('a', 1)
  await flush()
  f.prepare(async () => { throw new Error('device gone') })
  f.warmup.select('b', 0.5)
  await flush()
  assert.deepEqual(f.stops, ['a'])
  assert.deepEqual(f.errors, ['device gone'])
  f.warmup.select('b', 0.5); f.warmup.setTargets(['a', 'b'])
  assert.equal(f.starts.length, 2)
  await f.warmup.dispose()
})
test('shutdown waits for a pending preparation and its cancellation', async () => {
  const f = fixture()
  let release
  f.prepare(() => new Promise(resolve => { release = resolve }))
  f.warmup.setTargets(['a']); f.warmup.select('a', 1)
  await flush()
  let done = false
  const disposed = f.warmup.dispose().then(() => { done = true })
  await flush()
  assert.equal(done, false)
  assert.equal(f.starts[0].valid(), false)
  release(true)
  await disposed
  assert.deepEqual(f.stops, ['a'])
  f.warmup.select('a', 1)
  assert.equal(f.starts.length, 1)
})
