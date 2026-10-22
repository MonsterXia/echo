// Drive the installed application without replacing its updater, IPC or version.
// Usage: node script/check-packaged-update.mjs <executable> <version> <output-dir>
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const [executableArg, version, outputArg] = process.argv.slice(2)
assert.ok(['win32', 'darwin'].includes(process.platform))
assert.ok(['1.0.1', '1.0.2'].includes(version), 'This acceptance check targets Release 1.0.2')
assert.ok(executableArg && outputArg, 'Pass executable, version and output directory')
const executablePath = await realpath(executableArg)
const outputDir = path.resolve(outputArg)
await mkdir(outputDir, { recursive: true })
const profile = await mkdtemp(path.join(await realpath(os.tmpdir()), 'scrcpy-harmony-update-'))
const metadata = process.platform === 'win32' ? 'latest.yml'
  : process.arch === 'arm64' ? 'latest-mac.yml' : 'latest-x64-mac.yml'
const releases = 'https://github.com/MonsterXia/scrcpy-harmony/releases'
const metadataUrl = `${releases}/download/v1.0.2/${metadata}`
const report = { version, metadata, startedAt: new Date().toISOString(), scenarios: [], passed: false }
let application
let child
let page
let output = ''

function killApp() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10_000 })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}

const deadline = setTimeout(() => {
  console.error('Packaged update check timed out', output)
  killApp()
}, 180_000)

async function check(name, offline = false) {
  await application.evaluate(({ Menu }, offline) => {
    globalThis.updateCheckEvidence.offline = offline
    globalThis.updateCheckEvidence.requests = []
    globalThis.updateCheckEvidence.external = []
    const find = (menu) => {
      for (const item of menu.items) {
        if (/Check for Updates|检查更新/i.test(item.label)) return item
        if (item.submenu) {
          const result = find(item.submenu)
          if (result) return result
        }
      }
    }
    const item = find(Menu.getApplicationMenu())
    if (!item) throw new Error('Update menu item missing')
    item.click()
  }, offline)
  const modal = page.locator('.luna-modal:visible')
  const expected = offline ? /Failed to check for updates|检查更新失败/
    : version === '1.0.1' ? /A new version is available|有可用的更新/
      : /There are currently no updates available|当前没有可用的更新/
  await modal.getByText(expected).waitFor({ state: 'visible', timeout: 60_000 })
  const text = await modal.innerText()
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) })
  // Click the actual confirmation button; openExternal delegates to the OS.
  await modal.locator('.luna-modal-primary').click()
  await modal.waitFor({ state: 'hidden' })
  if (!offline && version === '1.0.1') {
    await application.evaluate(async () => {
      const until = Date.now() + 15_000
      while (!globalThis.updateCheckEvidence.external.some((entry) => entry.finished)) {
        if (Date.now() > until) throw new Error('Releases handoff did not finish')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    })
  }
  const evidence = await application.evaluate(() => globalThis.updateCheckEvidence)
  report.scenarios.push({ name, text, ...evidence })
  if (offline) {
    assert.ok(evidence.requests.some((entry) => entry.cancelled), 'Network failure was not injected')
    assert.deepEqual(evidence.external, [])
  } else {
    let finalUrl = metadataUrl
    for (let count = 0; count < 10; count++) {
      const redirect = evidence.requests.find((entry) => entry.url === finalUrl && entry.redirect)
      if (!redirect) break
      finalUrl = redirect.redirect
    }
    assert.ok(evidence.requests.some((entry) => entry.url === metadataUrl && entry.cancelled === false))
    assert.ok(evidence.requests.some((entry) => entry.url === finalUrl && entry.status === 200),
      `Expected a successful response after redirects for ${metadataUrl}`)
    assert.ok(!evidence.requests.some((entry) => /liriliri/.test(entry.url)), 'Unexpected upstream source')
    if (version === '1.0.1') {
      assert.deepEqual(evidence.external.map(({ url, finished, error }) => ({ url, finished, error })),
        [{ url: releases, finished: true, error: null }])
    } else assert.deepEqual(evidence.external, [])
  }
  assert.equal(child.exitCode, null, 'Application exited during update check')
  console.log('Update scenario passed:', name, JSON.stringify(evidence))
}

try {
  application = await electron.launch({ executablePath, cwd: path.dirname(executablePath),
    args: [`--user-data-dir=${profile}`, '--enable-logging'], chromiumSandbox: true, timeout: 30_000 })
  child = application.process()
  const append = (chunk) => { output = (output + chunk.toString()).slice(-128_000) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  page = await application.firstWindow({ timeout: 30_000 })
  page.setDefaultTimeout(20_000)
  await page.locator('#app .panel-with-toolbar').first().waitFor({ state: 'visible' })
  report.runtime = await application.evaluate(({ app, session, shell }) => {
    globalThis.updateCheckEvidence = { offline: false, requests: [], external: [] }
    const evidence = globalThis.updateCheckEvidence
    // GitHub's public CDN redirects contain expiring signatures; retain the path only.
    const safeUrl = (value) => {
      const url = new URL(value)
      return url.origin + url.pathname
    }
    const net = session.fromPartition('electron-updater', { cache: false })
    net.webRequest.onBeforeRequest((details, callback) => {
      // Only this app's updater session is affected; no machine-wide network changes.
      evidence.requests.push({ url: safeUrl(details.url), cancelled: evidence.offline })
      callback({ cancel: evidence.offline })
    })
    net.webRequest.onHeadersReceived((details, callback) => {
      const location = Object.entries(details.responseHeaders)
        .find(([key]) => key.toLowerCase() === 'location')?.[1]?.[0]
      if (location) evidence.requests.push({ url: safeUrl(details.url),
        status: details.statusCode, redirect: safeUrl(new URL(location, details.url).href) })
      callback({})
    })
    net.webRequest.onCompleted((details) => {
      evidence.requests.push({ url: safeUrl(details.url), status: details.statusCode })
    })
    net.webRequest.onErrorOccurred((details) => {
      evidence.requests.push({ url: safeUrl(details.url), error: details.error })
    })
    const openExternal = shell.openExternal.bind(shell)
    shell.openExternal = async (...args) => {
      const entry = { url: args[0], finished: false, error: null }
      evidence.external.push(entry)
      try { return await openExternal(...args) } catch (error) {
        entry.error = error.message
        throw error
      } finally { entry.finished = true }
    }
    return { packaged: app.isPackaged, version: app.getVersion(), arch: process.arch,
      electron: process.versions.electron, executable: app.getPath('exe'),
      appPath: app.getAppPath(), userData: app.getPath('userData') }
  })
  assert.equal(report.runtime.packaged, true)
  assert.equal(report.runtime.version, version)
  assert.equal(report.runtime.arch, process.arch)
  assert.equal(await realpath(report.runtime.executable), executablePath)
  assert.equal(await realpath(report.runtime.userData), profile)
  assert.ok(report.runtime.appPath.endsWith('app.asar'))
  await check(version === '1.0.1' ? 'available' : 'not-available')
  await check('network-error', true)
  await check('recovered')
  assert.deepEqual((await page.pageErrors()).map((error) => error.message), [])
  await application.close()
  assert.equal(child.exitCode, 0)
  report.passed = true
} catch (error) {
  report.error = error.stack
  if (application) {
    report.lastEvidence = await application.evaluate(() => globalThis.updateCheckEvidence).catch(() => null)
    if (page) {
      report.lastPageText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
      await page.screenshot({ path: path.join(outputDir, 'failure.png'), timeout: 3000 }).catch(() => {})
    }
  }
  throw error
} finally {
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      await application.close().catch(() => killApp())
    }
  } finally {
    killApp()
    clearTimeout(deadline)
    await writeFile(path.join(outputDir, 'application.log'), output)
    await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
console.log('Packaged update check passed:', JSON.stringify(report.runtime))
