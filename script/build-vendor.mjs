import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from './lib/vendor-build.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/manifest.json'), 'utf8'))
const packages = manifest.packages.map(({ name }) => path.join(root, 'vendor/packages', name))
async function build() {
  for (const dir of packages) await buildPackage(dir)
  fs.writeFileSync(path.join(root, 'vendor/.build-stamp'), String(Date.now()))
  console.log(`Built ${packages.length} local packages from repository sources`)
}
if (!process.argv.includes('--skip-initial')) await build()

if (process.argv.includes('--watch')) {
  let timer
  let running = false
  let dirty = false
  async function rebuild() {
    if (running) { dirty = true; return }
    running = true
    try { await build() } catch (error) { console.error(error); process.exitCode = 1 }
    finally {
      running = false
      if (dirty) { dirty = false; await rebuild() }
    }
  }
  for (const dir of packages) {
    const source = path.join(dir, 'src')
    if (!fs.existsSync(source)) continue // Licia JS is consumed directly by Vite.
    fs.watch(source, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(rebuild, 150)
    })
  }
  console.log('Watching local dependency sources')
}
