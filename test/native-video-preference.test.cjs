const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
const manifest = require('../vendor/native-video/manifest.json')
async function fixture(t) {
  const file = path.resolve(__dirname, '../src/main/lib/hdc/nativeVideoPreference.ts')
  const output = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  const compiled = new Module(file, module); compiled._compile(output.outputFiles[0].text, file)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-preference-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const create = (identity = ['device', 'aarch64', '7.0.0.1', 'firmware']) => new compiled.exports.NativeVideoPreference(dir, identity)
  return { dir, create }
}
test('compatible library survives restart and is isolated by device and firmware', async t => {
  const { create } = await fixture(t)
  const file = manifest.libraries[1].file
  await create().save(file)
  assert.equal(await create().load(), file)
  assert.equal(await create(['different-device']).load(), undefined)
  assert.equal(await create(['device', 'aarch64', '7.0.0.1', 'updated-firmware']).load(), undefined)
  await create().clear()
  assert.equal(await create().load(), undefined)
})
test('corrupt, unknown, or unwritable preferences never block capture or supply a file path', async t => {
  const { dir, create } = await fixture(t)
  await create().save(manifest.libraries[0].file)
  const [entry] = await fs.readdir(dir)
  for (const value of ['{invalid', JSON.stringify('../outside.so')]) {
    await fs.writeFile(path.join(dir, entry), value)
    assert.equal(await create().load(), undefined)
  }
  await create().save('../outside.so')
  assert.equal(await create().load(), undefined)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.writeFile(dir, 'not a directory')
  await create().save(manifest.libraries[0].file)
  await create().clear()
  assert.equal(await create().load(), undefined)
})
