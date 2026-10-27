// Real Electron/HDC acceptance. Only use a disposable, user-authorized test HAP.
// node script/check-hap-install-live.mjs <hap> <bundleName> <output-dir> --disposable [--upgrade-hap <hap>] [--reset-existing-test-app]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron } from 'playwright-core'
import { finishInstallReport, parseTestBundleDump } from './lib/hap-report.cjs'

const [hapArg, bundleName, outputArg] = process.argv.slice(2)
assert.ok(hapArg && bundleName && outputArg && process.argv.includes('--disposable'),
  'Provide HAP, its bundle name, evidence directory and --disposable; this test installs and uninstalls that app')
assert.match(bundleName, /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/)
const hap = path.resolve(hapArg), output = path.resolve(outputArg)
const upgradeIndex = process.argv.indexOf('--upgrade-hap')
if (upgradeIndex !== -1) assert.ok(process.argv[upgradeIndex + 1], 'Missing upgrade HAP path')
const upgradeHap = upgradeIndex === -1 ? hap : path.resolve(process.argv[upgradeIndex + 1])
const packages = await Promise.all([hap, upgradeHap].map(async file => {
  const { app } = JSON.parse(execFileSync('unzip', ['-p', file, 'module.json'], { encoding: 'utf8', timeout: 15_000 }))
  assert.equal(app.bundleName, bundleName, 'HAP bundle must match the authorized disposable app')
  return { sha256: createHash('sha256').update(await readFile(file)).digest('hex'), versionName: app.versionName, versionCode: app.versionCode }
}))
if (upgradeIndex !== -1) assert.ok(packages[1].versionCode > packages[0].versionCode)
const hdc = path.resolve('dist/resources/hdc', process.platform === 'win32' ? 'hdc.exe' : 'hdc')
const cli = (...args) => execFileSync(hdc, args, { encoding: 'utf8', timeout: 30_000 }).trim()
const keys = cli('list', 'targets').split(/\r?\n/).filter(Boolean)
assert.equal(keys.length, 1, 'Connect exactly one authorized device')
const key = keys[0]
const shell = command => cli('-t', key, 'shell', command)
const dump = () => parseTestBundleDump(shell(`bm dump -n ${bundleName}`), bundleName)
const initiallyPresent = !!dump()
assert.ok(!initiallyPresent || process.argv.includes('--reset-existing-test-app'),
  'Test app already exists; refuse to remove existing data without explicit reset flag')
await mkdir(output, { recursive: true })
const report = { startedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  packages, bundleName,
  software: shell('param get const.product.software.version'), initiallyPresent,
  scope: 'Actual UI install, replacement, native menu callback and confirmation, HDC and automatic refresh. File picker/menu selection automated; no IPC/device responses mocked.',
  assets: {}, languages: [], passed: false }
for (const file of ['src/renderer/lib/util.ts', 'vendor/packages/hdckit/src/hdc/command/install.ts', 'dist/main/index.js']) {
  report.assets[file] = createHash('sha256').update(await readFile(file)).digest('hex')
}
let app, profile
async function until(check, message, timeout = 180_000) {
  const deadline = Date.now() + timeout
  do { if (await check()) return; await delay(150) } while (Date.now() < deadline)
  throw Error(message)
}
try {
  for (const language of ['zh-CN', 'en-US']) {
    profile = await mkdtemp(path.join(os.tmpdir(), 'scrcpy-hap-'))
    await mkdir(path.join(profile, 'data'))
    await writeFile(path.join(profile, 'data/main.json'), JSON.stringify({ panel: 'application', application: { sysBundle: false, listView: true } }))
    await writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({ language, killHdcWhenExit: false }))
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
      args: [path.resolve('dist'), `--user-data-dir=${profile}`] })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const item = { language, cycles: [], pageErrors: errors }; report.languages.push(item)
    const zh = language === 'zh-CN'
    const labels = zh ? { filter: '过滤', refresh: '刷新', install: '安装', uninstall: '卸载', ok: '确定', success: '安装成功：' }
      : { filter: 'Filter', refresh: 'Refresh', install: 'Install', uninstall: 'Uninstall', ok: 'OK', success: 'Installed successfully:' }
    await page.getByPlaceholder(labels.filter, { exact: true }).waitFor()
    const panel = page.locator('.panel-with-toolbar').filter({ has: page.getByPlaceholder(labels.filter, { exact: true }) })
    const ready = () => panel.locator(`[title="${labels.refresh}"]`).evaluate(el => !el.closest('.luna-toolbar-disabled'))
    await until(ready, 'Initial application list did not finish')
    const beforeNames = await page.evaluate(key => main.getBundles(key, false), key)
    const otherNames = beforeNames.filter(name => name !== bundleName)
    item.otherBundleCount = otherNames.length
    await page.getByPlaceholder(labels.filter, { exact: true }).fill(bundleName)
    const row = panel.locator('.luna-data-grid-node').filter({ hasText: bundleName })
    await app.evaluate(({ dialog, Menu }, hap) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [hap] })
      globalThis.__hapMenu = null
      Menu.prototype.popup = function () { globalThis.__hapMenu = this }
    }, hap)
    await page.evaluate(() => {
      globalThis.__hapNotifications = []
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.luna-notification')) {
          const text = el.textContent || ''
          if (text && !globalThis.__hapNotifications.includes(text)) globalThis.__hapNotifications.push(text)
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    async function uninstall() {
      await row.waitFor()
      await app.evaluate(() => { globalThis.__hapMenu = null })
      await row.locator('td').first().click({ button: 'right', position: { x: 20, y: 10 } })
      await until(() => app.evaluate(() => !!globalThis.__hapMenu), 'Context menu did not open', 10_000)
      await app.evaluate(({ BrowserWindow }, label) => {
        const menu = globalThis.__hapMenu
        const entry = menu.items.find(item => item.label === label)
        if (!entry) throw Error('Uninstall menu item missing')
        BrowserWindow.getAllWindows().find(win => win.isVisible())?.focus()
        entry.click()
      }, labels.uninstall)
      await page.locator('.luna-modal:not(.luna-modal-hidden)').getByText(labels.ok, { exact: true }).click()
      await until(async () => !dump() && await ready() && await row.count() === 0,
        'Uninstall did not remove the app and automatically refresh the list')
    }
    if (dump()) {
      console.log(`${language}: removing only the explicitly authorized existing test app through UI`)
      await uninstall(); item.initialResetThroughUi = true
    }
    const countText = () => panel.locator('.luna-toolbar-item-text').innerText()
    item.before = await countText()
    for (let cycle = 0; cycle < 3; cycle++) {
      const previous = dump()
      const selectedHap = cycle === 0 ? hap : upgradeHap
      const expected = packages[cycle === 0 ? 0 : 1]
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
      }, selectedHap)
      await until(() => page.evaluate(prefix => ![...document.querySelectorAll('.luna-notification')]
        .some(el => el.textContent.includes(prefix)), labels.success), 'Previous success notification did not expire', 30_000)
      await page.evaluate(() => { globalThis.__hapNotifications = [] })
      const start = Date.now()
      await panel.locator(`[title="${labels.install}"]`).click()
      await until(() => page.evaluate(prefix => globalThis.__hapNotifications.some(text => text.includes(prefix)), labels.success),
        'Missing installation success notification', 30_000)
      await until(async () => await ready() && await row.count() === 1,
        'Install did not automatically refresh the list')
      const current = dump(); assert.ok(current)
      assert.equal(current.bundleName, bundleName)
      assert.equal(current.versionName, expected.versionName)
      assert.equal(current.versionCode, expected.versionCode)
      if (previous) {
        assert.equal(current.installTime, previous.installTime, 'Replacement must not uninstall the app')
        assert.ok(current.updateTime > previous.updateTime, 'Replacement must update the installed package')
      }
      const infos = await page.evaluate(({ key, bundleName }) => main.getBundleInfos(key, [bundleName]), { key, bundleName })
      assert.equal(infos.length, 1); assert.equal(infos[0].versionName, current.versionName)
      assert.ok(infos[0].label && !infos[0].label.startsWith('$'))
      const text = await row.innerText()
      assert.ok(text.includes(infos[0].label) && text.includes(current.versionName))
      item.cycles.push({ kind: previous ? 'replacement' : 'fresh', durationMs: Date.now() - start,
        metadata: current, label: infos[0].label, hasApplicationIcon: !!infos[0].icon,
        notification: true, automaticallyVisible: true, listCount: await countText() })
      await row.screenshot({ path: path.join(output, `${language}-row.png`) })
      console.log(`${language}: ${previous ? 'replacement' : 'fresh'} install, success notification and refreshed row passed`)
    }
    await uninstall(); item.after = await countText(); assert.equal(item.after, item.before)
    const remaining = await page.evaluate(key => main.getBundles(key, false), key)
    assert.deepEqual(remaining.slice().sort(), otherNames.slice().sort())
    item.otherBundlesUnchanged = true; item.uninstallAutoRefresh = true
    assert.deepEqual(errors, [])
    await app.close(); app = null
    await rm(profile, { recursive: true, force: true }); profile = null
    console.log(`${language}: uninstall and other bundle set preserved`)
  }
  report.passed = true
} catch (error) {
  report.error = String(error.stack).replaceAll(key, 'DEVICE_1').replaceAll(hap, '<test.hap>').replaceAll(upgradeHap, '<upgrade.hap>')
  throw error
} finally {
  await finishInstallReport({
    report,
    close: async () => { if (app) await app.close() },
    cleanup: async () => { if (profile) await rm(profile, { recursive: true, force: true }) },
    inspect: dump,
    write: data => writeFile(path.join(output, 'report.json'), JSON.stringify(data, null, 2) + '\n'),
    formatError: error => String(error.message || error).replaceAll(key, 'DEVICE_1').replaceAll(hap, '<test.hap>').replaceAll(upgradeHap, '<upgrade.hap>'),
  })
}
