const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const original = '/data/local/tmp/libscreen_casting.z.so'
const record = { backup: '/data/local/tmp/scrcpy_harmony_backup_0123456789abcdef.so', hash: 'a'.repeat(64), port: 8710, connectKey: 'synthetic' }
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-backup-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'recovery.json')
}
test('parent can restore a journaled library after a child is forcibly timed out', async t => {
  const { recoverProbeBackup } = require('../script/lib/probe-backup.cjs')
  const journal = fixture(t)
  const child = spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1], ${JSON.stringify(JSON.stringify(record))}); setInterval(()=>{},1000)`, journal], { timeout: 1000, windowsHide: true })
  assert.equal(child.error?.code, 'ETIMEDOUT')
  let restored = false
  await recoverProbeBackup(journal, async command => {
    if (command === `test -f ${record.backup} && echo present`) return 'present'
    if (command.startsWith('sha256sum')) return record.hash + ' file'
    if (command === `test ! -e ${original} && echo absent`) return 'absent'
    if (command === `mv ${record.backup} ${original}`) { restored = true; return '' }
    throw new Error('Unexpected recovery command')
  })
  assert.equal(restored, true)
  assert.equal(fs.existsSync(journal), false)
})
test('failed recovery preserves journal and never overwrites an occupied original path', async t => {
  const { recoverProbeBackup } = require('../script/lib/probe-backup.cjs')
  const journal = fixture(t)
  fs.writeFileSync(journal, JSON.stringify(record))
  await assert.rejects(recoverProbeBackup(journal, async () => { throw new Error('device offline') }), /offline/)
  assert.equal(fs.existsSync(journal), true)
  const calls = []
  await assert.rejects(recoverProbeBackup(journal, async command => {
    calls.push(command)
    return command.startsWith('test -f') ? 'present' : command.startsWith('sha256sum') ? record.hash : 'occupied'
  }), /occupied/)
  assert.equal(calls.some(c => c.startsWith('mv ')), false)
  assert.equal(fs.existsSync(journal), true)
})
