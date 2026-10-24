const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const crypto = require('node:crypto')
const { build } = require('esbuild')
const Module = require('node:module')
async function load() {
  const file = path.resolve(__dirname, '../src/main/lib/hdc/nativeVideoResources.ts')
  const output = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  const compiled = new Module(file, module)
  compiled._compile(output.outputFiles[0].text, file)
  return compiled.exports
}
function fixture() {
  const bytes = Buffer.alloc(64)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
  bytes.writeUInt16LE(183, 18)
  return { bytes, entry: { file: 'fixture.so', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } }
}
test('native candidates require ARM64 and the unix-service UITest boundary', async () => {
  const { supportsNativeVideo } = await load()
  assert.equal(supportsNativeVideo('aarch64', '7.0.0.1'), true)
  assert.equal(supportsNativeVideo('aarch64', '6.0.2.2'), true)
  for (const [arch, version] of [['x86_64','7.0.0.1'],['aarch64','6.0.2.1'],['aarch64','invalid'],['aarch64','7.0.0.1 injected']]) {
    assert.equal(supportsNativeVideo(arch, version), false)
  }
})
test('native library validation rejects corruption, wrong architecture and unsafe filenames', async () => {
  const { verifyNativeLibrary } = await load()
  const { bytes, entry } = fixture()
  assert.doesNotThrow(() => verifyNativeLibrary(bytes, entry))
  const bad = Buffer.from(bytes); bad[25] = 1
  assert.throws(() => verifyNativeLibrary(bad, entry), /digest|integrity/)
  const wrong = Buffer.from(bytes); wrong.writeUInt16LE(62, 18)
  assert.throws(() => verifyNativeLibrary(wrong, { ...entry, sha256: crypto.createHash('sha256').update(wrong).digest('hex') }), /ARM64|ELF/)
  assert.throws(() => verifyNativeLibrary(bytes, { ...entry, file: '../fixture.so' }), /filename/)
})
test('resource selection validates all candidates and promotes the previously working library', async (t) => {
  const { loadNativeLibraries } = await load()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'native libraries '))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const { bytes, entry } = fixture()
  const second = { ...entry, file: 'second.so' }
  await fs.writeFile(path.join(dir, entry.file), bytes)
  await fs.writeFile(path.join(dir, second.file), bytes)
  const result = await loadNativeLibraries(dir, second.file, [entry, second])
  assert.deepEqual(result.map(x => x.file), ['second.so', 'fixture.so'])
  await fs.writeFile(path.join(dir, entry.file), 'damaged')
  await assert.rejects(loadNativeLibraries(dir, undefined, [entry, second]), /integrity/)
})
