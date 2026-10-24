const fs = require('node:fs/promises')
const original = '/data/local/tmp/libscreen_casting.z.so'

// A journal is written before renaming the original, so the supervising
// process can restore it even if Electron is forcibly terminated.
exports.recoverProbeBackup = async function (journal, run) {
  const record = JSON.parse(await fs.readFile(journal, 'utf8'))
  if (!/^\/data\/local\/tmp\/scrcpy_harmony_backup_[a-f0-9]{16}\.so$/.test(record.backup) ||
      !/^[a-f0-9]{64}$/.test(record.hash) || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535 ||
      typeof record.connectKey !== 'string' || !record.connectKey || /[\r\n\0]/.test(record.connectKey)) throw new Error('Invalid native backup recovery journal')
  const command = async text => String(await run(text, record)).trim()
  if (await command(`test -f ${record.backup} && echo present`) === 'present') {
    if ((await command(`sha256sum ${record.backup}`)).split(/\s+/)[0] !== record.hash) throw new Error('Backup integrity check failed')
    if (await command(`test ! -e ${original} && echo absent`) !== 'absent') throw new Error('Original library path occupied during restore')
    await command(`mv ${record.backup} ${original}`)
  }
  if ((await command(`sha256sum ${original}`)).split(/\s+/)[0] !== record.hash) throw new Error('Original library restore hash mismatch')
  await fs.unlink(journal)
}
