const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
async function fixture({ hashFails = false, firstFails = true } = {}) {
  const file = path.resolve(__dirname, '../src/main/lib/hdc/nativeVideo.ts')
  const output = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  const compiled = new Module(file, module); compiled._compile(output.outputFiles[0].text, file)
  const native = new compiled.exports.NativeVideo({ port: 8710, connectKey: 'synthetic', resourcesDir: 'fixture' })
  const libraries = ['newest.so', 'compatible.so'].map(file => ({ file, path: path.resolve('fixture with spaces', file), sha256: 'a'.repeat(64) }))
  native.candidates = async () => libraries.slice().sort((a, b) => Number(b.file === native.preferred) - Number(a.file === native.preferred))
  const calls = []
  let selected, running = false, attempted = false, launch
  native.run = async args => {
    calls.push(args.slice())
    if (args[0] === 'file') { selected = path.basename(args[2]); return 'FileTransfer finish' }
    if (args[0] === 'fport') return 'OK'
    const command = args[1]
    if (command.startsWith('sha256sum')) return (hashFails ? 'b' : 'a').repeat(64) + ' file'
    if (command === 'cat /proc/net/unix') return running ? '@scrcpy_grpc_socket' : ''
    if (command.startsWith('uitest start-daemon')) {
      launch = command; running = true
      if (firstFails && selected === 'newest.so') { attempted = true; throw new Error('incompatible extension') }
    }
    if (command === 'ps -ef') return `UID PID PPID C STIME TTY TIME CMD\n${running ? `shell 123 1 ${launch}` : ''}`
    if (command.startsWith('test ! -e')) return 'removed'
    if (command === 'kill -9 123') running = false
    return ''
  }
  native.openStream = async receive => { receive({ data: Buffer.from([1]), timestamp: 1, keyFrame: true }); return { stop: async () => {} } }
  return { native, calls, libraries, attempted: () => attempted }
}
test('cold device deploys candidates without reading preinstalled library and cleans failed attempt before retry', async () => {
  const f = await fixture()
  assert.equal(await f.native.start(0.5, () => {}, () => {}), true)
  assert.equal(f.attempted(), true)
  const uploads = f.calls.filter(args => args[0] === 'file')
  assert.equal(uploads.length, 2)
  assert.notEqual(uploads[0][3], uploads[1][3])
  const firstRemoval = f.calls.findIndex(args => args[1] === `rm -f ${uploads[0][3]}`)
  assert.ok(firstRemoval >= 0 && firstRemoval < f.calls.indexOf(uploads[1]))
  assert.equal(f.calls.some(args => args.join(' ').includes('/libscreen_casting.z.so')), false)
  await f.native.stop()
  assert.equal(f.native.name, undefined)
  f.calls.length = 0
  assert.equal(await f.native.start(0.5, () => {}, () => {}), true)
  assert.equal(f.calls.filter(args => args[0] === 'file').length, 1)
  assert.match(f.calls.find(args => args[0] === 'file')[2], /compatible\.so$/)
  await f.native.stop()
})
test('remote digest mismatch never executes uploaded code and removes all session files', async () => {
  const f = await fixture({ hashFails: true })
  assert.equal(await f.native.start(0.5, () => {}, () => {}), false)
  assert.equal(f.calls.some(args => args[1]?.startsWith('uitest start-daemon')), false)
  assert.equal(f.calls.filter(args => args[1]?.startsWith('rm -f')).length, 2)
  assert.equal(f.native.name, undefined)
})

for (const prepared of [false, true]) {
  test(`a silent first frame does not invalidate compatibility or probe every library (prepared=${prepared})`, async () => {
    const f = await fixture({ firstFails: false })
    f.native.preferred = 'newest.so'
    let clears = 0
    f.native.preference = { clear: async () => clears++, save: async () => {} }
    if (prepared) await f.native.prepare(1)
    f.native.openStream = async () => {
      const error = new Error('Native video first frame timeout')
      error.name = 'NativeVideoFirstFrameTimeout'
      throw error
    }
    assert.equal(await f.native.start(1, () => {}, () => {}), false)
    assert.equal(f.calls.filter(args => args[0] === 'file').length, 1)
    assert.equal(clears, 0, 'an idle display is not evidence of library incompatibility')
    assert.equal(f.native.name, undefined, 'cleanup still confirms release')
  })
}
test('candidate cleanup failure blocks another deployment', async () => {
  const f = await fixture()
  const original = f.native.run
  f.native.run = args => args[1]?.startsWith('kill -9') ? Promise.reject(new Error('cleanup denied')) : original(args)
  await assert.rejects(f.native.start(0.5, () => {}, () => {}), /cleanup denied/)
  assert.equal(f.calls.filter(args => args[0] === 'file').length, 1)
  assert.ok(f.native.name)
})

test('an extension that exits without a socket is rejected without exhausting readiness polls', async () => {
  const f = await fixture({ firstFails: false })
  const original = f.native.run
  let uploads = 0, probes = 0, firstCleaned = false
  f.native.run = async args => {
    if (args[0] === 'file') uploads++
    if (uploads === 1 && args[1]?.startsWith('rm -f')) firstCleaned = true
    if (uploads === 1 && args[1] === 'cat /proc/net/unix') {
      if (!firstCleaned) probes++
      return ''
    }
    if (uploads === 1 && args[1] === 'ps -ef') return 'UID PID PPID C STIME TTY TIME CMD'
    return original(args)
  }
  assert.equal(await f.native.start(1, () => {}, () => {}), true)
  assert.ok(probes <= 3, `dead extension was polled ${probes} times`)
  assert.equal(uploads, 2)
  await f.native.stop()
})

test('a failed preferred library clears its hint, probes alternatives, and remembers only a live stream', async () => {
  const f = await fixture()
  const saved = []
  let cleared = 0
  f.native.preferred = 'newest.so'
  f.native.preference = { clear: async () => cleared++, save: async file => saved.push(file) }
  assert.equal(await f.native.start(1, () => {}, () => {}), true)
  assert.equal(cleared, 1)
  assert.deepEqual(saved, ['compatible.so'])
  await f.native.stop()
})

test('slow live extensions retain the readiness window instead of being mistaken for exited candidates', async () => {
  const f = await fixture({ firstFails: false })
  const original = f.native.run
  let launched = false, probes = 0
  f.native.run = async args => {
    if (args[1]?.startsWith('uitest start-daemon')) launched = true
    if (launched && args[1] === 'cat /proc/net/unix' && ++probes < 5) return ''
    return original(args)
  }
  assert.equal(await f.native.start(1, () => {}, () => {}), true)
  assert.equal(f.calls.filter(args => args[0] === 'file').length, 1)
  await f.native.stop()
})

test('preparation finds a listening extension without requesting screen frames; start adopts it', async () => {
  const f = await fixture()
  let streams = 0, saves = 0
  const open = f.native.openStream
  f.native.openStream = async (...args) => { streams++; return open(...args) }
  f.native.preference = { save: async () => saves++, clear: async () => {} }
  assert.equal(await f.native.prepare(1), true)
  assert.equal(streams, 0)
  assert.equal(saves, 0, 'listening alone is not a persisted successful stream')
  const uploads = f.calls.filter(args => args[0] === 'file').length
  assert.equal(await f.native.start(1, () => {}, () => {}), true)
  assert.equal(f.calls.filter(args => args[0] === 'file').length, uploads)
  assert.equal(streams, 1)
  assert.equal(saves, 1)
  await f.native.stop()
})

test('cancelled preparation cleans its copy without opening a stream or trying another candidate', async () => {
  const f = await fixture({ firstFails: false })
  let valid = true
  const original = f.native.run
  f.native.run = async args => {
    const result = await original(args)
    if (args[0] === 'file') valid = false
    return result
  }
  f.native.openStream = () => { throw new Error('Background capture forbidden') }
  assert.equal(await f.native.prepare(1, () => valid), false)
  assert.equal(f.calls.filter(args => args[0] === 'file').length, 1)
  assert.equal(f.calls.some(args => args[1]?.startsWith('uitest start-daemon')), false)
  assert.equal(f.native.name, undefined)
})

test('scale changes retire a prepared daemon before deploying the requested size', async () => {
  const f = await fixture({ firstFails: false })
  await f.native.prepare(1)
  const name = f.native.name
  await f.native.start(0.5, () => {}, () => {})
  assert.notEqual(f.native.name, name)
  assert.equal(f.calls.filter(args => args[0] === 'file').length, 2)
  assert.ok(f.calls.some(args => args[1] === `rm -f /data/local/tmp/${name}`))
  await f.native.stop()
})

test('a stale prepared forward cannot start a stream belonging to a different socket owner', async () => {
  const f = await fixture({ firstFails: false })
  await f.native.prepare(1)
  const original = f.native.run
  f.native.run = args => args[1] === 'ps -ef'
    ? Promise.resolve('UID PID PPID C STIME TTY TIME CMD') : original(args)
  let streams = 0
  f.native.openStream = async () => { streams++; throw new Error('Must not contact an unowned service') }
  assert.equal(await f.native.start(1, () => {}, () => {}), false)
  assert.equal(streams, 0)
  assert.equal(f.calls.some(args => args[1]?.startsWith('kill -9')), false)
})

for (const prepareOnly of [false, true]) {
  test(`a competing socket after failed launch cannot be adopted (prepare=${prepareOnly})`, async () => {
    const f = await fixture({ firstFails: false })
    const original = f.native.run
    let launched = false, starts = 0, stops = 0
    f.native.run = async args => {
      if (args[1]?.startsWith('uitest start-daemon')) launched = true
      // The launcher succeeded, but our extension died. The fixed socket is
      // now supplied by another tool that started after our initial preflight.
      if (launched && args[1] === 'ps -ef') return 'UID PID PPID C STIME TTY TIME CMD'
      return original(args)
    }
    f.native.openStream = async () => { starts++; return { stop: async () => stops++ } }
    assert.equal(await (prepareOnly ? f.native.prepare(1) : f.native.start(1, () => {}, () => {})), false)
    await f.native.stop()
    assert.equal(starts, 0)
    assert.equal(stops, 0)
    assert.equal(f.calls.filter(args => args[0] === 'file').length, 1, 'do not launch another candidate over the competitor')
    assert.equal(f.calls.some(args => args[1]?.startsWith('kill -9')), false)
  })
}

test('cold activation rechecks its process after forwarding before sending onStart', async () => {
  const f = await fixture({ firstFails: false })
  const original = f.native.run
  let lost = false, streams = 0
  f.native.run = async args => {
    if (args[0] === 'fport' && args[1].startsWith('tcp:')) lost = true
    if (lost && args[1] === 'ps -ef') return 'UID PID PPID C STIME TTY TIME CMD'
    return original(args)
  }
  f.native.openStream = async () => { streams++; return { stop: async () => {} } }
  assert.equal(await f.native.start(1, () => {}, () => {}), false)
  assert.equal(streams, 0)
  assert.equal(f.calls.some(args => args[1]?.startsWith('kill -9')), false)
})
