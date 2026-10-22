// Install a specified acceptance artifact only on disposable hosted runners.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

assert.ok(['darwin', 'win32'].includes(process.platform) &&
  process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  'Installation requires a disposable GitHub-hosted Windows or macOS runner')
assert.equal(process.arch, process.env.EXPECTED_ARCH)
const [installerArg, version, outputArg, expectedHash] = process.argv.slice(2)
assert.ok(installerArg && outputArg && ['1.0.1', '1.0.2'].includes(version))
const installer = await realpath(installerArg)
const outputDir = path.resolve(outputArg)
await mkdir(outputDir, { recursive: true })
const bytes = await readFile(installer)
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (version === '1.0.2') assert.equal(sha256, expectedHash, 'Published installer hash mismatch')
await writeFile(path.join(outputDir, 'installer.json'), JSON.stringify({
  filename: path.basename(installer), version, bytes: bytes.length, sha256,
  source: version === '1.0.1' ? 'b81c6563e7502819142d651aad15a6b4d45f33bf'
    : 'https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.2',
  validationCommit: process.env.GITHUB_SHA,
  runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
}, null, 2) + '\n')
const root = await mkdtemp(path.join(await realpath(process.env.RUNNER_TEMP), 'update-install-'))
const win = process.platform === 'win32'
const installDir = path.join(root, 'Installed Apps')
const app = path.join(installDir, 'Scrcpy Harmony.app')
const executable = win ? path.join(installDir, 'Scrcpy Harmony.exe')
  : path.join(app, 'Contents/MacOS/Scrcpy Harmony')
const hdc = win ? path.join(installDir, 'resources/hdc/hdc.exe')
  : path.join(app, 'Contents/Resources/hdc/hdc')
const mount = path.join(root, 'volume')
const run = (command, args, timeout = 60_000, env = process.env) =>
  execFileSync(command, args, { stdio: 'inherit', timeout, env })
let mounted = false
async function detach() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      run('hdiutil', ['detach', mount], 30_000)
      mounted = false
      return
    } catch (error) {
      // hdiutil can report "Resource busy" even after the volume disappeared.
      // Check the OS mount inventory before retrying this run's own image.
      const plist = execFileSync('hdiutil', ['info', '-plist'], { timeout: 10_000 })
      const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'],
        { input: plist, encoding: 'utf8', timeout: 10_000 }))
      const attached = info.images.some((image) => image['system-entities']
        .some((entity) => entity['mount-point'] === mount))
      if (!attached) {
        mounted = false
        return
      }
      if (attempt === 2) throw error
      console.warn('DMG is still mounted; retrying detach:', mount)
      await delay(1000)
    }
  }
}
try {
  if (win) {
    // Paths are environment values, never interpolated into PowerShell source.
    run('pwsh', ['-NoProfile', '-Command', `
      $ErrorActionPreference = 'Stop'
      $p = Start-Process -FilePath $env:UPDATE_INSTALLER -ArgumentList "/S /currentuser /D=$env:UPDATE_INSTALL_DIR" -WindowStyle Hidden -PassThru
      if (!$p.WaitForExit(120000)) { Stop-Process -Id $p.Id -Force; throw 'NSIS timed out' }
      if ($p.ExitCode -ne 0) { throw "NSIS failed: $($p.ExitCode)" }
    `], 130_000, { ...process.env, UPDATE_INSTALLER: installer, UPDATE_INSTALL_DIR: installDir })
  } else {
    await mkdir(mount)
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, installer])
    mounted = true
    run('ditto', [path.join(mount, 'Scrcpy Harmony.app'), app])
    await detach()
  }
  run(process.execPath, ['script/check-packaged-update.mjs', executable, version, outputDir], 200_000)
} finally {
  try { run(hdc, ['kill'], 10_000) } catch (error) { console.warn('HDC cleanup:', error.message) }
  if (mounted) await detach()
}
