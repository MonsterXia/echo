const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const { execFileSync } = require('node:child_process')
const manifest = require('../vendor/native-video/manifest.json')
const { screencastMain } = require('./helpers/screencast-main.cjs')
const file = path.resolve(__dirname, '../src/main/lib/hdc/nativeVideo.ts')
const mod = new Module(file, module)
mod._compile(buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, file)
const name = 'scrcpy_harmony_0123456789abcdef.so'
const command = `uitest start-daemon singleness --extension-name ${name} -scale 1 -frameRate 120 -bitRate 8 -p 5011 -iFrameInterval 1000 -repeatInterval 100`
const unixHeader = 'Num RefCount Protocol Flags Type St Inode Path'
const tcpHeader = '  sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode'
const stat = started => `123 (xdevice_scrcpy) S ${'0 '.repeat(18)}${started} 0`
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

function fixture(change = {}) {
  const state = {
    running: true, command, hash: manifest.libraries[1].sha256, started: '456',
    unix: `${unixHeader}\n0: 00000002 0 10000 1 1 888 @scrcpy_grpc_socket`,
    tcp: tcpHeader + '\n 0: 00000000:1F4C 00000000:0000 0A 0:0 0:0 0 2000 0 999',
    tcp6: tcpHeader, ...change,
  }
  const native = new mod.exports.NativeVideo({ port: 8710, connectKey: 'synthetic' })
  const calls = []
  let kills = 0, removed = false
  native.run = async args => {
    calls.push(args)
    assert.equal(args[0], 'shell', 'cross-host cleanup cannot remove another host forward')
    const cmd = args[1]
    if (cmd.includes('kill -9')) {
      if (state.signalDelay) await new Promise(resolve => setTimeout(resolve, 50))
      // Execute the real final guard. Only device files and the signal are fake.
      const current = { ...state, ...state.atKill }
      const prelude = `
flock() { return ${current.lockBusy ? 1 : 0}; }
sleep() { :; }
ps() { printf '%s\\n' ${quote('UID PID PPID C STIME TTY TIME CMD\n' + (current.running ? 'shell 123 1 0 00:00 ? 00:00 ' + current.command : ''))}; }
sha256sum() { printf '%s\\n' ${quote(current.hash + '  /data/local/tmp/' + name)}; }
cat() { case "$1" in
/proc/123/stat) printf '%s\\n' ${quote(stat(current.started))};;
/proc/net/unix) printf '%s\\n' ${quote(current.unix)};;
/proc/net/tcp) printf '%s\\n' ${quote(current.tcp)};;
/proc/net/tcp6) printf '%s\\n' ${quote(current.tcp6)};;
*) return 1;; esac; }
kill() { printf 'WOULD_KILL:%s\\n' "$*"; }
`
      const shell = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/sh'
      const output = execFileSync(shell, ['-c', prelude + cmd.replace('/data/local/tmp/scrcpy_harmony_recovery.lock', '/dev/null')], { encoding: 'utf8', timeout: 5000 })
      if (/CROSS_HOST_(ALREADY_GONE|SKIPPED)/.test(output)) return output.trim()
      assert.match(output, /WOULD_KILL:-9 123/)
      kills++; state.running = false
      return output.replace('WOULD_KILL:-9 123\n', '').trim()
    }
    if (cmd.startsWith('ps -ef')) return 'UID PID PPID C STIME TTY TIME CMD\n' +
      (state.running ? `shell 123 1 0 00:00 ? 00:00 ${state.command}\n` : '') + 'CROSS_HOST_READ_COMPLETE'
    if (cmd === 'cat /proc/123/stat') return stat(state.started)
    if (cmd.startsWith('sha256sum')) return state.hash + '  /data/local/tmp/' + name
    for (const table of ['unix', 'tcp', 'tcp6']) {
      if (cmd.startsWith(`cat /proc/net/${table} `)) return (table === 'unix' && !state.running ? unixHeader : state[table]) + '\nCROSS_HOST_READ_COMPLETE'
    }
    if (cmd === 'rm -f /data/local/tmp/' + name) { removed = true; return '' }
    if (cmd === `test ! -e /data/local/tmp/${name} && echo removed`) return removed ? 'removed' : ''
    throw Error('Unexpected command: ' + cmd)
  }
  return { native, state, calls, kills: () => kills, removed: () => removed }
}

test('foreground recovers an idle known extension without any desktop journal', async () => {
  const f = fixture()
  await f.native.recoverOrphans(true)
  assert.equal(f.kills(), 1)
  assert.equal(f.removed(), true)
  await f.native.recoverOrphans(true)
  assert.equal(f.kills(), 1, 'repeated recovery must be idempotent')
})

test('HarmonyOS Proto/State socket headers support the same guarded recovery', async () => {
  const f = fixture({ unix: 'Num RefCount Proto  Flags Type State Inode Path\n0: 00000002 0 10000 1 1 888 @scrcpy_grpc_socket' })
  await f.native.recoverOrphans(true)
  assert.equal(f.kills(), 1)
  assert.equal(f.removed(), true)
})

test('concurrent foreground callers share one cross-host cleanup', async () => {
  const f = fixture({ signalDelay: true })
  await Promise.all([f.native.recoverOrphans(true), f.native.recoverOrphans(true)])
  assert.equal(f.kills(), 1)
})

test('background/local-only recovery does not inspect or stop cross-host sessions', async () => {
  const f = fixture()
  await f.native.recoverOrphans()
  assert.equal(f.calls.length, 0)
})

for (const failure of ['unix-denied', 'unix-malformed', 'tcp6-denied', 'ps-malformed', 'second-inspection']) {
  test(`optional cross-host inspection failure preserves healthy control/JPEG: ${failure}`, async () => {
    const f = fixture(), h = screencastMain()
    const run = f.native.run
    let unixReads = 0, queries = 0
    f.native.run = async args => {
      if (args[1].startsWith('cat /proc/net/unix ')) {
        unixReads++
        if (failure === 'unix-denied' || (failure === 'second-inspection' && unixReads === 2)) throw Error('permission denied')
        if (failure === 'unix-malformed') return 'incomplete socket table'
      }
      if (failure === 'tcp6-denied' && args[1].startsWith('cat /proc/net/tcp6 ')) throw Error('permission denied')
      if (failure === 'ps-malformed' && args[1].startsWith('ps -ef')) return 'incomplete process table'
      return run(args)
    }
    h.driver.nativeVideo = f.native
    h.driver.getDisplaySize = async () => { queries++; return { width: 100, height: 200 } }
    await h.driver.initializeControl()
    assert.equal(queries, 1, 'a read-only recovery check cannot block healthy control')
    assert.equal(f.kills(), 0)
    assert.equal(f.removed(), false)
  })
}

test('cross-host failures after signalling still block initialization until cleanup is confirmed', async () => {
  const f = fixture(), h = screencastMain()
  const run = f.native.run
  f.native.run = args => args[1].startsWith('ps -ef') && !f.state.running
    ? Promise.reject(Error('post-stop inspection failed')) : run(args)
  h.driver.nativeVideo = f.native
  h.driver.getDisplaySize = async () => { assert.fail('must not use an unconfirmed cleanup') }
  await assert.rejects(h.driver.initializeControl(), /post-stop inspection failed/)
  assert.equal(f.kills(), 1)
  assert.equal(f.removed(), false)
})

test('cold startup with no native listener does not require process or TCP inventories', async () => {
  const f = fixture({ running: false }), h = screencastMain()
  h.driver.nativeVideo = f.native
  await h.driver.initializeControl()
  assert.equal(f.calls.length, 1)
  assert.match(f.calls[0][1], /^cat \/proc\/net\/unix /)
})

test('foreground preserves its own standby and another living local journal owner', async () => {
  const f = fixture()
  f.native.name = name
  await f.native.recoverOrphans(true)
  assert.equal(f.calls.length, 0)
  f.native.name = undefined
  f.native.ownership = { async recover() {}, async hasForeignRecords() { return true } }
  await f.native.recoverOrphans(true)
  assert.equal(f.calls.length, 0)
})

test('a client appearing during the idle observation interval prevents cleanup', async t => {
  const f = fixture()
  const timer = setTimeout(() => { f.state.unix += '\n0: 3 0 0 1 3 889 @scrcpy_grpc_socket' }, 100)
  t.after(() => clearTimeout(timer))
  await f.native.recoverOrphans(true)
  assert.equal(f.kills(), 0)
})

for (const change of [
  { hash: 'f'.repeat(64) },
  { command: command.replace(name, 'other_tool.so') },
  { unix: `${unixHeader}\n0: 2 0 10000 1 1 888 @scrcpy_grpc_socket\n0: 3 0 0 1 3 889 @scrcpy_grpc_socket` },
  { tcp: `${tcpHeader}\n0: 00000000:1F4C 0100007F:ABCD 01 0:0 0:0 0 2000 0 999` },
  { tcp6: `${tcpHeader}\n0: 00000000000000000000000000000000:1F4C 00000000000000000000000001000000:ABCD 01 0:0 0:0 0 2000 0 999` },
  { unix: unixHeader + '\ntruncated row' },
  { tcp: `${tcpHeader}\n0: 00000000:ABCD 0100007F:1F4C 02 0:0 0:0 0 2000 0 999` },
  { tcp6: 'Permission denied' },
  { tcp: `${tcpHeader}\n0: 00000000:1F4C 0100007F:ABCD FF 0:0 0:0 0 2000 0 999` },
]) test(`unknown or active service is not reclaimed: ${JSON.stringify(change)}`, async () => {
  const f = fixture(change)
  await f.native.recoverOrphans(true).catch(() => {})
  assert.equal(f.kills(), 0)
  assert.equal(f.removed(), false)
})

for (const atKill of [
  { started: '999' }, { command: command.replace(name, 'other_tool.so') }, { hash: 'f'.repeat(64) },
  { unix: `${unixHeader}\n0: 2 0 10000 1 1 888 @scrcpy_grpc_socket\n0: 3 0 0 1 3 889 @scrcpy_grpc_socket` },
  { unix: `${unixHeader}\n0: 2 0 10000 1 1 999 @scrcpy_grpc_socket` },
  { tcp6: `${tcpHeader}\n0: 00000000000000000000000000000000:1F4C 00000000000000000000000001000000:ABCD 01 0:0 0:0 0 2000 0 999` },
  { unix: unixHeader + '\ntruncated row' },
  { tcp6: 'Permission denied' },
  { tcp: `${tcpHeader}\n0: 00000000:1F4C 0100007F:ABCD FF 0:0 0:0 0 2000 0 999` },
]) test(`final device shell refuses state changed after inspection: ${JSON.stringify(atKill)}`, async () => {
  const f = fixture({ atKill })
  await assert.rejects(f.native.recoverOrphans(true))
  assert.equal(f.kills(), 0)
  assert.equal(f.removed(), false)
})

// Separate NativeVideo instances represent hosts without a shared in-memory task.
test('two independent hosts tolerate a candidate removed by the first recovery', async () => {
  const f = fixture({ signalDelay: true })
  const other = new mod.exports.NativeVideo({ port: 8711, connectKey: 'synthetic-other' })
  other.run = f.native.run
  await Promise.all([f.native.recoverOrphans(true), other.recoverOrphans(true)])
  assert.equal(f.kills(), 1)
  assert.equal(f.removed(), true)
})

test('a competing recovery removing the candidate before the final guard is successful', async () => {
  const f = fixture({ atKill: { running: false } })
  await f.native.recoverOrphans(true)
  assert.equal(f.kills(), 0)
  assert.equal(f.removed(), false, 'the other recovery owns cleanup')
})

test('a busy device recovery lock cannot signal or delete a candidate', async () => {
  const f = fixture({ lockBusy: true })
  await f.native.recoverOrphans(true)
  assert.equal(f.kills(), 0)
  assert.equal(f.removed(), false)
})
