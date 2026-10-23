const assert = require('node:assert/strict')
const { test } = require('node:test')
const vm = require('node:vm')
const path = require('node:path')
const { build } = require('esbuild')
const { captureHandlers } = require('./helpers/capture-handlers.cjs')

// Bundle the real client, loadImage and Readiness. Only Electron, DOM decoding
// and time are controlled; frames enter through the registered bridge listener.
const bundle = build({
  entryPoints: [
    path.resolve(
      __dirname,
      '../src/renderer/screencast/lib/ScreencastClient.ts',
    ),
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'store-boundary',
      setup(build) {
        build.onLoad({ filter: /screencast[/\\]store\.ts$/ }, () => ({
          contents: 'export default globalThis.testStore',
          loader: 'js',
        }))
      },
    },
  ],
})

const flush = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function fixture(t, bridge = {}) {
  const calls = [],
    errors = [],
    images = [],
    painted = []
  const listeners = new Set(),
    urls = new Set(),
    timers = new Map()
  const pointerListeners = new Map()
  let now = 0,
    sessionCounter = 0,
    timerId = 0,
    urlId = 0,
    registrations = 0
  const canvas = {
    width: 300,
    height: 150,
    getContext: () => ({
      clearRect() {},
      drawImage: (img) => painted.push(img),
    }),
    addEventListener: (name, fn) => pointerListeners.set(name, fn),
    removeEventListener: (name, fn) => {
      if (pointerListeners.get(name) === fn) pointerListeners.delete(name)
    },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 200 }),
    focus() {},
  }
  class Image {
    naturalWidth = 100
    naturalHeight = 200
    constructor() {
      images.push(this)
    }
  }
  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    Blob,
    Uint8Array,
    Image,
    AbortController,
    console: { error: (...args) => errors.push(args) },
    URL: {
      createObjectURL: () => {
        const url = `blob:synthetic-${++urlId}`
        urls.add(url)
        return url
      },
      revokeObjectURL: (url) => urls.delete(url),
    },
    setTimeout: (fn, delay) => {
      const id = ++timerId
      timers.set(id, { fn, at: now + delay })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
    document: { createElement: () => canvas },
    testStore: { scale: 1 },
    main: {
      createCaptureSession: async (key) => {
        calls.push('create')
        return bridge.create
          ? bridge.create(key)
          : `client-session-${++sessionCounter}`
      },
      stopCaptureScreen: async (key) => {
        calls.push('stop')
        return bridge.stop?.(key)
      },
      startCaptureScreen: async (key, scale, generation) => {
        calls.push(['start', scale])
        return bridge.start?.(key, scale, generation)
      },
      getDisplaySize: async () => {
        calls.push('size')
        return bridge.size ? bridge.size() : { width: 100, height: 200 }
      },
      on: (name, fn) => {
        assert.equal(name, 'captureScreen')
        registrations++
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      touchDown: () => calls.push('touch'),
      touchMove() {},
      touchUp() {},
    },
  })
  vm.runInContext((await bundle).outputFiles[0].text, context)
  const client = new context.module.exports.default('synthetic-target')
  const clients = [client]
  t.after(async () => {
    for (const instance of clients) instance.destroy()
    await flush()
  })
  return {
    client,
    calls,
    errors,
    images,
    painted,
    listeners,
    urls,
    timers,
    pointerListeners,
    context,
    createClient() {
      const instance = new context.module.exports.default('synthetic-target')
      clients.push(instance)
      return instance
    },
    registrations: () => registrations,
    frame(
      id = clients.at(-1).sessionId,
      generation = clients.at(-1).generation,
    ) {
      for (const fn of listeners) fn(id, generation, new Uint8Array([1, 2, 3]))
    },
    async tick(ms) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.fn()
        }
      }
      await flush()
    },
  }
}

test('destroy cancels retry and unregisters bridge and canvas listeners once', async (t) => {
  const f = await fixture(t)
  await flush()
  f.client.destroy()
  f.client.destroy()
  await flush()
  await f.tick(15000)
  assert.deepEqual(f.calls, ['create', ['start', 1], 'stop'])
  assert.equal(f.listeners.size, 0)
  assert.equal(f.pointerListeners.size, 0)
  assert.equal(f.timers.size, 0)
})

test('destroy during session creation releases the late session without starting', async (t) => {
  const stop = deferred()
  const f = await fixture(t, { create: () => stop.promise })
  await flush()
  f.client.destroy()
  stop.resolve('late-session')
  await flush()
  await f.tick(10000)
  assert.equal(f.calls.filter(Array.isArray).length, 0)
  assert.equal(f.listeners.size, 0)
  assert.equal(f.calls.at(-1), 'stop')
})

test('destroy sends session stop immediately even when start is pending', async (t) => {
  const start = deferred()
  const f = await fixture(t, { start: () => start.promise })
  await flush()
  f.client.destroy()
  await flush()
  const callsBeforeCompletion = f.calls.length
  start.resolve()
  await flush()
  assert.equal(f.calls.length, callsBeforeCompletion)
  assert.equal(f.calls.at(-1), 'stop')
  assert.equal(f.timers.size, 0)
})

test('overlapping starts are serialized and latest scale wins without new listeners', async (t) => {
  const first = deferred()
  let starts = 0
  const f = await fixture(t, {
    start: () => (++starts === 1 ? first.promise : undefined),
  })
  await flush()
  f.context.testStore.scale = 0.5
  const second = f.client.start()
  f.context.testStore.scale = 0.25
  const third = f.client.start()
  await flush()
  assert.equal(starts, 1)
  first.resolve()
  await Promise.all([second, third])
  assert.deepEqual(f.calls, ['create', ['start', 1], ['start', 0.25]])
  assert.equal(f.registrations(), 1)
  assert.equal(f.timers.size, 1)
})

for (const operation of ['start']) {
  test(`${operation} rejection is handled and later retry recovers`, async (t) => {
    const f = await fixture(t)
    await flush()
    const method = `${operation}CaptureScreen`
    const original = f.context.main[method]
    f.context.main[method] = async () => {
      throw new Error('synthetic bridge failure')
    }
    await assert.doesNotReject(() => f.client.start())
    assert.equal(f.errors.length, 1)
    f.context.main[method] = original
    await f.tick(5000)
    assert.deepEqual(f.calls.at(-1), ['start', 1])
    assert.equal(f.registrations(), 1)
  })
}

test('destroy stop rejection is handled without rearming retry', async (t) => {
  const f = await fixture(t)
  await flush()
  f.context.main.stopCaptureScreen = async () => {
    throw new Error('synthetic stop failure')
  }
  await f.client.destroy()
  await flush()
  assert.equal(f.errors.length, 1)
  assert.equal(f.timers.size, 0)
})

test('bad frame releases URL and a later good frame becomes ready', async (t) => {
  const f = await fixture(t)
  await flush()
  f.frame('other-target')
  assert.equal(f.images.length, 0)
  f.frame()
  f.images[0].onerror(new Error('synthetic bad JPEG'))
  await flush()
  assert.equal(f.urls.size, 0)
  f.frame()
  f.images[1].onload()
  await flush()
  await f.client.ready
  assert.equal(f.painted.length, 1)
  assert.equal(f.urls.size, 0)
  assert.equal(f.timers.size, 0)
})

test('destroy during decode releases URL and ignores a late decoder callback', async (t) => {
  const f = await fixture(t)
  await flush()
  f.frame()
  const lateLoad = f.images[0].onload
  f.client.destroy()
  await flush()
  assert.equal(f.urls.size, 0)
  lateLoad()
  await flush()
  assert.equal(f.painted.length, 0)
  assert.equal(f.calls.includes('size'), false)
  assert.equal(f.timers.size, 0)
})

test('destroy during display-size lookup ignores late state and readiness', async (t) => {
  const size = deferred()
  const f = await fixture(t, { size: () => size.promise })
  let ready = false
  f.client.ready.then(() => {
    ready = true
  })
  await flush()
  f.frame()
  f.images[0].onload()
  await flush()
  f.client.destroy()
  size.resolve({ width: 100, height: 200 })
  await flush()
  assert.equal(f.painted.length, 0)
  assert.equal(ready, false)
  assert.equal(f.urls.size, 0)
})

test('display-size rejection drops one frame and permits the next frame', async (t) => {
  let reads = 0
  const f = await fixture(t, {
    size: () => {
      if (++reads === 1) throw new Error('synthetic size failure')
      return { width: 100, height: 200 }
    },
  })
  await flush()
  f.frame()
  f.images[0].onload()
  await flush()
  f.frame()
  f.images[1].onload()
  await flush()
  assert.equal(f.painted.length, 1)
  assert.equal(f.urls.size, 0)
})

test('restart invalidates a pending frame before it can signal readiness', async (t) => {
  const size = deferred()
  let reads = 0
  const f = await fixture(t, {
    size: () => (++reads === 1 ? size.promise : { width: 100, height: 200 }),
  })
  await flush()
  f.frame()
  f.images[0].onload()
  await flush()
  await f.client.start()
  size.resolve({ width: 100, height: 200 })
  await flush()
  assert.equal(f.painted.length, 0)
  f.frame()
  f.images[1].onload()
  await flush()
  assert.equal(f.painted.length, 1)
  assert.equal(f.urls.size, 0)
})

test('failed restart after a ready frame still retries and recovers', async (t) => {
  const f = await fixture(t)
  await flush()
  f.frame()
  f.images[0].onload()
  await f.client.ready
  const original = f.context.main.startCaptureScreen
  f.context.main.startCaptureScreen = async () => {
    throw new Error('synthetic restart failure')
  }
  await f.client.start()
  f.context.main.startCaptureScreen = original
  const before = f.calls.filter(Array.isArray).length
  await f.tick(5000)
  assert.equal(f.calls.filter(Array.isArray).length, before + 1)
  f.frame()
  f.images[1].onload()
  await flush()
  assert.equal(f.painted.length, 2)
  assert.equal(f.timers.size, 0)
})

test('repeated no-frame retries retain one listener and destroy prevents explicit restart', async (t) => {
  const f = await fixture(t)
  await flush()
  for (let attempt = 0; attempt < 3; attempt++) await f.tick(5000)
  assert.equal(f.calls.filter(Array.isArray).length, 4)
  assert.equal(f.registrations(), 1)
  assert.equal(f.listeners.size, 1)
  await f.client.destroy()
  const before = f.calls.length
  await f.client.start()
  await f.tick(15000)
  f.frame()
  assert.equal(f.calls.length, before)
  assert.equal(f.images.length, 0)
  assert.equal(f.timers.size, 0)
})

test('same-target replacement waits for old capture cleanup before starting', async (t) => {
  const pending = deferred()
  let active = false,
    starts = 0
  const handlers = captureHandlers(async (_method, api) => {
    if (api === 'stopCaptureScreen') {
      active = false
    } else if (api === 'startCaptureScreen') {
      if (++starts === 1) await pending.promise
      active = true
    }
    return { sessionId: 'replacement-session' }
  })
  const f = await fixture(t, handlers)
  await flush()
  f.client.destroy()
  const replacement = f.createClient()
  await flush()
  assert.equal(starts, 1)
  pending.resolve()
  await flush()
  f.frame()
  f.images.at(-1).onload()
  await replacement.ready
  assert.equal(active, true)
  assert.equal(starts, 2)
  assert.equal(f.listeners.size, 1)
})

test('old generation frame during restart cannot suppress retry after start failure', async (t) => {
  const f = await fixture(t)
  await flush()
  const stop = deferred()
  const oldGeneration = f.client.generation
  f.context.main.startCaptureScreen = async () => {
    await stop.promise
    throw new Error('synthetic start failure')
  }
  const restart = f.client.start()
  await flush()
  f.frame(f.client.sessionId, oldGeneration)
  f.images.at(-1)?.onload()
  await flush()
  stop.resolve()
  await restart
  assert.equal(f.painted.length, 0)
  assert.equal(f.timers.size, 1)
})

test('destroy retains the synchronous React effect cleanup return contract', async (t) => {
  const f = await fixture(t)
  await flush()
  assert.equal(f.client.destroy(), undefined)
})

test('session creation failure retries without reusing a rejected promise', async (t) => {
  let creates = 0
  const f = await fixture(t, {
    create: async () => {
      if (++creates === 1) throw new Error('document is navigating')
      return 'new-document-session'
    },
  })
  await flush()
  assert.equal(f.errors.length, 1)
  assert.equal(f.calls.filter(Array.isArray).length, 0)
  await f.tick(5000)
  assert.equal(creates, 2)
  assert.deepEqual(f.calls.at(-1), ['start', 1])
})

test('frames must match both the current session and start generation', async (t) => {
  const f = await fixture(t)
  await flush()
  await f.client.start()
  f.frame('old-session', f.client.generation)
  f.frame(f.client.sessionId, f.client.generation - 1)
  assert.equal(f.images.length, 0)
  f.frame()
  f.images[0].onload()
  await f.client.ready
  assert.equal(f.painted.length, 1)
})

test('destroy waits through the main handler for UiDriver startup before final stop', async (t) => {
  const pending = deferred(),
    calls = []
  const handlers = captureHandlers(async (_method, api) => {
    calls.push(api)
    return api === 'startCaptureScreen' ? pending.promise : {}
  })
  const f = await fixture(t, handlers)
  await flush()
  assert.deepEqual(calls, ['stopCaptureScreen', 'startCaptureScreen'])
  f.client.destroy()
  await flush()
  assert.equal(calls.length, 2)
  pending.resolve({ sessionId: 'synthetic-session' })
  await flush()
  assert.deepEqual(calls, [
    'stopCaptureScreen',
    'startCaptureScreen',
    'stopCaptureScreen',
  ])
  handlers.driver.emit('message', 'synthetic-session', Buffer.from([1]))
  assert.equal(handlers.frames.length, 0)
  assert.equal(f.timers.size, 0)
})

test('UiDriver rejection reaches renderer recovery through the main capture handler', async (t) => {
  let starts = 0
  const handlers = captureHandlers(async (_method, api) => {
    if (api === 'startCaptureScreen' && ++starts === 1)
      throw new Error('synthetic transport failure')
    return { sessionId: 'synthetic-session' }
  })
  const f = await fixture(t, handlers)
  await flush()
  assert.equal(f.errors.length, 1)
  assert.equal(f.timers.size, 1)
  await f.tick(5000)
  assert.equal(starts, 2)
  handlers.driver.emit('message', 'synthetic-session', Buffer.from([1]))
  assert.equal(handlers.frames.length, 1)
  f.client.destroy()
  await flush()
  assert.equal(f.timers.size, 0)
})
