import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { extractNativeLibraries } from './lib/native-video-archive.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'vendor/native-video')
const digest = data => createHash('sha256').update(data).digest('hex')

export async function validateNativeResources(directory, manifest, noticeSource = source) {
  for (const entry of manifest.libraries) {
    const bytes = await fs.readFile(path.join(directory, entry.file))
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`Native resource integrity failed: ${entry.file}`)
  }
  for (const name of ['LICENSE', 'README.md', 'manifest.json']) {
    if (!(await fs.readFile(path.join(directory, name))).equals(await fs.readFile(path.join(noticeSource, name)))) throw new Error(`Native resource notice mismatch: ${name}`)
  }
}

export async function prepareNativeResources(archivePath, directory = path.join(root, 'resources/native-video')) {
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'))
  if (!archivePath) {
    try { await validateNativeResources(directory, manifest); return } catch { /* prepare a complete verified set */ }
  }
  let archive
  if (archivePath) archive = await fs.readFile(archivePath)
  else {
    const response = await fetch(manifest.url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok || !response.body) throw new Error(`Native resource download failed: HTTP ${response.status}`)
    const chunks = []
    let length = 0
    for await (const chunk of response.body) {
      length += chunk.length
      if (length > manifest.size) throw new Error('Native archive exceeds pinned size')
      chunks.push(chunk)
    }
    archive = Buffer.concat(chunks, length)
  }
  const files = extractNativeLibraries(archive, manifest)
  await fs.mkdir(directory, { recursive: true })
  for (const { file, bytes } of files) {
    const temporary = path.join(directory, `${file}.${randomBytes(6).toString('hex')}.tmp`)
    try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, path.join(directory, file)) }
    finally { await fs.rm(temporary, { force: true }) }
  }
  for (const name of ['LICENSE', 'README.md', 'manifest.json']) await fs.copyFile(path.join(source, name), path.join(directory, name))
  await validateNativeResources(directory, manifest)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareNativeResources(process.argv[2] === '--archive' ? process.argv[3] : undefined)
  console.log('Verified native video resources ready (no Java required)')
}
