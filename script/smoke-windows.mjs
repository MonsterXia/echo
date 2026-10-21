import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright-core'

assert.equal(process.platform, 'win32', 'This smoke check requires Windows')
assert.ok(process.argv[2], 'Pass the installed ECHO.exe path')
const executablePath = path.resolve(process.argv[2])
const installDir = path.dirname(executablePath)
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
const profile = await mkdtemp(path.join(os.tmpdir(), 'echo-startup-'))
let application
let child
let output = ''

function killApp() {
  if (child && child.exitCode === null && child.signalCode === null) {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10_000,
    })
  }
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

  const runtime = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    executable: app.getPath('exe'),
    electron: process.versions.electron,
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }))
  assert.equal(runtime.packaged, true)
  assert.equal(runtime.executable.toLowerCase(), executablePath.toLowerCase())
  assert.equal(
    runtime.appPath.toLowerCase(),
    path.join(installDir, 'resources/app.asar').toLowerCase()
  )
  assert.equal(runtime.userData.toLowerCase(), profile.toLowerCase())
  assert.equal(runtime.version, pkg.version)
  assert.equal(runtime.electron, pkg.devDependencies.electron)

  const expectedPage = pathToFileURL(
    path.join(installDir, 'resources/app.asar/renderer/index.html')
  )
  await page.waitForURL(expectedPage.href)
  assert.equal(await page.title(), pkg.productName)
  // The overview is mounted only after the renderer store has initialized via IPC.
  await page.locator('#app .panel-with-toolbar').first().waitFor({ state: 'visible' })
  const bridge = await page.evaluate(async () => ({
    targets: await window.main.getTargets(),
    customTitlebar: await window.main.isCustomTitlebar(),
    hdcPath: await window.main.resolveResources('hdc/hdc.exe'),
  }))
  assert.ok(
    Array.isArray(bridge.targets),
    'Device enumeration IPC did not return an array'
  )
  assert.equal(bridge.customTitlebar, true)
  assert.equal(
    bridge.hdcPath.toLowerCase(),
    path.join(installDir, 'resources/hdc/hdc.exe').toLowerCase()
  )
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
  console.log('Installed Windows application smoke check passed:', JSON.stringify(runtime))
} catch (error) {
  console.error(output)
  throw error
} finally {
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      await application.close()
    }
  } finally {
    killApp()
    clearTimeout(deadline)
  }
}
