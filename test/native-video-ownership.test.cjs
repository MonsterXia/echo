const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const { spawn } = require('node:child_process')
const { build } = require('esbuild')
const name = 'scrcpy_harmony_0123456789abcdef.so'
async function fixture(t) {
  const file = path.resolve('src/main/lib/hdc/nativeVideoOwnership.ts')
  const out = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  const mod = new Module(file, module); mod._compile(out.outputFiles[0].text, file)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-ownership-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise(resolve => child.once('exit', resolve))
  const record = { name, hostPid: child.pid, devicePid: '123', started: '456', port: 30000 }
  const journal = new mod.exports.NativeVideoOwnership(dir)
  const put = (value = record, pid = value.hostPid) => fs.writeFile(path.join(dir, `${name}.${pid}.json`), JSON.stringify(value))
  return { journal, put, record, dir, compiled: out.outputFiles[0].text }
}
test('a dead desktop owner can be recovered and its durable record is cleared only after cleanup', async t => {
  const f = await fixture(t); await f.put()
  const cleanups = []
  await f.journal.recover(async record => { cleanups.push(record) })
  assert.deepEqual(cleanups, [f.record]); assert.deepEqual(await fs.readdir(f.dir), [])
})
test('a live desktop owner is never reclaimed', async t => {
  const f = await fixture(t); await f.put({ ...f.record, hostPid: process.pid })
  await f.journal.recover(() => { throw Error('must not reclaim live owner') })
  assert.equal((await fs.readdir(f.dir)).length, 1)
})
test('failed cleanup retains a claimed record and can be retried by the same desktop process', async t => {
  const f = await fixture(t); await f.put()
  await assert.rejects(f.journal.recover(async () => { throw Error('device offline') }), /offline/)
  assert.equal((await fs.readdir(f.dir)).length, 1)
  let recovered = false
  await f.journal.recover(async () => { recovered = true })
  assert.equal(recovered, true); assert.deepEqual(await fs.readdir(f.dir), [])
})
test('concurrent callers in one desktop process share one recovery', async t => {
  const f = await fixture(t); await f.put()
  let calls = 0
  await Promise.all([f.journal.recover(async () => { calls++ }), f.journal.recover(async () => { calls++ })])
  assert.equal(calls, 1)
})
for (const changes of [{ name: '../other.so' }, { devicePid: '123; killall uitest' }, { started: '' }, { port: 70000 }]) {
  test(`malformed ownership cannot authorize cleanup ${JSON.stringify(changes)}`, async t => {
    const f = await fixture(t); await f.put({ ...f.record, ...changes })
    await assert.rejects(f.journal.recover(() => { throw Error('unsafe cleanup invoked') }), /ownership record/i)
  })
}
test('normal sessions persist their exact identity and remove it after confirmed stop', async t => {
  const f = await fixture(t)
  await f.journal.save({ name, devicePid: '123', started: '456' })
  const files = await fs.readdir(f.dir); assert.equal(files.length, 1)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.dir, files[0]), 'utf8')), { name, devicePid: '123', started: '456', hostPid: process.pid })
  await f.journal.clear(name); assert.deepEqual(await fs.readdir(f.dir), [])
})

test('two real desktop processes cannot both recover the same old record', async t => {
  const f = await fixture(t); await f.put()
  const modulePath = path.join(f.dir, 'ownership.cjs')
  const logPath = path.join(f.dir, 'cleanup.log')
  await fs.writeFile(modulePath, f.compiled)
  const worker = `const { NativeVideoOwnership } = require(process.argv[1]);
    new NativeVideoOwnership(process.argv[2]).recover(async () => {
      require('fs').appendFileSync(process.argv[3], 'cleanup\\n');
      await new Promise(resolve => setTimeout(resolve, 100));
    }).catch(() => { process.exitCode = 1 });`
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', worker, modulePath, f.dir, logPath], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(Error('Recovery worker failed')))
  })
  await Promise.all([run(), run()])
  assert.equal(await fs.readFile(logPath, 'utf8'), 'cleanup\n')
})
test('a new process can retry after a recovery claimant crashes', async t => {
  const f = await fixture(t); await f.put()
  const modulePath = path.join(f.dir, 'ownership.cjs')
  await fs.writeFile(modulePath, f.compiled)
  const worker = `const { NativeVideoOwnership } = require(process.argv[1]);
    new NativeVideoOwnership(process.argv[2]).recover(async () => { process.exit(23) });`
  const child = spawn(process.execPath, ['-e', worker, modulePath, f.dir], { stdio: 'ignore' })
  assert.equal(await new Promise(resolve => child.once('exit', resolve)), 23)
  let retried = false
  await f.journal.recover(async () => { retried = true })
  assert.equal(retried, true)
  assert.equal((await fs.readdir(f.dir)).filter(name => name.endsWith('.json')).length, 0)
})
