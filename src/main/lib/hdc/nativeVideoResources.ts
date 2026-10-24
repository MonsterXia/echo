import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import manifest from '../../../../vendor/native-video/manifest.json'

export interface NativeLibrary {
  file: string
  size: number
  sha256: string
}

export function supportsNativeVideo(architecture: string, version: string) {
  if (architecture.trim() !== 'aarch64' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(version.trim())) return false
  const parts = version.trim().split('.').map(Number)
  const minimum = [6, 0, 2, 2]
  for (let i = 0; i < 4; i++) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i]
  }
  return true
}

export function verifyNativeLibrary(bytes: Buffer, library: NativeLibrary) {
  if (!/^[a-zA-Z0-9_.-]+\.so$/.test(library.file)) throw new Error('Invalid native library filename')
  if (bytes.length !== library.size || createHash('sha256').update(bytes).digest('hex') !== library.sha256) {
    throw new Error('Native library integrity check failed')
  }
  if (bytes.length < 64 || bytes.subarray(0, 6).toString('hex') !== '7f454c460201' || bytes.readUInt16LE(18) !== 183) {
    throw new Error('Native library is not ARM64 ELF')
  }
}

export async function loadNativeLibraries(directory: string, preferred?: string, libraries: NativeLibrary[] = manifest.libraries) {
  const result = []
  for (const library of libraries) {
    // Validate the filename before joining or reading it.
    if (!/^[a-zA-Z0-9_.-]+\.so$/.test(library.file)) throw new Error('Invalid native library filename')
    const filePath = path.resolve(directory, library.file)
    const bytes = await readFile(filePath)
    verifyNativeLibrary(bytes, library)
    result.push({ ...library, path: filePath })
  }
  return result.sort((a, b) => Number(b.file === preferred) - Number(a.file === preferred))
}
