const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const vm = require('node:vm')
const { buildSync } = require('esbuild')

const code = buildSync({
  entryPoints: [path.resolve(__dirname, '../vendor/packages/hdckit/src/hdc/command/install.ts')],
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false,
}).outputFiles[0].text
function load(exec) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => name === 'execa' ? exec : require(name) })
  return module.exports.InstallCommand
}

test('installation requests replacement without uninstalling, preserving a spaced HAP path as one argument', async () => {
  const calls = []
  const Install = load(async (bin, args) => {
    calls.push({ bin, args: Array.from(args) })
    return { stdout: '[Info]App install path:fixture msg:install bundle successfully.\nAppMod finish', stderr: '' }
  })
  await new Install('device-fixture', '/fixture/hdc').execute('signed app/test.hap')
  assert.deepEqual(calls, [{ bin: '/fixture/hdc', args: ['-t', 'device-fixture', 'install', '-r', path.resolve('signed app/test.hap')] }])
})

test('a device rejection with exit zero is still an install failure', async () => {
  const Install = load(async () => ({ stdout: 'error: signature verification failed', stderr: '' }))
  await assert.rejects(new Install('fixture').execute('test.hap'), /signature verification failed/)
})

test('a process failure is not reported as installation success', async () => {
  const Install = load(async () => { throw new Error('hdc process failed') })
  await assert.rejects(new Install('fixture').execute('test.hap'), /hdc process failed/)
})

for (const reject of [false, true]) test(`uppercase HAP is staged with a supported extension and cleaned after ${reject ? 'failure' : 'success'}`, async () => {
  const fs = require('node:fs/promises'), os = require('node:os')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uppercase-hap-test-'))
  const original = path.join(dir, 'hello & spaced.HAP')
  await fs.writeFile(original, 'fixture bytes')
  let staged
  try {
    const Install = load(async (_bin, args) => {
      staged = args.at(-1)
      assert.ok(staged.endsWith('.hap'), 'native HDC ignores uppercase extensions')
      assert.notEqual(staged, original)
      assert.equal(await fs.readFile(staged, 'utf8'), 'fixture bytes')
      if (reject) throw Error('device rejected')
      return { stdout: 'install bundle successfully', stderr: '' }
    })
    const result = new Install('fixture').execute(original)
    if (reject) await assert.rejects(result, /device rejected/)
    else await result
    await assert.rejects(fs.stat(staged), { code: 'ENOENT' })
    assert.equal(await fs.readFile(original, 'utf8'), 'fixture bytes')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
