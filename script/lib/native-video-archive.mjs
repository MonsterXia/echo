import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function extractNativeLibraries(archive, manifest) {
  if (archive.length !== manifest.size || sha256(archive) !== manifest.sha256) throw new Error('Native archive integrity check failed')
  const wanted = new Map(manifest.libraries.map(entry => [entry.entry, entry]))
  for (const entry of wanted.values()) {
    if (!/^[a-zA-Z0-9_.-]+\.so$/.test(entry.file)) throw new Error('Invalid native filename')
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > 4 * 1024 * 1024) throw new Error('Invalid native library size')
  }
  let end = -1
  for (let p = archive.length - 22; p >= Math.max(0, archive.length - 65557); p--) {
    if (archive.readUInt32LE(p) === 0x06054b50 && p + 22 + archive.readUInt16LE(p + 20) === archive.length) { end = p; break }
  }
  if (end < 0) throw new Error('Invalid ZIP directory')
  const count = archive.readUInt16LE(end + 10)
  const size = archive.readUInt32LE(end + 12)
  const start = archive.readUInt32LE(end + 16)
  if (count === 65535 || archive.readUInt32LE(end + 4) !== 0 || archive.readUInt16LE(end + 8) !== count || start + size !== end) throw new Error('Unsupported ZIP directory')
  let offset = start
  const found = new Map()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory entry')
    const nameSize = archive.readUInt16LE(offset + 28)
    const next = offset + 46 + nameSize + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32)
    if (next > end) throw new Error('Invalid ZIP directory bounds')
    const name = archive.subarray(offset + 46, offset + 46 + nameSize).toString('utf8')
    const entry = wanted.get(name)
    if (entry) {
      if (found.has(name)) throw new Error('Duplicate native library')
      const method = archive.readUInt16LE(offset + 10)
      const compressedSize = archive.readUInt32LE(offset + 20)
      const local = archive.readUInt32LE(offset + 42)
      if ((archive.readUInt16LE(offset + 8) & 1) || ![0, 8].includes(method) || archive.readUInt32LE(offset + 24) !== entry.size || local + 30 > start || archive.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid native ZIP entry')
      const body = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28)
      if (body + compressedSize > start) throw new Error('Invalid native ZIP bounds')
      const compressed = archive.subarray(body, body + compressedSize)
      const bytes = method === 8 ? inflateRawSync(compressed, { maxOutputLength: entry.size }) : Buffer.from(compressed)
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) throw new Error('Native library integrity check failed')
      found.set(name, { file: entry.file, bytes })
    }
    offset = next
  }
  if (offset !== end || found.size !== wanted.size) throw new Error('Native library missing from ZIP directory')
  return manifest.libraries.map(entry => found.get(entry.entry))
}
