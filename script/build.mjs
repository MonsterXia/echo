import fs from 'fs-extra'
import { execFileSync } from 'node:child_process'
import { vendorNotices } from './lib/vendor-notices.mjs'

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
await fs.copy('LICENSE', 'dist/LICENSE')
await fs.writeFile('dist/THIRD_PARTY_NOTICES.txt', await vendorNotices(process.cwd()))
process.chdir('dist')

await fs.writeJson('package.json', pkg, {
  spaces: 2,
})

runNpm('install', '--omit=dev', '--no-audit', '--no-fund')
