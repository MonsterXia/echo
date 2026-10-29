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

test('durable ownership is saved before forwarding and cleared only after device cleanup', async () => {
  const f = await fixture({ firstFails: false })
  const history = []
  const run = f.native.run
  f.native.run = async args => {
    history.push(args.join(' '))
    if (args[1] === 'cat /proc/123/stat') return `123 (xdevice_scrcpy) S ${'0 '.repeat(18)}456 0`
    return run(args)
  }
  f.native.ownership = {
    save: async record => history.push({ ...record }),
    clear: async name => history.push({ clear: name }),
  }
  await f.native.prepare(1)
  const records = history.filter(item => typeof item === 'object')
  assert.equal(records[0].devicePid, '123'); assert.equal(records[0].started, '456')
  assert.equal(typeof records[1].port, 'number')
  assert.ok(history.indexOf(records[1]) < history.findIndex(x => typeof x === 'string' && x.startsWith('fport tcp:')))
  await f.native.stop()
  assert.ok(history.findIndex(x => typeof x === 'object' && x.clear) > history.findIndex(x => typeof x === 'string' && x.includes('test ! -e')))
})

for (const scenario of ['same', 'replaced', 'unknown']) {
  test(`stale ownership recovery validates the remote process (${scenario})`, async () => {
    const f = await fixture({ firstFails: false })
    const name = 'scrcpy_harmony_0123456789abcdef.so'
    const record = { name, hostPid: 99999, devicePid: '123', started: '456' }
    let exists = true, killed = false, removed = false
    f.native.ownership = { recover: async cleanup => cleanup(record) }
    f.native.run = async args => {
      const cmd = args[1]
      if (cmd === 'ps -ef && echo NATIVE_READ_COMPLETE') return scenario === 'unknown' ? 'permission denied' :
        `UID PID PPID C STIME TTY TIME CMD\n${exists ? `shell 123 1 0 00:00 ? 00:00 uitest start-daemon singleness --extension-name ${name} -scale 1\n` : ''}NATIVE_READ_COMPLETE`
      if (cmd === 'cat /proc/123/stat') return `123 (xdevice_scrcpy) S ${'0 '.repeat(18)}${scenario === 'replaced' ? '789' : '456'} 0`
      if (cmd.includes('kill -9')) { assert.match(cmd, /\[ "\$1" = "456" \]/); killed = true; exists = false; return 'stopped' }
      if (cmd.startsWith('rm -f')) { removed = true; return '' }
      if (cmd.startsWith('test ! -e')) return 'removed'
      throw Error('Unexpected command: '+cmd)
    }
    if (scenario === 'same') {
      await f.native.recoverOrphans(); assert.equal(killed, true); assert.equal(removed, true)
    } else {
      await assert.rejects(f.native.recoverOrphans(), /changed|inventory unconfirmed/)
      assert.equal(killed, false); assert.equal(removed, false)
    }
  })
}

for (const occupied of [false, true, 'empty', 'partial', 'malformed']) {
  test(`orphan forward cleanup refuses another active capture (occupied=${occupied})`, async () => {
    const f = await fixture({ firstFails: false })
    const name = 'scrcpy_harmony_0123456789abcdef.so'
    let removed = false
    f.native.ownership = { recover: async cleanup => cleanup({ name, hostPid: 99999, devicePid: '123', started: '456', port: 12345 }) }
    f.native.run = async args => {
      if (args.join(' ') === 'fport ls') return 'synthetic tcp:12345 localabstract:scrcpy_grpc_socket [Forward]'
      if (args[0] === 'fport' && args[1] === 'rm') { removed = true; return '' }
      if (args[1] === 'ps -ef && echo NATIVE_READ_COMPLETE') return 'UID PID PPID C STIME TTY TIME CMD\nNATIVE_READ_COMPLETE'
      if (args[1] === 'cat /proc/net/unix && echo NATIVE_SOCKET_READ_COMPLETE') {
        if (occupied === 'empty') return ''
        if (occupied === 'partial') return 'Num RefCount Protocol Flags Type St Inode Path'
        if (occupied === 'malformed') return 'Num RefCount Protocol Flags Type St Inode Path\nerror\nNATIVE_SOCKET_READ_COMPLETE'
        return 'Num RefCount Protocol Flags Type St Inode Path\n' + (occupied ? '1: 2 0 10000 1 01 123 @scrcpy_grpc_socket\n' : '') + 'NATIVE_SOCKET_READ_COMPLETE'
      }
      if (args[1].startsWith('rm -f')) return ''
      if (args[1].startsWith('test ! -e')) return 'removed'
      throw Error('Unexpected command: '+args.join(' '))
    }
    if (occupied) await assert.rejects(f.native.recoverOrphans(), /possibly reused forward|socket inventory unconfirmed/)
    else await f.native.recoverOrphans()
    assert.equal(removed, !occupied)
  })
}
