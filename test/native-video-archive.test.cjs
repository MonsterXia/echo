const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { deflateRawSync } = require('node:zlib')
const load = () => import('../script/lib/native-video-archive.mjs')
const sha = data => crypto.createHash('sha256').update(data).digest('hex')
function fixture() {
  const data = Buffer.from('signed native library fixture')
  const name = Buffer.from('libscrcpy/test.so'), compressed = deflateRawSync(data)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28)
  const first = Buffer.concat([local, name, compressed]), directory = Buffer.concat([central, name])
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(first.length, 16)
  const archive = Buffer.concat([first, directory, end])
  const manifest = { size: archive.length, sha256: sha(archive), libraries: [{ entry: name.toString(), file: 'test.so', size: data.length, sha256: sha(data) }] }
  return { data, archive, manifest }
}
test('Node extracts only pinned ZIP entries and verifies both archive and library digests', async () => {
  const { extractNativeLibraries } = await load()
  const { data, archive, manifest } = fixture()
  assert.deepEqual(extractNativeLibraries(archive, manifest), [{ file: 'test.so', bytes: data }])
  const changed = Buffer.from(archive); changed[40] ^= 1
  assert.throws(() => extractNativeLibraries(changed, manifest), /archive integrity/)
  assert.throws(() => extractNativeLibraries(archive, { ...manifest, libraries: [{ ...manifest.libraries[0], sha256: '0'.repeat(64) }] }), /library integrity/)
})
test('ZIP extraction rejects traversal outputs, missing entries and malformed directory bounds', async () => {
  const { extractNativeLibraries } = await load()
  const { archive, manifest } = fixture()
  assert.throws(() => extractNativeLibraries(archive, { ...manifest, libraries: [{ ...manifest.libraries[0], file: '../escape.so' }] }), /filename/)
  assert.throws(() => extractNativeLibraries(archive, { ...manifest, libraries: [{ ...manifest.libraries[0], entry: 'missing.so' }] }), /missing/)
  const malformed = Buffer.from(archive); malformed.writeUInt32LE(0xffffffff, malformed.length - 6)
  assert.throws(() => extractNativeLibraries(malformed, { ...manifest, sha256: sha(malformed) }), /directory/)
})
