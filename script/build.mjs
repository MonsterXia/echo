import fs from 'fs-extra'
import { execFileSync } from 'node:child_process'
import { vendorNotices } from './lib/vendor-notices.mjs'
import path from 'node:path'
import { validateNativeResources } from './native-video-resources.mjs'

const npmCli = process.env.npm_execpath
if (!npmCli) {
  throw new Error('Run this script with npm run build')
}

function runNpm(...args) {
  // Invoke npm's JS entry point directly: no Bash, cmd.exe or path quoting.
  execFileSync(process.execPath, [npmCli, ...args], { stdio: 'inherit' })
}

const pkg = await fs.readJson('package.json')
const electron = pkg.devDependencies.electron
delete pkg.devDependencies
pkg.devDependencies = {
  electron,
}
delete pkg.scripts
pkg.scripts = {
  start: 'electron main/index.js',
}
pkg.main = 'main/index.js'

runNpm('run', 'build:main')
runNpm('run', 'build:preload')
runNpm('run', 'build:renderer')

await fs.copy('build', 'dist/build')
await fs.copy('resources/hdc', 'dist/resources/hdc')
await fs.copy('resources/uitestkit_sdk', 'dist/resources/uitestkit_sdk')
const nativeManifest = await fs.readJson('vendor/native-video/manifest.json')
await validateNativeResources('resources/native-video', nativeManifest, path.resolve('vendor/native-video'))
// Replace only this generated resource folder, and copy an exact allowlist.
// Refuse output redirected outside this workspace before recursive removal.
const workspaceRoot = await fs.realpath(process.cwd())
const outputRoot = await fs.realpath('dist/resources')
if (!outputRoot.startsWith(workspaceRoot + path.sep)) throw new Error('Native resource output escaped workspace')
const nativeOutput = path.join(outputRoot, 'native-video')
if (await fs.pathExists(nativeOutput) && (await fs.lstat(nativeOutput)).isSymbolicLink()) throw new Error('Native resource output must not be a symlink')
await fs.remove(nativeOutput)
await fs.ensureDir(nativeOutput)
for (const file of [...nativeManifest.libraries.map(entry => entry.file), 'LICENSE', 'README.md', 'manifest.json']) {
  await fs.copyFile(path.join('resources/native-video', file), path.join(nativeOutput, file))
}
await fs.copy('LICENSE', 'dist/LICENSE')
const nativeNotices = await fs.readFile('vendor/native-video/README.md', 'utf8') + '\n' + await fs.readFile('vendor/native-video/LICENSE', 'utf8')
await fs.writeFile('dist/THIRD_PARTY_NOTICES.txt', await vendorNotices(process.cwd()) + '\n' + nativeNotices)
process.chdir('dist')

await fs.writeJson('package.json', pkg, {
  spaces: 2,
})

runNpm('install', '--omit=dev', '--no-audit', '--no-fund')
