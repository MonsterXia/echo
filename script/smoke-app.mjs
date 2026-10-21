import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright-core'

assert.ok(['win32', 'darwin'].includes(process.platform), 'Unsupported smoke check platform')
assert.ok(process.argv[2], 'Pass the installed application executable path')
const isWindows = process.platform === 'win32'
const executablePath = await realpath(process.argv[2])
const installDir = path.dirname(executablePath)
const resourcesDir = path.resolve(installDir, isWindows ? 'resources' : '../Resources')
const hdcResource = isWindows ? 'hdc/hdc.exe' : 'hdc/hdc'
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
const temporaryRoot = await realpath(os.tmpdir())
const profile = await mkdtemp(path.join(temporaryRoot, 'echo-startup-'))
let application
let child
let runtime
let output = ''

function killApp() {
  if (child && child.exitCode === null && child.signalCode === null) {
    if (isWindows) {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 10_000,
      })
    } else {
      // Playwright launches Unix applications in their own process group.
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  }
}

async function assertSamePath(actual, expected) {
  const paths = await Promise.all([realpath(actual), realpath(expected)])
  assert.equal(...paths.map((p) => isWindows ? p.toLowerCase() : p))
}

// Bound IPC calls and shutdown as well as Playwright's individual operations.
const deadline = setTimeout(() => {
  console.error('Installed application smoke check timed out\n' + output)
  try {
    killApp()
  } finally {
    process.exit(1)
  }
}, 90_000)

try {
  application = await electron.launch({
    executablePath,
    cwd: installDir,
    args: [`--user-data-dir=${profile}`, '--enable-logging'],
    chromiumSandbox: true,
    timeout: 30_000,
  })
  child = application.process()
  const appendOutput = (chunk) => {
    output = (output + chunk.toString()).slice(-32_000)
  }
  child.stdout?.on('data', appendOutput)
  child.stderr?.on('data', appendOutput)
  const page = await application.firstWindow({ timeout: 30_000 })
  page.setDefaultTimeout(20_000)
  const failures = []
  page.on('crash', () => failures.push('Renderer crashed'))
  page.on('pageerror', (error) => failures.push(error.message))

  runtime = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    executable: app.getPath('exe'),
    electron: process.versions.electron,
    arch: process.arch,
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }))
  assert.equal(runtime.packaged, true)
  await assertSamePath(runtime.executable, executablePath)
  await assertSamePath(runtime.appPath, path.join(resourcesDir, 'app.asar'))
  await assertSamePath(runtime.userData, profile)
  assert.equal(runtime.version, pkg.version)
  assert.equal(runtime.electron, pkg.devDependencies.electron)
  assert.equal(runtime.arch, process.arch)

  const expectedPage = pathToFileURL(
    path.join(resourcesDir, 'app.asar/renderer/index.html')
  )
  await page.waitForURL(expectedPage.href)
  assert.equal(await page.title(), pkg.productName)
  // The overview is mounted only after the renderer store has initialized via IPC.
  await page.locator('#app .panel-with-toolbar').first().waitFor({ state: 'visible' })
  const bridge = await page.evaluate(async (hdcResource) => ({
    targets: await window.main.getTargets(),
    customTitlebar: await window.main.isCustomTitlebar(),
    hdcPath: await window.main.resolveResources(hdcResource),
  }), hdcResource)
  assert.ok(
    Array.isArray(bridge.targets),
    'Device enumeration IPC did not return an array'
  )
  assert.equal(bridge.customTitlebar, true)
  await assertSamePath(bridge.hdcPath, path.join(resourcesDir, hdcResource))
  const browserWindow = await application.browserWindow(page)
  assert.equal(await browserWindow.evaluate((win) => win.isVisible()), true)

  await page.locator('#app .icon-setting').click()
  await page.locator('.luna-modal:visible .luna-setting').waitFor({
    state: 'visible',
  })
  await page.locator('.luna-modal:visible')
    .getByText('HDC', { exact: true }).waitFor({ state: 'visible' })
  // Retained errors cover early page failures before the listener was attached.
  failures.push(...(await page.pageErrors()).map((error) => error.message))
  failures.push(...(await page.consoleMessages())
    .filter((message) => message.type() === 'error').map((message) => message.text()))
  assert.deepEqual(failures, [], 'Startup or settings page reported errors')
  assert.equal(child.exitCode, null, 'Application exited during the smoke check')
  await application.close()
  assert.equal(child.exitCode, 0, 'Application did not exit cleanly')
} catch (error) {
  console.error(output)
  throw error
} finally {
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      await application.close()
    }
  } finally {
    try {
      killApp()
      // Only remove the unique profile created by this run, directly under TEMP.
      assert.equal(path.dirname(profile), temporaryRoot)
      await rm(profile, {
        recursive: true, force: true, maxRetries: 5, retryDelay: 100,
      })
    } finally {
      clearTimeout(deadline)
    }
  }
}
console.log('Installed application smoke check passed:', JSON.stringify(runtime))
