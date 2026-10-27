// Requires two user-authorized disposable HAPs and one device. Uses real OS-backed
// files via Chromium drag events, production preload/IPC/HDC, and real notifications.
// node script/check-hap-drop-live.cjs <base.hap> <upgrade.hap> <output> --disposable [--executable <app-binary>] [--language en-US]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { _electron } = require('playwright-core')
const { measureNotice, freshListAfter } = require('./lib/hap-acceptance.cjs')
const [baseArg, upgradeArg, outputArg] = process.argv.slice(2)
assert.ok(baseArg && upgradeArg && outputArg && process.argv.includes('--disposable'))
const base = path.resolve(baseArg), upgrade = path.resolve(upgradeArg), output = path.resolve(outputArg)
const languageIndex = process.argv.indexOf('--language')
const language = languageIndex < 0 ? 'zh-CN' : process.argv[languageIndex + 1]
const executableIndex = process.argv.indexOf('--executable')
const executable = executableIndex < 0 ? null : process.argv[executableIndex + 1]
const negativeControl = process.argv.includes('--negative-control-stale-refresh')
const zh = language === 'zh-CN'
const labels = zh ? { filter: '过滤', refresh: '刷新', success: '安装成功：', failure: '安装应用失败', unsupported: '请拖入 .hap', overview: '概览', application: '应用' }
  : { filter: 'Filter', refresh: 'Refresh', success: 'Installed successfully:', failure: 'Failed to install application', unsupported: 'Drop .hap', overview: 'Overview', application: 'Applications' }
const packages = [base, upgrade].map(file => {
  const { app } = JSON.parse(execFileSync('unzip', ['-p', file, 'module.json'], { encoding: 'utf8' }))
  return { bundleName: app.bundleName, versionName: app.versionName, versionCode: app.versionCode,
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
})
const bundleName = packages[0].bundleName
assert.equal(bundleName, 'com.example.testhap', 'This probe is restricted to the supplied disposable sample')
assert.equal(packages[1].bundleName, bundleName)
assert.ok(packages[1].versionCode > packages[0].versionCode)
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-hap-drop-'))
fs.mkdirSync(path.join(profile, 'data'))
fs.writeFileSync(path.join(profile, 'data/main.json'), JSON.stringify({ panel: 'application', application: { sysBundle: false, listView: true } }))
fs.writeFileSync(path.join(profile, 'data/settings.json'), JSON.stringify({ language, killHdcWhenExit: false }))
// Windows filenames cannot contain angle brackets. Renderer-only regression
// tests still exercise HTML escaping on every host.
const uppercase = path.join(profile, process.platform === 'win32' ? 'Hello & spaced.HAP' : 'Hello <test> & spaced.HAP')
fs.copyFileSync(upgrade, uppercase)
const invalid = path.join(profile, 'invalid.hap'); fs.writeFileSync(invalid, 'not a HAP archive')
const text = path.join(profile, 'ignored.txt'); fs.writeFileSync(text, 'not an application')
const report = { evidenceVersion: 2, negativeControl, startedAt: new Date().toISOString(), language, packages, cases: [], passed: false,
  scope: 'CDP OS-backed file drops into actual Electron windows; no fake file paths or mocked installation results; no screen pixels saved except notification crops' }
let app, key
async function until(check, label, timeout = 60_000) {
  const end = Date.now() + timeout
  while (!await check()) { if (Date.now() > end) throw Error(label); await delay(100) }
}
async function observe(page) {
  await page.evaluate(source => {
    const measure = (0, eval)('(' + source + ')')
    globalThis.hapNotices = []
    const seen = new Set()
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('.luna-notification-item')) {
        if (!seen.has(el.id)) {
          seen.add(el.id)
          globalThis.hapNotices.push({ text: el.textContent, at: Date.now(), ...measure(el) })
        }
      }
    }).observe(document.body, { subtree: true, childList: true })
  }, measureNotice.toString())
}
async function drop(page, files, selector = 'canvas', point) {
  const cdp = await page.context().newCDPSession(page)
  const rect = point || await page.locator(selector).first().boundingBox()
  assert.ok(rect)
  const data = { items: [], files, dragOperationsMask: 1 }
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, data })
    }
  } finally { await cdp.detach() }
}
(async () => {
  try {
    app = await _electron.launch({ executablePath: executable || require('electron'),
      args: [...(executable ? [] : [path.resolve('dist')]), '--user-data-dir=' + profile] })
    report.runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron }))
    // Ask the running app for its archive instead of assuming macOS bundle layout.
    const appPath = await app.evaluate(({ app }) => app.getAppPath())
    const buildPath = report.runtime.packaged ? appPath : path.join(appPath, 'main/index.js')
    report.buildSha256 = createHash('sha256').update(fs.readFileSync(buildPath)).digest('hex')
    await app.evaluate(({ ipcMain }) => {
      globalThis.hapCalls = []
      globalThis.hapLists = []
      globalThis.hapSequence = 0
      globalThis.hapHoldNextList = false
      globalThis.hapHeldList = null
      globalThis.hapReleaseList = null
      const list = ipcMain._invokeHandlers.get('getBundles')
      ipcMain.removeHandler('getBundles')
      ipcMain.handle('getBundles', async (event, key, system) => {
        const query = { startedSeq: ++globalThis.hapSequence, key, sender: event.sender.id, completed: false, success: false }
        globalThis.hapLists.push(query)
        const hold = globalThis.hapHoldNextList
        globalThis.hapHoldNextList = false
        try {
          const result = await list(event, key, system)
          if (hold) {
            globalThis.hapHeldList = query
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(Error('Controlled list response was not released')), 30000)
              globalThis.hapReleaseList = () => { clearTimeout(timeout); resolve() }
            })
          }
          query.success = true
          return result
        } finally {
          query.completed = true
          query.completedSeq = ++globalThis.hapSequence
        }
      })
      const install = ipcMain._invokeHandlers.get('installBundle')
      ipcMain.removeHandler('installBundle')
      ipcMain.handle('installBundle', async (event, key, file) => {
        const call = { startedSeq: ++globalThis.hapSequence, completed: false, success: false }; globalThis.hapCalls.push(call)
        try { const result = await install(event, key, file); call.success = true; call.successSeq = ++globalThis.hapSequence; return result }
        finally { call.completed = true }
      })
    })
    const mainPage = await app.firstWindow()
    const mainContentsId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('page=')).webContents.id)
    if (negativeControl) await app.evaluate(({ webContents }, id) => {
      const contents = webContents.fromId(id)
      const send = contents.send.bind(contents)
      contents.send = (channel, ...args) => {
        if (globalThis.hapSuppressInstalled && channel === 'bundleInstalled') return
        return send(channel, ...args)
      }
    }, mainContentsId)
    await mainPage.getByPlaceholder(labels.filter, { exact: true }).waitFor()
    const targets = await mainPage.evaluate(() => main.getTargets()); assert.equal(targets.length, 1); key = targets[0].key
    const panel = mainPage.locator('.panel-with-toolbar').filter({ has: mainPage.getByPlaceholder(labels.filter, { exact: true }) })
    const ready = () => panel.locator(`[title="${labels.refresh}"]`).evaluate(el => !el.closest('.luna-toolbar-disabled'))
    await until(ready, 'Initial list not ready')
    const before = await mainPage.evaluate(key => main.getBundles(key, false), key)
    const hadSample = before.includes(bundleName)
    report.initiallyInstalled = hadSample
    if (hadSample) await mainPage.evaluate(({ key, bundleName }) => main.uninstallBundle(key, bundleName), { key, bundleName })
    await panel.locator(`[title="${labels.refresh}"]`).click()
    await until(ready, 'Reset list not ready')
    await mainPage.getByPlaceholder(labels.filter, { exact: true }).fill(bundleName)
    await observe(mainPage)
    const calls = () => app.evaluate(() => globalThis.hapCalls)
    const queries = () => app.evaluate((_, { key, id }) => globalThis.hapLists
      .filter(query => query.key === key && query.sender === id)
      .map(({ key, sender, ...query }) => query), { key, id: mainContentsId })
    async function run(name, page, files, expectedSuccess, expectedFailures, version, selector, point, expectOverlap = false) {
      const start = (await calls()).length
      await page.evaluate(() => { globalThis.hapNotices = [] })
      await drop(page, files, selector, point)
      const expectedCalls = expectedSuccess + expectedFailures
      if (expectedCalls) await until(async () => {
        const current = (await calls()).slice(start)
        return current.length >= expectedCalls && current.every(c => c.completed)
      }, name + ': installation not completed')
      else await delay(400)
      const current = (await calls()).slice(start)
      let overlap
      if (expectOverlap) {
        overlap = await app.evaluate(() => {
          const query = globalThis.hapHeldList
          const value = query && { startedSeq: query.startedSeq, completed: query.completed }
          globalThis.hapReleaseList?.()
          globalThis.hapReleaseList = null
          return value
        })
        assert.ok(overlap && !overlap.completed, 'Refresh must still be in flight when installation completes')
        assert.ok(current.filter(c => c.success).every(c => c.successSeq > overlap.startedSeq))
      }
      assert.equal(current.length, expectedCalls, name + ': duplicate or missing installation')
      assert.equal(current.filter(c => c.success).length, expectedSuccess)
      await until(async () => {
        const notices = await page.evaluate(() => globalThis.hapNotices)
        return notices.filter(n => n.text.startsWith(labels.success)).length === expectedSuccess &&
          notices.filter(n => n.text === labels.failure).length === expectedFailures
      }, name + ': missing result notification', 10_000)
      const notices = await page.evaluate(() => globalThis.hapNotices)
      const terminal = notices.filter(n => n.text.startsWith(labels.success) || n.text === labels.failure || n.text.startsWith(labels.unsupported))
      assert.equal(terminal.length, expectedCalls || 1)
      assert.ok(terminal.every(n => n.visible && n.fits && n.insideFullscreen && n.noMarkupInjection),
        name + ': hidden, clipped, outside-fullscreen or injected terminal notification')
      if (!expectedCalls) assert.ok(notices.some(n => n.text.startsWith(labels.unsupported)))
      if (expectedSuccess) {
        if (name.includes('screencast')) {
          await page.locator('.luna-notification-item').filter({ hasText: labels.success }).last().screenshot({ path: path.join(output, name.replaceAll(' ', '-') + '.png') })
        }
        const successSeq = Math.max(...current.filter(c => c.success).map(c => c.successSeq))
        await until(async () => !!freshListAfter(await queries(), successSeq), name + ': no fresh list request after installation', negativeControl ? 10000 : 60000)
        await until(async () => await ready() && await panel.locator('.luna-data-grid-node').filter({ hasText: bundleName }).count() === 1,
          name + ': main list not automatically refreshed')
        const row = panel.locator('.luna-data-grid-node').filter({ hasText: bundleName })
        assert.ok((await row.innerText()).includes(version), name + ': stale version')
      }
      report.cases.push({ name, calls: current.length, successful: expectedSuccess, failed: expectedFailures,
        notificationsVisible: true, notificationChecks: terminal.map(({ text, at, ...proof }) => proof),
        latestInstallSuccessSeq: expectedSuccess > 0 ? Math.max(...current.filter(c => c.success).map(c => c.successSeq)) : null,
        refreshedAfterInstall: expectedSuccess > 0 ? freshListAfter(await queries(), Math.max(...current.filter(c => c.success).map(c => c.successSeq))) : null,
        controlledRefreshOverlap: overlap || null, version, fullscreen: await page.evaluate(() => !!document.fullscreenElement) })
      console.log(name + ': passed')
      await until(() => page.locator('.luna-notification-item').count().then(n => n === 0), 'Notices did not expire', 10_000)
    }
    const bodySelector = '.luna-data-grid'
    await run('main application fresh drop', mainPage, [base], 1, 0, packages[0].versionName, bodySelector)
    await run('main toolbar upgrade drop', mainPage, [upgrade], 1, 0, packages[1].versionName, '.panel-toolbar')
    if (negativeControl) await app.evaluate(() => { globalThis.hapSuppressInstalled = true })
    await run('main mixed uppercase spaced file', mainPage, [uppercase, text], 1, 0, packages[1].versionName, bodySelector)
    await run('main partial failure continues', mainPage, [invalid, upgrade], 1, 1, packages[1].versionName, bodySelector)
    await run('main unsupported drop', mainPage, [text], 0, 0, packages[1].versionName, bodySelector)
    await app.evaluate(() => { globalThis.hapHoldNextList = true })
    await panel.locator(`[title="${labels.refresh}"]`).click()
    await until(() => app.evaluate(() => !!globalThis.hapReleaseList), 'Real list response did not reach controlled hold')
    assert.equal(await ready(), false, 'Refresh must visibly be in progress before the drop')
    await run('main drop during refresh', mainPage, [upgrade], 1, 0, packages[1].versionName, '.panel-toolbar', undefined, true)
    await run('main two valid HAPs', mainPage, [upgrade, uppercase], 2, 0, packages[1].versionName, bodySelector)
    await mainPage.locator('.luna-tab-item[data-id="overview"]').click()
    await run('main overview empty area', mainPage, [upgrade], 1, 0, packages[1].versionName, undefined, { x: 220, y: 260, width: 0, height: 0 })
    await mainPage.locator('.luna-tab-item[data-id="application"]').click()
    await mainPage.evaluate(() => document.documentElement.requestFullscreen())
    await run('main fullscreen toolbar', mainPage, [upgrade], 1, 0, packages[1].versionName, '.panel-toolbar')
    await mainPage.bringToFront()
    await mainPage.evaluate(() => document.fullscreenElement ? document.exitFullscreen() : undefined)
    const newWindow = app.waitForEvent('window')
    await mainPage.evaluate(() => main.showScreencast())
    const cast = await newWindow; await cast.locator('canvas').waitFor(); await observe(cast)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=screencast')).setSize(370, 818))
    await run('screencast ordinary drop', cast, [upgrade], 1, 0, packages[1].versionName, 'canvas')
    // Back-to-back drops in different windows must not be mistaken for one drop,
    // and neither window may consume the other's completion notification.
    const concurrentStart = (await calls()).length
    await mainPage.evaluate(() => { globalThis.hapNotices = [] })
    await cast.evaluate(() => { globalThis.hapNotices = [] })
    await Promise.all([drop(mainPage, [upgrade], bodySelector), drop(cast, [upgrade], 'canvas')])
    await until(async () => { const c = (await calls()).slice(concurrentStart); return c.length === 2 && c.every(x => x.completed) }, 'Concurrent drops not completed')
    const concurrentCalls = (await calls()).slice(concurrentStart)
    assert.ok(concurrentCalls.every(c => c.success), 'Concurrent drops rejected')
    const concurrentSuccessSeq = Math.max(...concurrentCalls.map(c => c.successSeq))
    await until(async () => !!freshListAfter(await queries(), concurrentSuccessSeq) && await ready(), 'Concurrent completions did not refresh the list')
    for (const page of [mainPage, cast]) {
      await until(() => page.evaluate(prefix => globalThis.hapNotices.filter(n => n.text.startsWith(prefix)).length === 1, labels.success), 'Concurrent completion missing')
      const notices = await page.evaluate(prefix => globalThis.hapNotices.filter(n => n.text.startsWith(prefix)), labels.success)
      assert.ok(notices.every(n => n.visible && n.fits && n.insideFullscreen && n.noMarkupInjection), 'Concurrent notification not visible')
      await until(() => page.locator('.luna-notification-item').count().then(n => n === 0), 'Concurrent notice not expired')
    }
    report.cases.push({ name: 'concurrent main and screencast drops', calls: 2, successful: 2, failed: 0, notificationsVisible: true, latestInstallSuccessSeq: concurrentSuccessSeq, refreshedAfterInstall: freshListAfter(await queries(), concurrentSuccessSeq) })
    console.log('concurrent main and screencast drops: passed')
    await run('screencast partial failure continues', cast, [invalid, uppercase], 1, 1, packages[1].versionName, 'canvas')
    await cast.evaluate(() => document.querySelector('canvas').parentElement.requestFullscreen())
    await until(() => cast.evaluate(() => !!document.fullscreenElement), 'Fullscreen not entered')
    await run('screencast fullscreen drop', cast, [uppercase], 1, 0, packages[1].versionName, 'canvas')
    await run('screencast fullscreen invalid HAP', cast, [invalid], 0, 1, packages[1].versionName, 'canvas')
    await cast.bringToFront()
    await cast.evaluate(() => document.fullscreenElement ? document.exitFullscreen() : undefined)
    await run('screencast after fullscreen exit', cast, [upgrade], 1, 0, packages[1].versionName, 'canvas')
    const after = await mainPage.evaluate(key => main.getBundles(key, false), key)
    assert.deepEqual(after.filter(n => n !== bundleName).sort(), before.filter(n => n !== bundleName).sort())
    report.otherBundlesUnchanged = true
    report.finalVersion = packages[1].versionName
    report.finallyInstalled = true
    report.passed = true
  } catch (error) {
    report.error = String(error.stack).replaceAll(key || '<none>', 'DEVICE_1').replaceAll(profile, '<profile>').replaceAll(process.cwd(), '<repository>')
    throw error
  } finally {
    if (app) {
      await app.evaluate(() => globalThis.hapReleaseList?.()).catch(() => {})
      await app.close().catch(() => {})
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    fs.rmSync(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
