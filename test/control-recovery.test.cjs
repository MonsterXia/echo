const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { transformSync } = require('esbuild')
function fixture() {
  const file = path.resolve(__dirname, '../src/main/lib/hdc/controlRecovery.ts')
  const mod = new Module(file, module)
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  mod._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, file)
  let pid = '123', start = '500', peers = false, removed = false, valid = true, socketFailure, processFailure
  const commands = []
  const recovery = new mod.exports.ControlRecovery(async cmd => {
    commands.push(cmd)
    if (cmd.startsWith('ps -ef')) {
      if (processFailure !== undefined) return processFailure
      const output = valid ? 'UID PID PPID C STIME TTY TIME CMD\n' + (removed ? '' : `shell ${pid} 1 0 00:00 ? 00:00:00 uitest start-daemon singleness\nshell 456 1 0 00:00 ? 00:00:00 uitest start-daemon singleness --extension-name other.so`) : '[Fail] offline'
      return output + (cmd.includes('&&') && valid ? '\nCONTROL_READ_COMPLETE\n' : '')
    }
    if (cmd.startsWith('cat /proc/') && cmd.endsWith('/stat')) return `${pid} (uitest) S ${'0 '.repeat(18)}${start} 0 0`
    if (cmd.startsWith('cat /proc/net/tcp')) {
      const header = '  sl local_address rem_address st\n'
      const ipv4 = header + (peers ? ' 0: 00000000:1F4C 0100007F:ABCD 01\n' : ' 0: 00000000:1F4C 00000000:0000 0A\n')
      if (cmd === 'cat /proc/net/tcp /proc/net/tcp6') return ipv4 + (socketFailure ?? header)
      if (cmd.includes('/tcp6') && socketFailure !== undefined) return socketFailure
      return (cmd.includes('/tcp6') ? header : ipv4) + 'CONTROL_READ_COMPLETE\n'
    }
    if (cmd.includes('kill -9')) { removed = true; return 'stopped' }
    throw new Error(`Unexpected command ${cmd}`)
  })
  return { recovery, commands, set: changes => {
    if ('pid' in changes) pid = changes.pid
    if ('start' in changes) start = changes.start
    if ('peers' in changes) peers = changes.peers
    if ('valid' in changes) valid = changes.valid
    if ('removed' in changes) removed = changes.removed
    if ('socketFailure' in changes) socketFailure = changes.socketFailure
    if ('processFailure' in changes) processFailure = changes.processFailure
  } }
}

test('recovery stops only the previously observed control process and confirms its disappearance', async () => {
  const f = fixture()
  await f.recovery.remember()
  await f.recovery.reset()
  const kills = f.commands.filter(cmd => cmd.includes('kill -9'))
  assert.equal(kills.length, 1)
  assert.match(kills[0], /kill -9 123/)
  assert.doesNotMatch(kills[0], /kill -9 456|pidof|killall/)
  assert.ok(f.commands.findLastIndex(cmd => cmd.startsWith('ps -ef')) > f.commands.indexOf(kills[0]))
})
for (const change of [{ pid: '999' }, { start: '999' }, { peers: true }, { valid: false }]) {
  test(`recovery refuses changed or shared device state ${JSON.stringify(change)}`, async () => {
    const f = fixture(); await f.recovery.remember(); f.set(change)
    await assert.rejects(f.recovery.reset())
    assert.equal(f.commands.some(cmd => cmd.includes('kill -9')), false)
  })
}
test('missing old process is confirmed without killing a replacement or requiring a stop reply', async () => {
  const f = fixture(); await f.recovery.remember(); f.set({ removed: true })
  await f.recovery.reset()
  assert.equal(f.commands.some(cmd => cmd.includes('kill -9')), false)
})
test('unrecorded control service cannot be terminated by automatic recovery', async () => {
  const f = fixture()
  await assert.rejects(f.recovery.reset())
  assert.equal(f.commands.some(cmd => cmd.includes('kill -9')), false)
})

for (const socketFailure of [
  'cat: /proc/net/tcp6: Permission denied\n',
  ' sl local_address remote_address st\n',
  ' sl local_address remote_address st\nmalformed peer row\nCONTROL_READ_COMPLETE\n',
]) {
  test(`unconfirmed IPv6 inventory refuses termination: ${socketFailure.split('\n')[0]}`, async () => {
    const f = fixture(); await f.recovery.remember(); f.set({ socketFailure })
    await assert.rejects(f.recovery.reset(), /inventory unconfirmed/)
    assert.equal(f.commands.some(cmd => cmd.includes('kill -9')), false)
  })
}
test('a truncated process listing is not proof that the old daemon has exited', async () => {
  const f = fixture(); await f.recovery.remember()
  f.set({ processFailure: 'UID PID PPID C STIME TTY TIME CMD\n' })
  await assert.rejects(f.recovery.reset(), /inventory unconfirmed/)
  assert.equal(f.commands.some(cmd => cmd.includes('kill -9')), false)
})

for (const state of ['01', '0A']) {
  test(`complete IPv6 inventory distinguishes a peer from a listener (${state})`, async () => {
    const f = fixture(); await f.recovery.remember()
    f.set({ socketFailure: ' sl local_address remote_address st\n' +
      ` 0: 00000000000000000000000001000000:1F4C 00000000000000000000000001000000:ABCD ${state}\nCONTROL_READ_COMPLETE\n` })
    if (state === '01') {
      await assert.rejects(f.recovery.reset(), /another connection/)
      assert.equal(f.commands.some(cmd => cmd.includes('kill -9')), false)
    } else {
      await f.recovery.reset()
      assert.equal(f.commands.filter(cmd => cmd.includes('kill -9')).length, 1)
    }
  })
}
