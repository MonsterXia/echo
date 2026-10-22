const assert = require('node:assert/strict')
const { test } = require('node:test')
const Emitter = require('licia/Emitter')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Real hilog handlers, Hilog, base PID parsing/cache and Licia emitters.
// Only HDC transport and Electron/logging boundaries are replaced. Awaiting
// the reader callbacks exposes rejected async listeners as test failures.
async function harness() {
  const handlers = new Map(), sent = [], logs = [], readers = [], lookups = []
  let base
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level =>
    [level, (...args) => logs.push({ level, args })]))
  function load(file) {
    const module = { exports: {} }
    const { code } = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' })
    vm.runInNewContext(code, { module, exports: module.exports, Buffer,
      require(id) {
        if (id === './base') return base
        if (id === 'share/main/lib/util') return { handleEvent: (name, fn) => handlers.set(name, fn) }
        if (id === 'share/main/lib/window') return { sendTo: (...args) => sent.push(args) }
        if (id === 'share/common/log') return () => logger
        if (id.startsWith('licia/')) return require(id)
        throw new Error(`Unexpected import: ${id}`)
      },
    })
    return module.exports
  }
  const client = { getTarget(key) {
    assert.equal(key, 'synthetic-target')
    return {
      async openHilog(options) {
        assert.equal(options.clear, true)
        const reader = new Emitter()
        reader.endCalls = 0
        reader.end = () => { reader.endCalls++ }
        reader.entry = entry => Promise.all([...(reader._events.entry || [])].map(fn => fn(entry)))
        readers.push(reader)
        return reader
      },
      async shell(command) {
        assert.equal(command, 'top -b -n 1 -o pid -o %cpu -o time+ -o res -o user -o name -o args')
        const lookup = lookups.shift()
        assert.ok(lookup, 'Unexpected PID lookup')
        lookup.started.resolve()
        return { readAll: () => lookup.result.promise }
      },
    }
  } }
  base = load('src/main/lib/hdc/base.ts')
  await base.init(client)
  load('src/main/lib/hdc/hilog.ts').init(client)
  return {
    sent, logs, readers,
    open: () => handlers.get('openHilog')('synthetic-target'),
    pause: id => handlers.get('pauseHilog')(id),
    resume: id => handlers.get('resumeHilog')(id),
    close: id => handlers.get('closeHilog')(id),
    cache: () => base.getTargetStore('synthetic-target', 'pidNames'),
    lookup() {
      const lookup = { started: deferred(), result: deferred() }
      lookups.push(lookup)
      return {
        started: lookup.started.promise,
        resolve: (name = 'synthetic.app') => lookup.result.resolve(Buffer.from(
          `PID %CPU TIME+ RES USER NAME ARGS\n42 0 0:00 1M test ${name} synthetic-command`)),
        reject: error => lookup.result.reject(error),
      }
    },
  }
}

function entry(message, pid = 42) {
  return { date: new Date('2026-10-22T00:00:00Z'), pid, tid: 7, level: 4,
    type: 0, domain: '00000', tag: 'synthetic', message }
}

test('active HiLog preserves IPC payload, cached PID names and PID zero fallback', async () => {
  const h = await harness(), id = await h.open(), reader = h.readers[0]
  const query = h.lookup(), first = entry('first')
  const pending = reader.entry(first)
  await query.started
  query.resolve()
  await pending
  await reader.entry(entry('cached'))
  await reader.entry(entry('system', 0))
  assert.deepEqual(h.sent.map(([win, channel, stream, data]) =>
    [win, channel, stream, data.message, data.bundleName]), [
    ['main', 'hilogEntry', id, 'first', 'synthetic.app'],
    ['main', 'hilogEntry', id, 'cached', 'synthetic.app'],
    ['main', 'hilogEntry', id, 'system', 'pid-0'],
  ])
  assert.equal(h.sent[0][3], first)
  await h.close(id)
})

test('pause drops a pending PID lookup result and records arriving while paused', async () => {
  const h = await harness(), id = await h.open(), reader = h.readers[0]
  const query = h.lookup(), pending = reader.entry(entry('before pause'))
  await query.started
  await h.pause(id)
  await reader.entry(entry('while paused', 0))
  query.resolve('stale.app')
  await pending
  assert.deepEqual(h.sent, [])
  assert.equal(h.cache(), undefined, 'invalidated lookup must not publish stale cache')
  await h.close(id)
})

test('pause then resume cannot revive an old callback, while new records recover', async () => {
  const h = await harness(), id = await h.open(), reader = h.readers[0]
  const query = h.lookup(), old = reader.entry(entry('old'))
  await query.started
  await h.pause(id)
  await h.resume(id)
  query.resolve('stale.app')
  await old
  assert.deepEqual(h.sent, [])
  assert.equal(h.cache(), undefined)
  const next = h.lookup(), current = reader.entry(entry('new'))
  await next.started
  next.resolve('current.app')
  await current
  assert.deepEqual(h.sent.map(args => [args[3].message, args[3].bundleName]), [['new', 'current.app']])
  await h.close(id)
})

test('close suppresses pending output, detaches the listener and tolerates late control IPC', async () => {
  const h = await harness(), id = await h.open(), reader = h.readers[0]
  const query = h.lookup(), pending = reader.entry(entry('before close'))
  await query.started
  await h.close(id)
  query.resolve()
  await pending
  await reader.entry(entry('after close', 0))
  assert.deepEqual(h.sent, [])
  assert.equal(reader._events.entry.length, 0)
  assert.equal(reader.endCalls, 1)
  await assert.doesNotReject(h.pause(id))
  await assert.doesNotReject(h.resume(id))
  await assert.doesNotReject(h.close(id))
  assert.equal(reader.endCalls, 1)
})

test('PID lookup rejection falls back for the current entry and a later lookup recovers', async () => {
  const h = await harness(), id = await h.open(), reader = h.readers[0]
  const query = h.lookup(), pending = reader.entry(entry('fallback'))
  await query.started
  query.reject(new Error('synthetic PID lookup failure'))
  await assert.doesNotReject(pending)
  assert.equal(h.cache(), undefined)
  assert.equal(h.sent[0][3].bundleName, 'pid-42')
  assert.ok(h.logs.some(({ level }) => level === 'warn'))
  const next = h.lookup(), recovered = reader.entry(entry('recovered'))
  await next.started
  next.resolve('recovered.app')
  await recovered
  assert.deepEqual(h.sent.map(args => [args[3].message, args[3].bundleName]), [
    ['fallback', 'pid-42'], ['recovered', 'recovered.app'],
  ])
  await h.close(id)
})

for (const transition of ['pause', 'close', 'pause-resume']) {
  test(`PID rejection after ${transition} is handled without publishing a stale entry`, async () => {
    const h = await harness(), id = await h.open(), reader = h.readers[0]
    const query = h.lookup(), pending = reader.entry(entry('obsolete failure'))
    await query.started
    if (transition === 'close') await h.close(id)
    else {
      await h.pause(id)
      if (transition === 'pause-resume') await h.resume(id)
    }
    query.reject(new Error('synthetic late lookup failure'))
    await assert.doesNotReject(pending)
    assert.deepEqual(h.sent, [])
    if (transition !== 'close') await h.close(id)
  })
}

test('repeated resume does not invalidate active work', async () => {
  const h = await harness(), id = await h.open(), reader = h.readers[0]
  const query = h.lookup(), pending = reader.entry(entry('active'))
  await query.started
  await h.resume(id)
  await h.resume(id)
  query.resolve()
  await pending
  assert.equal(h.sent.length, 1)
  await h.close(id)
})

test('closing one stream does not suppress another sharing the same pending PID lookup', async () => {
  const h = await harness(), first = await h.open(), second = await h.open()
  const query = h.lookup(), old = h.readers[0].entry(entry('closed'))
  await query.started
  const current = h.readers[1].entry(entry('remaining'))
  await h.close(first)
  query.resolve()
  await Promise.all([old, current])
  assert.deepEqual(h.sent.map(args => [args[2], args[3].message]), [[second, 'remaining']])
  await h.close(second)
})
