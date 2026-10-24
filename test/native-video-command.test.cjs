const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { build } = require('esbuild')
const { promisify } = require('node:util')
async function fixture() {
  const file = path.resolve(__dirname, '../src/main/lib/hdc/nativeVideo.ts')
  const output = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  let response = { stdout: '', stderr: '' }
  const execute = () => {}
  execute[promisify.custom] = async () => response
  const compiled = new Module(file, module)
  compiled.require = id => id === 'node:child_process' ? { execFile: execute } : module.require(id)
  compiled._compile(output.outputFiles[0].text, file)
  const native = new compiled.exports.NativeVideo({ port: 8710, connectKey: 'synthetic' })
  return { native, set: value => { response = { stdout: '', stderr: '', ...value } } }
}
test('HDC error replies on stdout or stderr cannot release native cleanup ownership', async () => {
  const f = await fixture()
  f.native.name = 'scrcpy_harmony_0123456789abcdef.so'
  for (const reply of [{ stdout: '[E000004] device is not ready' }, { stderr: 'error: device disconnected' }, { stdout: '' }]) {
    f.set(reply)
    await assert.rejects(f.native.stop(), /failed|inventory/)
    assert.equal(f.native.name, 'scrcpy_harmony_0123456789abcdef.so')
  }
})
test('native file ownership is retained until absence is explicitly confirmed', async () => {
  const f = await fixture()
  f.native.name = 'scrcpy_harmony_0123456789abcdef.so'
  let removed = false
  f.native.run = async args => {
    if (args[1] === 'ps -ef') return 'UID PID PPID C STIME TTY TIME CMD'
    if (args[1]?.startsWith('test ! -e')) return removed ? 'removed' : ''
    return ''
  }
  await assert.rejects(f.native.stop(), /file removal/)
  assert.ok(f.native.name)
  removed = true
  await f.native.stop()
  assert.equal(f.native.name, undefined)
})
